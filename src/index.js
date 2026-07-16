require("dotenv").config();
const path = require("path");
const express = require("express");
const webhookRouter = require("./routes/webhook");
const dashboardRouter = require("./routes/dashboard");
const { dashboardAuth } = require("./middleware/auth");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.send("Tovila WhatsApp agent is running.");
});

// WhatsApp calls this directly — must stay unauthenticated.
app.use("/webhook", webhookRouter);

// Everything else is the demo dashboard, gated behind Basic Auth.
app.use(dashboardAuth);
app.use("/", dashboardRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Tovila server listening on port ${PORT}`);
});

module.exports = app;
