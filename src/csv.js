// CSV parser simples (suporta aspas duplas e vírgulas dentro de aspas)
function parseCSV(text) {
  const rows = [];
  let i = 0, field = "", row = [];
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // escape "" -> "
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushField(); i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { pushField(); pushRow(); i++; continue; }

    field += ch;
    i++;
  }
  // last field
  pushField();
  // avoid trailing empty row when file ends with newline
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) pushRow();
  return rows;
}

function toISOFromAny(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Accept ISO
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1.toISOString();

  // Accept dd/mm/yyyy or dd/mm/yyyy hh:mm
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const dd = Number(m[1]), mm = Number(m[2]) - 1, yyyy = Number(m[3]);
    const hh = m[4] ? Number(m[4]) : 9;
    const mi = m[5] ? Number(m[5]) : 0;
    const d = new Date(Date.UTC(yyyy, mm, dd, hh, mi, 0));
    return d.toISOString();
  }
  return null;
}

module.exports = { parseCSV, toISOFromAny };
