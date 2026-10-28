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

// "10/24/2026", as in the season tables.
export function fmtShortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// "October 24, 2026", as in a leis night's header.
export function fmtLongDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// "Oct 27, 2026 @ 15:14:15", the timestamp at the top of every page.
export function fmtStamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${day} @ ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// Seasons run Spring (Jan–Jun) and Fall (Jul–Dec). Ids look like "f26" / "s26".
export function seasonOf(iso) {
  const [year, month] = (iso || todayIso()).split("-").map(Number);
  const fall = month >= 7;
  return { id: `${fall ? "f" : "s"}${String(year).slice(2)}`, name: `${fall ? "Fall" : "Spring"} ${year}`, sort: `${year}-${fall ? 2 : 1}` };
}

// A pennant for a team, standing in for a school burgee: a colour picked
// from the team's name, with its short name on it.
const BURGEE_COLORS = [
  ["#8c1515", "#fff"], ["#00356b", "#fff"], ["#a51c30", "#fff"], ["#00693e", "#fff"], ["#4e2a84", "#fff"],
  ["#c99700", "#1b1b1b"], ["#e35205", "#fff"], ["#0b2240", "#f0b323"], ["#1b1b1b", "#fff"], ["#4b9cd3", "#fff"],
  ["#7a0019", "#ffcc33"], ["#2774ae", "#ffd100"],
];
export function burgee(team, h = 40) {
  if (!team) return "";
  const key = String(team.name || team.short || "");
  let n = 0;
  for (const c of key) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = BURGEE_COLORS[n % BURGEE_COLORS.length];
  const label = String(team.short || "").slice(0, 4);
  return `<svg class="burgee-img" viewBox="0 0 60 40" height="${h}" width="${h * 1.5}" role="img" aria-label="${esc(team.name)}">
    <rect x="1" y="1" width="2.5" height="38" fill="#777"/>
    <path d="M3.5 3 L58 20 L3.5 37 Z" fill="${bg}" stroke="#555" stroke-width=".8"/>
    <path d="M3.5 3 L58 20 L3.5 9 Z" fill="${fg}" opacity=".9"/>
    <text x="21" y="25" font-family="Arial, Helvetica, sans-serif" font-size="${label.length > 3 ? 9 : 11}" font-weight="bold" fill="${fg}" text-anchor="middle">${esc(label)}</text>
  </svg>`;
}
