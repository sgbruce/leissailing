// Standings and the results tables. Pure functions: data in, HTML out.
// Table markup and class names follow Techscore's team racing pages.
import { esc, burgee } from "./util.js";

// Win-loss records, ranked by win %, then wins, then fewer losses,
// then head-to-head wins among the tied teams, then name.
export function standings(teams, races) {
  const rec = new Map(teams.map((t) => [t.id, { team: t, w: 0, l: 0, pending: 0, beat: new Map() }]));
  for (const r of races) {
    const a = rec.get(r.teamA), b = rec.get(r.teamB);
    if (!a || !b) continue;
    if (!r.winner) { a.pending++; b.pending++; continue; }
    const [win, lose] = r.winner === r.teamA ? [a, b] : [b, a];
    win.w++; lose.l++;
    win.beat.set(lose.team.id, (win.beat.get(lose.team.id) || 0) + 1);
  }
  const rows = [...rec.values()].map((x) => ({ ...x, pct: x.w + x.l ? x.w / (x.w + x.l) : 0 }));
  const key = (x) => `${x.pct.toFixed(6)}|${x.w}|${x.l}`;
  rows.sort((x, y) => y.pct - x.pct || y.w - x.w || x.l - y.l);

  const out = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j < rows.length && key(rows[j]) === key(rows[i])) j++;
    const group = rows.slice(i, j);
    const ids = new Set(group.map((g) => g.team.id));
    for (const g of group) {
      g.h2h = [...g.beat].reduce((s, [id, n]) => s + (ids.has(id) ? n : 0), 0);
      g.group = group.length > 1 && (g.w + g.l) > 0 ? group : null;
    }
    group.sort((x, y) => y.h2h - x.h2h || x.team.name.localeCompare(y.team.name));
    out.push(...group);
    i = j;
  }
  out.forEach((r, i) => {
    const p = out[i - 1];
    r.rank = p && key(p) === key(r) && p.h2h === r.h2h ? p.rank : i + 1;
  });
  out.forEach((r) => { r.tied = out.some((o) => o !== r && o.rank === r.rank); });
  return out;
}

// Tiebreak marks like Techscore's: teams separated by head-to-head wins get a
// symbol, explained in a key under the table.
const SYMBOLS = ["*", "**", "***", "b", "c", "d", "e", "f", "g"];
function tiebreaks(order) {
  const legend = new Map();
  for (const r of order) {
    if (!r.group) continue;
    const text = `Number of races won when tied teams met (${r.h2h})`;
    if (!legend.has(text)) legend.set(text, SYMBOLS[legend.size] || "+");
    r.sym = legend.get(text);
    r.symText = text;
  }
  return legend;
}

function tiebreakKey(legend) {
  if (!legend.size) return "";
  return `<table class="tiebreaker"><thead><tr><th>Sym.</th><th>Explanation</th></tr></thead><tbody>
    ${[...legend].map(([text, sym]) => `<tr><td>${esc(sym)}</td><td class="explanation">${esc(text)}</td></tr>`).join("")}
  </tbody></table>`;
}

// What the home and season pages show for an event: stored on the event.
export function eventSummary(teams, races) {
  const order = standings(teams, races);
  const scored = races.filter((r) => r.winner);
  const top = order[0];
  return {
    teams: teams.length,
    races: races.length,
    scored: scored.length,
    last: scored.length ? Math.max(...scored.map((r) => r.number)) : null,
    leader: scored.length && top ? { name: top.team.name, short: top.team.short } : null,
  };
}

export function racesBetween(races, a, b) {
  return races
    .filter((r) => (r.teamA === a && r.teamB === b) || (r.teamA === b && r.teamB === a))
    .sort((x, y) => x.number - y.number);
}

const pct = (x) => (x.w + x.l ? (x.pct * 100).toFixed(1) : "");
const rec = (x) => `${x.w}/${x.l}`;

// Report page: the full results with every team's sailors, one row per sailor.
export function renderReport(teams, races) {
  const order = standings(teams, races);
  const legend = tiebreaks(order);
  const body = order.map((r, i) => {
    const sailors = r.team.sailors?.length ? r.team.sailors : [{ name: "" }];
    const n = sailors.length;
    const rowCls = `row${i % 2}`;
    const sailor = (s) => `<td class="sailor">${esc(s.name)}</td>`;
    return `<tr class="topborder ${rowCls}">
        <td rowspan="${n}" class="tiebreaker" title="${esc(r.symText || "")}">${esc(r.sym || "")}</td>
        <td rowspan="${n}">${r.rank}</td>
        <td rowspan="${n}" class="burgee-cell">${burgee(r.team)}</td>
        <td rowspan="${n}" class="teamname"><b>${esc(r.team.name)}</b></td>
        <td rowspan="${n}" class="shortname">${esc(r.team.short)}</td>
        <td rowspan="${n}">${rec(r)}</td>
        ${sailor(sailors[0])}
      </tr>${sailors.slice(1).map((s) => `<tr class="${rowCls}">${sailor(s)}</tr>`).join("")}`;
  }).join("");
  return `<table class="teamranking results">
      <thead><tr><th class="tiebreaker"></th><th>#</th><th title="Team burgee"></th><th class="teamname">Team</th>
        <th class="teamname">Short</th><th title="Win/loss record">Rec.</th><th class="sailor">Sailors</th></tr></thead>
      <tbody>${body}</tbody>
    </table>${tiebreakKey(legend)}`;
}

