const bcrypt = require("bcryptjs");
const { get } = require("./db");

const COOKIE = "sov_token";
// MVP token (não use em produção sem melhorias). Troque a chave!
const SECRET = process.env.SOV_SECRET || "troque_essa_chave_agora_123";

function signToken({ id, role }) {
  const raw = `${id}:${role}:${Date.now()}:${SECRET}`;
  return Buffer.from(raw).toString("base64");
}

function parseToken(token) {
  try {
    const raw = Buffer.from(token, "base64").toString("utf8");
    const [id, role, ts, secret] = raw.split(":");
    if (secret !== SECRET) return null;
    return { id: Number(id), role, ts: Number(ts) };
  } catch {
    return null;
  }
}

function requireAuth(roles = []) {
  return async (req, res, next) => {
    const token = req.cookies[COOKIE];
    const data = token ? parseToken(token) : null;
    if (!data) return res.status(401).json({ error: "Não autenticado" });

    const user = await get("SELECT id, name, email, role, active FROM users WHERE id = ?", [data.id]);
    if (!user || user.active !== 1) return res.status(401).json({ error: "Usuário inválido" });

    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    req.user = user;
    next();
  };
}

async function verifyPassword(email, password) {
  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || user.active !== 1) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

module.exports = { COOKIE, signToken, parseToken, requireAuth, verifyPassword };
