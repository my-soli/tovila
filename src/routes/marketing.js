const express = require("express");
const {
  verifyCredentials,
  setSessionCookie,
  clearSessionCookie,
  hasValidSession,
} = require("../middleware/auth");

const router = express.Router();

// Public landing page — no auth required, but an already-logged-in seller
// should land in their dashboard rather than see the pitch again.
router.get("/", (req, res) => {
  if (hasValidSession(req)) return res.redirect("/overview");
  res.render("marketing-landing");
});

router.get("/login", (req, res) => {
  res.render("login", { error: req.query.error === "1", next: req.query.next || "" });
});

router.post("/login", (req, res) => {
  const { username, password, next } = req.body;

  let valid = false;
  try {
    valid = verifyCredentials(username, password);
  } catch (err) {
    console.error("Login failed:", err.message);
    return res.status(500).send("Dashboard auth is not configured.");
  }

  if (!valid) {
    const query = next ? `?error=1&next=${encodeURIComponent(next)}` : "?error=1";
    return res.redirect(`/login${query}`);
  }

  setSessionCookie(res);
  res.redirect(next || "/overview");
});

router.get("/logout", (req, res) => {
  clearSessionCookie(res);
  res.redirect("/");
});

module.exports = router;
