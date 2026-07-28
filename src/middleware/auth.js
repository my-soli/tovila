const crypto = require("crypto");

const COOKIE_NAME = "tovila_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Single shared admin username/password (env vars) that can see and switch
 * between every seller — distinct from a seller's own self-serve account
 * (see hashPassword/verifyPassword below). Same credential model as the
 * earlier Basic Auth version, just presented as a real login page.
 */
function verifyCredentials(username, password) {
  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPass = process.env.DASHBOARD_PASSWORD;

  if (!expectedUser || !expectedPass) {
    throw new Error("DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set — check your .env");
  }

  return username === expectedUser && password === expectedPass;
}

const SCRYPT_KEYLEN = 64;

/** Hashes a seller's self-serve account password as "salt:hashHex" — no bcrypt/argon2 dependency needed for Node's built-in scrypt. */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const candidate = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** Random token for the email-verification link — collision-safe enough via the DB's unique constraint. */
function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sign(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set — check your .env");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Sets the signed session cookie. `session` is either `{type: "admin"}`
 * (sees/switches every seller) or `{type: "seller", sellerId}` (pinned to
 * that seller only) — see src/routes/dashboard.js for how each is resolved.
 */
function setSessionCookie(res, session) {
  const expiry = Date.now() + SESSION_MS;
  const sellerId = session.sellerId || "";
  const payload = `${session.type}:${sellerId}:${expiry}`;
  const value = `${payload}:${sign(payload)}`;

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

/** Parses and verifies the session cookie, returning {type, sellerId} or null. */
function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length !== 4) return null;
  const [type, sellerId, expiryStr, signature] = parts;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  if (type !== "admin" && type !== "seller") return null;
  if (type === "seller" && !sellerId) return null;

  const payload = `${type}:${sellerId}:${expiryStr}`;
  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!valid) return null;
  return { type, sellerId: sellerId || null };
}

function hasValidSession(req) {
  return getSession(req) !== null;
}

/** Gates every dashboard route — redirects to the login page (preserving where the seller was headed) instead of a browser auth prompt. */
function dashboardAuth(req, res, next) {
  if (!process.env.SESSION_SECRET || !process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
    console.error(
      "SESSION_SECRET / DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set — check your .env"
    );
    return res.status(500).send("Dashboard auth is not configured.");
  }

  const session = getSession(req);
  if (!session) {
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next_}`);
  }

  req.session = session;
  next();
}

module.exports = {
  dashboardAuth,
  verifyCredentials,
  hashPassword,
  verifyPassword,
  generateVerificationToken,
  setSessionCookie,
  clearSessionCookie,
  hasValidSession,
  getSession,
};
