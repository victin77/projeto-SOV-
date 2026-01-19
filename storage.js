// storage.js
import fs from "fs";
import path from "path";

const BASE = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data";
const FILE = path.join(BASE, "leads.json");

function ensureDir() {
  fs.mkdirSync(BASE, { recursive: true });
}

export function loadLeads() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

export function saveLeads(leads) {
  ensureDir();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2));
  fs.renameSync(tmp, FILE);
}
 
