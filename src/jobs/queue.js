const prisma = require("../db/client");

const MAX_ATTEMPTS = 5;
// If a job has been "processing" longer than this with no completion, the
// worker that claimed it almost certainly crashed/was killed mid-job —
// reclaim it rather than leaving it stuck forever (a queue that can strand
// jobs on a crash isn't actually durable).
const STALE_PROCESSING_MS = 2 * 60 * 1000;

async function enqueueJob(type, payload) {
  return prisma.job.create({
    data: { type, payload },
  });
}

/**
 * Atomically claims the oldest due pending job (or a stale "processing" job
 * abandoned by a crashed worker), marking it "processing" so a single
 * process (or future concurrent workers) never double-processes the same
 * job under normal operation.
 */
async function claimNextJob() {
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS);

  const candidate = await prisma.job.findFirst({
    where: {
      OR: [
        { status: "pending", runAt: { lte: new Date() } },
        { status: "processing", updatedAt: { lt: staleThreshold } },
      ],
    },
    orderBy: { runAt: "asc" },
  });

  if (!candidate) return null;

  // updateMany + where-on-status guards against a concurrent worker having
  // already claimed this same row between the findFirst and now.
  const result = await prisma.job.updateMany({
    where: { id: candidate.id, status: candidate.status },
    data: { status: "processing" },
  });

  if (result.count === 0) return null;

  if (candidate.status === "processing") {
    console.warn(`Reclaimed stale job ${candidate.id} (stuck in "processing" for over ${STALE_PROCESSING_MS / 1000}s).`);
  }

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
