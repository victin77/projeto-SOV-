const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.SOV_JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  // Dev default. Troque em produção via env var.
  return 'dev-secret-change-me-please-32chars';
}

function signToken({ user, role, ttlMs }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor(ttlMs / 1000);
  const token = jwt.sign(
    { sub: user, role, iat: nowSec, exp: expSec },
    getJwtSecret()
  );
  return { token, expMs: expSec * 1000 };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.auth = { user: payload.sub, role: payload.role, exp: payload.exp * 1000 };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = {
  signToken,
  authMiddleware
};

