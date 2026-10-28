// Standings and the round-robin grid. Pure functions: data in, HTML out.
import { esc, sailorNames } from "./util.js";

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

export function racesBetween(races, a, b) {
  return races
    .filter((r) => (r.teamA === a && r.teamB === b) || (r.teamA === b && r.teamB === a))
    .sort((x, y) => x.number - y.number);
}

const pct = (x) => (x.w + x.l ? `${Math.round(x.pct * 100)}%` : "–");

function chip(race, rowId, teamsById) {
  const a = teamsById.get(race.teamA), b = teamsById.get(race.teamB);
  if (!race.winner) {
    return `<span class="chip pending" title="Race ${race.number}: ${esc(a?.name)} vs ${esc(b?.name)}, not scored yet">${race.number}</span>`;
  }
  const won = race.winner === rowId;
  const w = teamsById.get(race.winner), l = race.winner === race.teamA ? b : a;
  return `<span class="chip ${won ? "win" : "loss"}" title="Race ${race.number}: ${esc(w?.name)} beat ${esc(l?.name)}">`
    + `<b>${won ? "W" : "L"}</b>${race.number}</span>`;
}

// One row and one column per team, in ranking order. Each cell holds every
// race between the row team and the column team, from the row team's side,
// so rematches show up as several marks in the same cell.
export function renderGrid(teams, races) {
  const order = standings(teams, races);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const head = order.map((r) =>
    `<th class="col" scope="col" title="${esc(r.team.name)}">${esc(r.team.short)}</th>`).join("");

  const body = order.map((row) => {
    const cells = order.map((col) => {
      if (col.team.id === row.team.id) return `<td class="self" aria-label="same team"></td>`;
      const rs = racesBetween(races, row.team.id, col.team.id);
      if (!rs.length) return `<td class="empty"></td>`;
      const scored = rs.filter((r) => r.winner);
      const wins = scored.filter((r) => r.winner === row.team.id).length;
      const cls = !scored.length ? "c-pending"
        : wins === scored.length ? "c-win"
        : wins === 0 ? "c-loss" : "c-split";
      return `<td class="${cls}">${rs.map((r) => chip(r, row.team.id, byId)).join("")}</td>`;
    }).join("");
    return `<tr>
      <th class="row" scope="row"><span class="rk">${row.rank}</span><span class="sh">${esc(row.team.short)}</span>
        <span class="nm">${esc(row.team.name)}</span></th>
      ${cells}
      <td class="rec"><b>${row.w}–${row.l}</b></td>
    </tr>`;
  }).join("");

  return `<div class="scroll"><table class="tr-grid">
    <thead><tr><th class="corner" scope="col">Team</th>${head}<th class="rec" scope="col">W–L</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

export function renderRankings(teams, races) {
  const rows = standings(teams, races).map((r) => `<tr>
      <td class="num">${r.tied ? "T" : ""}${r.rank}</td>
      <td><span class="sh">${esc(r.team.short)}</span> ${esc(r.team.name)}</td>
      <td class="muted">${esc(sailorNames(r.team))}</td>
      <td class="num">${r.w}</td>
      <td class="num">${r.l}</td>
      <td class="num">${pct(r)}</td>
      <td class="num muted">${r.pending || ""}</td>
    </tr>`).join("");
  return `<div class="scroll"><table class="data rankings">
    <thead><tr><th class="num">#</th><th>Team</th><th>Sailors</th><th class="num">W</th><th class="num">L</th>
      <th class="num">Win %</th><th class="num">To score</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}
