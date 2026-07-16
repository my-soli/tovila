// Single hardcoded username/password protecting the dashboard during demos.
// Plain HTTP Basic Auth is enough here — the browser handles the login
// prompt for us, no session/cookie plumbing needed for an MVP.
function dashboardAuth(req, res, next) {
  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPass = process.env.DASHBOARD_PASSWORD;

  if (!expectedUser || !expectedPass) {
    console.error(
      "DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set — check your .env"
    );
    return res.status(500).send("Dashboard auth is not configured.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === expectedUser && pass === expectedPass) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Tovila Dashboard"');
  return res.status(401).send("Authentication required.");
}

module.exports = { dashboardAuth };
