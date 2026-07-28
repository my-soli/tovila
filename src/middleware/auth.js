const crypto = require("crypto");

const COOKIE_NAME = "tovila_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Single shared username/password for the whole dashboard (no per-user
 * accounts) — same credential model as the earlier Basic Auth version, just
 * presented as a real login page instead of a browser auth dialog.
 */
function verifyCredentials(username, password) {
  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPass = process.env.DASHBOARD_PASSWORD;

  if (!expectedUser || !expectedPass) {
    throw new Error("DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set — check your .env");
  }

  return username === expectedUser && password === expectedPass;
}

function sign(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set — check your .env");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/** Sets the signed session cookie proving this browser has logged in, valid for SESSION_MS. */
function setSessionCookie(res) {
  const expiry = Date.now() + SESSION_MS;
  const value = `${expiry}.${sign(String(expiry))}`;

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function parseCookies(header) {
  const cookies = {};
  (header || "").split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;

  const [expiryStr, signature] = raw.split(".");
  if (!expiryStr || !signature) return false;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;

  let expected;
  try {
    expected = sign(expiryStr);
  } catch {
    return false;
  }

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  );
}

/** Gates every dashboard route — redirects to the login page (preserving where the seller was headed) instead of a browser auth prompt. */
function dashboardAuth(req, res, next) {
  if (!process.env.SESSION_SECRET || !process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
    console.error(
      "SESSION_SECRET / DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set — check your .env"
    );
    return res.status(500).send("Dashboard auth is not configured.");
  }

  if (hasValidSession(req)) return next();

  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${next_}`);
}

module.exports = {
  dashboardAuth,
  verifyCredentials,
  setSessionCookie,
  clearSessionCookie,
  hasValidSession,
};
