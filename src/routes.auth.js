const express = require("express");
const { COOKIE, signToken, verifyPassword, requireAuth } = require("./auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Dados inválidos" });

  const user = await verifyPassword(email, password);
  if (!user) return res.status(401).json({ error: "Login inválido" });

  const token = signToken({ id: user.id, role: user.role });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get("/me", requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
