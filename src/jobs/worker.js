const { claimNextJob, completeJob, failJob } = require("./queue");
const { processInboundMessage } = require("./handlers/processInboundMessage");

const POLL_INTERVAL_MS = 2000;

const HANDLERS = {
  process_inbound_message: (job) => processInboundMessage(job.payload),
};

async function tick() {
  let job;
  try {
    job = await claimNextJob();
  } catch (err) {
    console.error("Failed to claim next job:", err);
    return;
  }

  if (!job) return;

  const handler = HANDLERS[job.type];
  if (!handler) {
    console.error(`No handler registered for job type "${job.type}"`);
    await failJob(job.id, new Error(`Unknown job type "${job.type}"`));
    return;
  }

  try {
    await handler(job);
    await completeJob(job.id);
  } catch (err) {
    await failJob(job.id, err);
  }
}

function startWorker() {
  console.log(`Job worker started (polling every ${POLL_INTERVAL_MS / 1000}s).`);
  const interval = setInterval(() => {
    tick().catch((err) => console.error("Unexpected error in job worker tick:", err));
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}

module.exports = { startWorker };
