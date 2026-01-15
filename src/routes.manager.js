const express = require("express");
const { all } = require("./db");
const { requireAuth } = require("./auth");

const router = express.Router();

router.get("/users", requireAuth(["admin", "gestor"]), async (req, res) => {
  const users = await all("SELECT id, name, email, role, active FROM users WHERE active = 1 ORDER BY name ASC");
  res.json({ users });
});

module.exports = router;
