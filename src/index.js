require("dotenv").config();
const path = require("path");
const express = require("express");
const webhookRouter = require("./routes/webhook");
const dashboardRouter = require("./routes/dashboard");
const { dashboardAuth } = require("./middleware/auth");

const app = express();
// Captures the raw request body bytes alongside the parsed JSON — needed to
// verify Meta's X-Hub-Signature-256 header, which is computed over the
// exact bytes sent, not a re-serialization of the parsed object.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.static(path.join(__dirname, "..", "public")));

// Used by Railway's healthcheck (see railway.toml) to confirm the web
// service is up before routing traffic to it.
app.get("/health", (_req, res) => {
  res.status(200).send("Tovila WhatsApp agent is running.");
});

// WhatsApp calls this directly — must stay unauthenticated.
app.use("/webhook", webhookRouter);

// Everything else is the demo dashboard, gated behind Basic Auth.
app.use(dashboardAuth);
app.use("/", dashboardRouter);

// Railway (and most PaaS platforms) inject PORT at runtime — the app must
// bind to whatever value it provides, never a hardcoded port.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tovila server listening on port ${PORT}`);
});

module.exports = app;