// Full scores, part 1: the ranking summary.
export function renderRankingSummary(teams, races, allLink) {
  const order = standings(teams, races);
  const legend = tiebreaks(order);
  const body = order.map((r, i) => `<tr class="topborder row${i % 2}">
      <td class="tiebreaker" title="${esc(r.symText || "")}">${esc(r.sym || "")}</td>
      <td>${r.rank}</td>
      <td class="burgee-cell">${burgee(r.team)}</td>
      <td class="teamname"><b>${esc(r.team.name)}</b></td>
      <td class="teamname">${esc(r.team.short)}</td>
      <td><a href="${allLink(r.team.id)}" title="Show ${esc(r.team.name)}'s races">${rec(r)}</a></td>
      <td>${pct(r)}</td>
      <td class="pending">${r.pending || ""}</td>
    </tr>`).join("");
  return `<table class="teamranking results" id="teamranking-summary">
      <thead><tr><th></th><th>#</th><th title="Team burgee"></th><th class="teamname">Team</th><th class="teamname">Short</th>
        <th title="Win/loss record">Rec.</th><th title="Winning percentage">%</th><th title="Races not yet scored">To sail</th></tr></thead>
      <tbody>${body}</tbody>
    </table>${tiebreakKey(legend)}`;
}

// Full scores, part 2: the round-robin grid. One row and one column per team,
// in ranking order. A cell holds every race between the row team and the
// column team, from the row team's side, so rematches stack in the same cell.
export function renderGrid(teams, races, allLink) {
  const order = standings(teams, races);
  const head = order.map((r) =>
    `<th class="tr-vert-label" title="${esc(r.team.name)}"><span>${esc(r.team.name)}</span></th>`).join("");

  const mark = (race, rowId) => {
    if (!race.winner) return { cls: "tr-pending", text: `#${race.number}`, title: "not sailed yet" };
    const won = race.winner === rowId;
    return { cls: won ? "tr-win" : "tr-lose", text: `${won ? "W" : "L"} (#${race.number})`, title: won ? "won" : "lost" };
  };

  const body = order.map((row) => {
    const cells = order.map((col) => {
      if (col.team.id === row.team.id) return `<td class="tr-ns">X</td>`;
      const rs = racesBetween(races, row.team.id, col.team.id);
      if (!rs.length) return `<td class="tr-empty"></td>`;
      const marks = rs.map((r) => ({ ...mark(r, row.team.id), r }));
      const tip = (m) => `Race ${m.r.number} vs ${col.team.name}: ${m.title}${m.r.note ? ` (${m.r.note})` : ""}`;
      if (marks.length === 1) {
        const [m] = marks;
        return `<td class="${m.cls}" title="${esc(tip(m))}">${m.text}</td>`;
      }
      return `<td class="tr-multcell"><table class="tr-multtable"><tbody>${marks.map((m) =>
        `<tr><td class="${m.cls}" title="${esc(tip(m))}">${m.text}</td></tr>`).join("")}</tbody></table></td>`;
    }).join("");
    return `<tr class="tr-row">
      <th class="tr-horiz-label">${esc(row.team.name)}</th>
      <td class="tr-record"><a href="${allLink(row.team.id)}" title="Show ${esc(row.team.name)}'s races">${row.w}-${row.l}</a></td>
      ${cells}
    </tr>`;
  }).join("");

  return `<div class="chart-container"><table class="teamscores"><tbody>
    <tr class="tr-cols"><td class="tr-pivot">↓ vs →</td><th class="tr-rec-th">Record</th>${head}</tr>
    ${body}
  </tbody></table></div>`;
}

// All races, in race order, optionally just one team's.
export function renderAllRaces(teams, races, teamId) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const list = teamId ? races.filter((r) => r.teamA === teamId || r.teamB === teamId) : races;
  const hasNotes = list.some((r) => r.note);
  const side = (r, id, cls) => {
    const t = byId.get(id);
    const res = !r.winner ? "" : r.winner === id ? "tr-win" : "tr-lose";
    const name = t ? esc(t.name) : `<span class="noshow">(removed team)</span>`;
    const result = !r.winner ? "" : r.winner === id ? "Win" : "Loss";
    return { burgee: `<td class="${cls} burgee-col">${burgee(t, 20)}</td>`, name: `<td class="${res} ${cls}">${name}</td>`, result: `<td class="${res} ${cls}">${result}</td>` };
  };
  const rows = list.map((r) => {
    const a = side(r, r.teamA, "team1"), b = side(r, r.teamB, "team2");
    return `<tr>
      <td>${r.number}</td>${a.burgee}${a.name}${a.result}
      <td class="vscell">vs</td>
      ${b.result}${b.name}${b.burgee}
      ${hasNotes ? `<td class="races">${esc(r.note || "")}</td>` : ""}
    </tr>`;
  }).join("");
  const scored = list.filter((r) => r.winner).length;
  return `<table class="teamscorelist" id="rotation-table">
    <thead><tr><th>#</th><th colspan="2">Team 1</th><th>Result</th><th></th><th>Result</th><th colspan="2">Team 2</th>${hasNotes ? "<th>Note</th>" : ""}</tr></thead>
    <tbody>
      <tr class="roundrow"><th colspan="${hasNotes ? 9 : 8}">${scored} of ${list.length} races scored</th></tr>
      ${rows}
    </tbody>
  </table>`;
}
