require("dotenv").config();
const { startWorker } = require("./jobs/worker");
const { startAutoCloseSweep } = require("./jobs/autoClose");

// Background-only entry point — no Express, no port binding. Deployed as
// its own Railway service (separate from src/index.js's web service) so
// job processing runs continuously without competing with HTTP traffic,
// and so the two can be scaled/restarted independently.
console.log("Tovila background worker starting...");
startWorker();
startAutoCloseSweep();
