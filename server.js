// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { loadLeads, saveLeads } from "./storage.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Corrigir __dirname no ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 👉 SERVE O FRONT-END
app.use(express.static(path.join(__dirname, "dev")));

// ========= API =========

// buscar leads
app.get("/api/leads", (req, res) => {
  const leads = loadLeads();
  res.json(leads);
});

// criar lead
app.post("/api/leads", (req, res) => {
  const leads = loadLeads();

  const lead = {
    id: crypto.randomUUID(),
    ...req.body,
    createdAt: Date.now()
  };

  leads.push(lead);
  saveLeads(leads);

  res.status(201).json(lead);
});

// ========= SPA fallback =========
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dev", "index.html"));
});

// ========= START =========
app.listen(PORT, () => {
  console.log("SOV rodando na porta", PORT);
});
