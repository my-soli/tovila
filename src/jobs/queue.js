const prisma = require("../db/client");

const MAX_ATTEMPTS = 5;

async function enqueueJob(type, payload) {
  return prisma.job.create({
    data: { type, payload },
  });
}

/**
 * Atomically claims the oldest due pending job, if any, marking it
 * "processing" so a single process (or future concurrent workers) never
 * double-processes the same job.
 */
async function claimNextJob() {
  const candidate = await prisma.job.findFirst({
    where: { status: "pending", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
  });

  if (!candidate) return null;

  // updateMany + where-on-status guards against a concurrent worker having
  // already claimed this same row between the findFirst and now.
  const result = await prisma.job.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: { status: "processing" },
  });

  if (result.count === 0) return null;

  return candidate;
}

async function completeJob(id) {
  return prisma.job.update({ where: { id }, data: { status: "done" } });
}

/**
 * On failure: retry with linear backoff up to MAX_ATTEMPTS, then give up and
 * mark "failed" so it stops being picked up (but stays in the table for
 * inspection rather than silently vanishing).
 */
async function failJob(id, error) {
  const job = await prisma.job.findUnique({ where: { id } });
  const attempts = (job?.attempts || 0) + 1;
  const lastError = String(error?.message || error);

  if (attempts >= MAX_ATTEMPTS) {
    console.error(`Job ${id} failed permanently after ${attempts} attempts: ${lastError}`);
    return prisma.job.update({
      where: { id },
      data: { status: "failed", attempts, lastError },
    });
  }

  const backoffMs = attempts * 30_000;
  console.warn(`Job ${id} failed (attempt ${attempts}/${MAX_ATTEMPTS}), retrying in ${backoffMs / 1000}s: ${lastError}`);
  return prisma.job.update({
    where: { id },
    data: {
      status: "pending",
      attempts,
      lastError,
      runAt: new Date(Date.now() + backoffMs),
    },
  });
}

module.exports = { enqueueJob, claimNextJob, completeJob, failJob };
