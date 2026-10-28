const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "Sam Bruce & Alex Kim" -> "SBAK"-style short label, capped at 6 characters.
export function autoShort(name) {
  const words = String(name).trim().split(/[\s&/+,-]+/).filter(Boolean);
  const s = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] || "").slice(0, 4);
  return s.toUpperCase().slice(0, 6);
}

export const sailorNames = (team) => (team?.sailors || []).map((s) => s.name).join(" / ");

export const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;
