const express = require("express");
const {
  verifyCredentials,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  hasValidSession,
} = require("../middleware/auth");
const { getSellerByEmail, createSellerAccount, verifySellerEmail } = require("../services/sellers");

const router = express.Router();

let resendClient;

/** Lazily constructs a Resend client only if an API key is configured — same degrade-gracefully pattern as src/services/notifications.js. */
function getResendClient() {
  if (resendClient !== undefined) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    resendClient = null;
    return resendClient;
  }

  const { Resend } = require("resend");
  resendClient = new Resend(apiKey);
  return resendClient;
}

async function sendVerificationEmail(seller, req) {
  const resend = getResendClient();
  if (!resend) {
    console.warn(
      `RESEND_API_KEY not set — skipping verification email for ${seller.email}. ` +
        `Verification link: ${req.protocol}://${req.get("host")}/verify-email?token=${seller.emailVerificationToken}`
    );
    return;
  }

  const link = `${req.protocol}://${req.get("host")}/verify-email?token=${seller.emailVerificationToken}`;
  try {
    await resend.emails.send({
      from: "Tovila <notifications@tovila.app>",
      to: seller.email,
      subject: "Verify your Tovila account",
      text: `Welcome to Tovila! Verify your email to start your 7-day free trial:\n\n${link}\n\nThis link expires in 24 hours.`,
    });
  } catch (err) {
    console.warn(`Failed to send verification email: ${err.message}`);
  }
}

// Public landing page — no auth required, but an already-logged-in seller
// should land in their dashboard rather than see the pitch again.
router.get("/", (req, res) => {
  if (hasValidSession(req)) return res.redirect("/overview");
  res.render("marketing-landing");
});

router.get("/pricing", (req, res) => {
  res.render("pricing");
});

router.get("/signup", (req, res) => {
  res.render("signup", { error: req.query.error || null });
});

router.post("/signup", async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!name || !email || password.length < 8) {
    return res.redirect("/signup?error=invalid");
  }

  const existing = await getSellerByEmail(email);
  if (existing) {
    return res.redirect("/signup?error=exists");
  }

  const seller = await createSellerAccount({ name, email, password });
  await sendVerificationEmail(seller, req);

  res.render("verify-notice", { email });
});

router.get("/verify-email", async (req, res) => {
  const seller = await verifySellerEmail(req.query.token || "");
  if (!seller) {
    return res.render("verify-notice", { email: null, expired: true });
  }

  setSessionCookie(res, { type: "seller", sellerId: seller.id });
  res.redirect("/products?welcome=1");
});

router.get("/login", (req, res) => {
  res.render("login", { error: req.query.error === "1", next: req.query.next || "" });
});

router.post("/login", async (req, res) => {
  const { username, password, next } = req.body;
  const query = () => {
    const params = new URLSearchParams({ error: "1", ...(next ? { next } : {}) });
    return `/login?${params.toString()}`;
  };

  // Try the platform admin credentials first.
  let adminValid = false;
  try {
    adminValid = username && verifyCredentials(username, password);
  } catch (err) {
    console.error("Login failed:", err.message);
    return res.status(500).send("Dashboard auth is not configured.");
  }

  if (adminValid) {
    setSessionCookie(res, { type: "admin" });
    return res.redirect(next || "/overview");
  }

  // Fall back to a seller's own self-serve account, keyed by email.
  const email = (username || "").trim().toLowerCase();
  const seller = await getSellerByEmail(email);

  if (!seller || !seller.emailVerified || !verifyPassword(password, seller.passwordHash)) {
    return res.redirect(query());
  }

  setSessionCookie(res, { type: "seller", sellerId: seller.id });
  res.redirect(next || "/overview");
});

router.get("/logout", (req, res) => {
  clearSessionCookie(res);
  res.redirect("/");
});

module.exports = router;
