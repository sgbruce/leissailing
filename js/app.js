import * as store from "./data.js";
import { SITE_NAME } from "./config.js";
import { esc, fmtDate, todayIso, autoShort, sailorNames, USERNAME_RE } from "./util.js";
import { standings, renderGrid, renderRankings } from "./grid.js";

const $app = document.getElementById("app");
document.title = SITE_NAME;

const state = {
  authReady: false,
  user: null,            // { username, displayName, approved, isAdmin }
  route: { page: "home" },
  events: null,          // events page list
  event: undefined,      // undefined = loading, null = not found
  teams: [],
  races: [],
  loadError: null,
  flash: null,
  afterLogin: "#/events",
};

// ---------- subscriptions ----------

let unsubs = [];
let subKey = null;

const PROTECTED = new Set(["events", "event"]);
const needsSignIn = (route) => PROTECTED.has(route.page);

function stopSubs() {
  unsubs.forEach((u) => u());
  unsubs = [];
  subKey = null;
}

// Event data is only readable by approved accounts, so nothing is loaded until then.
function subscribe(route) {
  const key = !state.user?.approved || !needsSignIn(route) ? "none"
    : route.page === "event" ? `e:${route.id}` : "events";
  if (key === subKey) return;
  stopSubs();
  subKey = key;
  state.loadError = null;
  state.events = null;
  state.event = undefined; state.teams = []; state.races = [];
  const onErr = (e) => { state.loadError = e?.message || String(e); render(); };

  if (key === "events") {
    unsubs.push(store.watchEvents((evs) => { state.events = evs; render(); }, onErr));
  } else if (key.startsWith("e:")) {
    unsubs.push(store.watchEvent(route.id, (ev) => { state.event = ev; render(); }, onErr));
    unsubs.push(store.watchTeams(route.id, (ts) => {
      state.teams = ts.sort((a, b) => a.name.localeCompare(b.name)); render();
    }, onErr));
    unsubs.push(store.watchRaces(route.id, (rs) => {
      state.races = rs.sort((a, b) => a.number - b.number); render();
    }, onErr));
  }
}

// ---------- routing ----------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "login") return { page: "login" };
  if (parts[0] === "events") return { page: "events" };
  if (parts[0] === "e" && parts[1]) return { page: "event", id: parts[1], tab: parts[2] || "grid" };
  return { page: "home" };
}

function onRoute() {
  state.route = parseRoute();
  state.flash = null;
  subscribe(state.route);
  render();
  window.scrollTo(0, 0);
}

// ---------- permissions ----------

const me = () => state.user?.username;
const isAdmin = () => !!state.user?.isAdmin;
const isMember = () => !!me() && !!state.event?.members?.includes(me());
const canAdd = () => isMember() || isAdmin();
const canScore = (race) => isAdmin() || (!!me() && race.participants?.includes(me()));
const canDelete = (race) => isAdmin() || (race.createdBy === me() && !race.winner);

// ---------- rendering ----------

let flashTimer;
function flash(type, msg) {
  state.flash = { type, msg };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { state.flash = null; render(); }, type === "error" ? 8000 : 4000);
  render();
}

// Re-render the page, keeping anything the person has typed into a form
// (live data updates arrive while people are filling in forms).
function render() {
  const saved = {};
  $app.querySelectorAll("input[id], select[id], textarea[id]").forEach((el) => {
    if (el.tagName === "SELECT") {
      const def = [...el.options].find((o) => o.defaultSelected)?.value ?? el.options[0]?.value;
      if (el.value !== def) saved[el.id] = el.value;
    } else if (el.value !== el.defaultValue) {
      saved[el.id] = el.value;
    }
  });
  const active = document.activeElement;
  const focusId = active && $app.contains(active) ? active.id : null;
  let caret = null;
  try { caret = [active.selectionStart, active.selectionEnd]; } catch { /* not a text field */ }

  $app.innerHTML = layout(view());

  for (const [id, v] of Object.entries(saved)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
    el.value = v;
  }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      try { if (caret && caret[0] != null) el.setSelectionRange(caret[0], caret[1]); } catch { /* ignore */ }
    }
  }
}

function layout(inner) {
  const u = state.user;
  const who = !state.authReady ? ""
    : u ? `<span class="who">${esc(u.displayName)} <span class="handle">@${esc(u.username)}</span>${u.isAdmin ? ' <span class="badge">admin</span>' : ""}</span>
           <button class="linklike" data-action="signout">Sign out</button>`
      : `<a href="#/login">Sign in</a>`;
  const f = state.flash ? `<div class="flash ${state.flash.type}" role="status">${esc(state.flash.msg)}</div>` : "";
  const err = state.loadError ? `<div class="flash error">Couldn't load data: ${esc(state.loadError)}</div>` : "";
  return `
    <header class="site-header">
      <div class="wrap head-row">
        <a class="brand" href="#/">${burgee()}<span>${esc(SITE_NAME)}</span></a>
        <nav class="top-nav"><a href="#/events">Events</a>${who}</nav>
      </div>
    </header>
    <main class="wrap">${f}${err}${inner}</main>
    <footer class="site-footer"><div class="wrap">Live team racing results</div></footer>`;
}

const burgee = () => `<svg class="burgee" viewBox="0 0 28 20" aria-hidden="true">
  <rect x="1" y="0" width="2" height="20" rx="1"/><path d="M3 1 L27 6.5 L3 12 Z"/></svg>`;

function view() {
  if (!store.configured) return setupView();
  if (needsSignIn(state.route)) {
    if (!state.authReady) return `<p class="muted">Loading…</p>`;
    if (!state.user) return loginView("Sign in to see events and results.");
    if (!state.user.approved) return inviteView();
  }
  switch (state.route.page) {
    case "login": return loginView();
    case "events": return eventsView();
    case "event": return eventView();
    default: return homeView();
  }
}

function setupView() {
  return `<section class="panel">
    <h1 class="page-title">Almost there</h1>
    <p>Paste your Firebase project's config into <code>js/config.js</code>, then reload. The README walks through it.</p>
  </section>`;
}

// ----- home (public: no event or personal data here) -----

function homeView() {
  const signedIn = state.authReady && state.user;
  const cta = !state.authReady ? ""
    : signedIn && !state.user.approved ? `<a class="button" href="#/events">Enter your invite code</a>`
    : signedIn ? `<a class="button" href="#/events">View events</a>`
    : `<a class="button" href="#/login">Sign in</a> <a class="button ghost" href="#/login">Create an account</a>`;
  return `<section class="hero">
      <h1>${esc(SITE_NAME)}</h1>
      <p class="lede">Live results for team racing. Set up an event, add teams of one or two sailors,
        and follow every matchup on a round-robin grid as results come in.</p>
      <div class="cta">${cta}</div>
    </section>
    <div class="features">
      <section class="panel"><h2>Round-robin grid</h2><p>Every team against every other team, with wins, losses and rematches in one view.</p></section>
      <section class="panel"><h2>Score from the dock</h2><p>Sailors enter results for their own races. Admins can fix any result.</p></section>
      <section class="panel"><h2>Members only</h2><p>Signing up needs an invite code. Events, teams and results are visible only to members.</p></section>
    </div>`;
}

// ----- events list (signed in) -----

function eventsView() {
  const evs = state.events;
  const list = evs === null ? `<p class="muted">Loading…</p>`
    : !evs.length ? `<p class="muted">No events yet.</p>`
    : `<div class="scroll"><table class="data events">
        <thead><tr><th>Event</th><th>Venue</th><th>Date</th><th>Organizer</th></tr></thead>
        <tbody>${evs.map((e) => `<tr>
          <td><a href="#/e/${encodeURIComponent(e.id)}">${esc(e.name)}</a></td>
          <td>${esc(e.venue)}</td>
          <td class="nowrap">${esc(fmtDate(e.startDate))}</td>
          <td class="muted">@${esc(e.createdBy)}</td></tr>`).join("")}</tbody>
      </table></div>`;

  const create = !state.authReady ? ""
    : state.user ? `<section class="panel">
        <h2>New event</h2>
        <form data-form="createEvent" class="form-grid">
          <label>Event name<input id="ev-name" required maxlength="100" placeholder="Fall Team Race"></label>
          <label>Venue<input id="ev-venue" maxlength="100" placeholder="Optional"></label>
          <label>Date<input id="ev-date" type="date" required value="${todayIso()}"></label>
          <div class="actions"><button type="submit">Create event</button></div>
        </form>
        <p class="hint">You'll be a member of any event you create, so you can add teams and races to it.</p>
      </section>`
    : "";

  return `<h1 class="page-title">Events</h1>${list}${create}`;
}

// ----- login -----

function loginView(message) {
  if (state.user) {
    return `<section class="panel"><p>You're signed in as <b>@${esc(me())}</b>.</p><p><a href="#/events">Go to events</a></p></section>`;
  }
  return `<h1 class="page-title">Sign in</h1>
    ${message ? `<p class="note">${esc(message)}</p>` : ""}
    <div class="two-col">
      <section class="panel">
        <h2>Sign in</h2>
        <form data-form="signIn" class="form-stack">
          <label>Username<input id="li-user" autocomplete="username" required autocapitalize="none"></label>
          <label>Password<input id="li-pass" type="password" autocomplete="current-password" required></label>
          <div class="actions"><button type="submit">Sign in</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Create an account</h2>
        <form data-form="signUp" class="form-stack">
          <label>Username<input id="su-user" autocomplete="username" required autocapitalize="none"
            pattern="[a-z0-9_\\-]{3,24}" placeholder="3–24 lowercase letters, numbers, - or _"></label>
          <label>Your name<input id="su-name" required maxlength="60" placeholder="Shown next to your username"></label>
          <label>Password<input id="su-pass" type="password" autocomplete="new-password" required minlength="6"></label>
          <label>Confirm password<input id="su-pass2" type="password" autocomplete="new-password" required minlength="6"></label>
          <label>Invite code<input id="su-code" required autocapitalize="none" autocomplete="off" spellcheck="false"></label>
          <div class="actions"><button type="submit">Create account</button></div>
        </form>
        <p class="hint">Teammates add you to a team by your username. There's no email reset, so if you forget your password, ask an admin to delete your login in Firebase and sign up again with the same username.</p>
      </section>
    </div>`;
}

// ----- invite code (signed in, not yet approved) -----

function inviteView() {
  return `<h1 class="page-title">Enter your invite code</h1>
    <section class="panel">
      <p>Your account <b>@${esc(me())}</b> needs an invite code before you can see events.</p>
      <form data-form="redeem" class="form-grid">
        <label>Invite code<input id="rc-code" required autocapitalize="none" autocomplete="off" spellcheck="false"></label>
        <div class="actions"><button type="submit">Continue</button></div>
      </form>
    </section>`;
}

// ----- event -----

const TABS = [["grid", "Grid"], ["rankings", "Rankings"], ["races", "Races"], ["teams", "Teams"]];

function eventView() {
  const ev = state.event;
  if (ev === undefined) return `<p class="muted">Loading…</p>`;
  if (ev === null) return `<section class="panel"><h1 class="page-title">Event not found</h1><p><a href="#/events">Back to events</a></p></section>`;

  const { tab } = state.route;
  const scored = state.races.filter((r) => r.winner);
  const last = scored.length ? Math.max(...scored.map((r) => r.number)) : null;
  const base = `#/e/${encodeURIComponent(ev.id)}`;
  const body = tab === "rankings" ? rankingsTab()
    : tab === "races" ? racesTab()
    : tab === "teams" ? teamsTab()
    : gridTab();

  return `
    <section class="regatta-head">
      <h1>${esc(ev.name)}</h1>
      <table class="details"><tbody>
        ${ev.venue ? `<tr><th>Venue</th><td>${esc(ev.venue)}</td></tr>` : ""}
        <tr><th>Date</th><td>${esc(fmtDate(ev.startDate))}</td></tr>
        <tr><th>Scoring</th><td>Team racing · round robin</td></tr>
        <tr><th>Teams</th><td>${state.teams.length}</td></tr>
        <tr><th>Status</th><td>${scored.length} of ${state.races.length} races scored${last ? ` · last scored: race ${last}` : ""}</td></tr>
      </tbody></table>
    </section>
    <nav class="tabs" aria-label="Event pages">
      ${TABS.map(([k, label]) => `<a href="${base}/${k}" class="${tab === k || (k === "grid" && !TABS.some(([t]) => t === tab)) ? "active" : ""}">${label}</a>`).join("")}
    </nav>
    <section class="tab-body">${body}</section>`;
}

function roleNote() {
  if (!state.authReady) return "";
  if (!state.user) return `<p class="note"><a href="#/login">Sign in</a> to add teams or report results.</p>`;
  if (isAdmin()) return `<p class="note">You're an admin, so you can enter results for any race.</p>`;
  if (isMember()) return "";
  return `<p class="note">Only people in this event can add teams and races. Ask someone in it to add you to a team, or to add you as a sailor.</p>`;
}

function gridTab() {
  if (!state.teams.length) {
    return `<p class="muted">No teams yet. <a href="#/e/${encodeURIComponent(state.event.id)}/teams">Add teams</a> to start the grid.</p>`;
  }
  return `${renderGrid(state.teams, state.races)}
    <p class="legend">
      <span class="chip win"><b>W</b>4</span> won race 4
      <span class="chip loss"><b>L</b>7</span> lost race 7
      <span class="chip pending">9</span> race 9, not scored yet
      <span class="legend-sep">·</span> Read each row as that team against the team in the column. Rematches appear side by side in one cell.
    </p>`;
}

function rankingsTab() {
  if (!state.teams.length) return `<p class="muted">No teams yet.</p>`;
  return `${renderRankings(state.teams, state.races)}
    <p class="hint">Ranked by win percentage, then total wins, then head-to-head wins among tied teams.</p>`;
}

function teamOptions(selected) {
  return `<option value="">Choose a team</option>` + state.teams.map((t) =>
    `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.short)} · ${esc(t.name)}</option>`).join("");
}

function racesTab() {
  const byId = new Map(state.teams.map((t) => [t.id, t]));
  const next = state.races.length ? Math.max(...state.races.map((r) => r.number)) + 1 : 1;
  const label = (id) => { const t = byId.get(id); return t ? `<span class="sh">${esc(t.short)}</span> ${esc(t.name)}` : `<span class="muted">(removed team)</span>`; };

  const form = !canAdd() ? "" : state.teams.length < 2
    ? `<p class="muted">Add at least two teams before adding races.</p>`
    : `<section class="panel">
        <h2>Add a race</h2>
        <form data-form="addRace" class="form-grid race-form">
          <label class="narrow">Race #<input id="r-num" type="number" min="1" step="1" required value="${next}"></label>
          <label>Team<select id="r-a" required>${teamOptions()}</select></label>
          <span class="vs">vs</span>
          <label>Team<select id="r-b" required>${teamOptions()}</select></label>
          <label>Result<select id="r-res">
            <option value="" selected>Not sailed yet</option>
            <option value="A">First team won</option>
            <option value="B">Second team won</option>
          </select></label>
          <label class="wide">Note<input id="r-note" maxlength="200" placeholder="Optional, e.g. protest upheld"></label>
          <div class="actions"><button type="submit">Add race</button></div>
        </form>
        <p class="hint">Teams can meet more than once: each race gets its own number and shows up in the same grid cell. You can enter a result here only if you sailed in the race.</p>
      </section>`;

  const mine = me() ? state.races.filter((r) => !r.winner && r.participants?.includes(me())) : [];
  const waiting = !mine.length ? "" : `<section class="panel callout">
      <h2>Waiting on your result</h2>
      <ul class="plain">${mine.map((r) => `<li>
        <span><b>Race ${r.number}:</b> ${label(r.teamA)} <span class="muted">vs</span> ${label(r.teamB)}</span>
        <span class="btns">${scoreButtons(r, byId)}</span></li>`).join("")}</ul>
    </section>`;

  const rows = state.races.map((r) => {
    const a = r.winner === r.teamA ? "won" : r.winner === r.teamB ? "lost" : "";
    const b = r.winner === r.teamB ? "won" : r.winner === r.teamA ? "lost" : "";
    const actions = [canScore(r) ? scoreButtons(r, byId) : "",
      canDelete(r) ? `<button class="small danger" data-action="delete" data-race="${esc(r.id)}">Delete</button>` : ""].join(" ");
    return `<tr>
      <td class="num"><b>${r.number}</b></td>
      <td class="${a}">${label(r.teamA)}</td>
      <td class="${b}">${label(r.teamB)}</td>
      <td>${r.winner ? `<b>${esc(byId.get(r.winner)?.short ?? "?")}</b> won` : `<span class="muted">not scored</span>`}</td>
      <td class="muted">${esc(r.note)}</td>
      <td class="muted nowrap">${r.updatedBy ? `@${esc(r.updatedBy)}` : ""}</td>
      <td class="nowrap">${actions}</td>
    </tr>`;
  }).join("");

  const table = !state.races.length ? `<p class="muted">No races yet.</p>`
    : `<div class="scroll"><table class="data races">
        <thead><tr><th class="num">Race</th><th>Team</th><th>Team</th><th>Result</th><th>Note</th><th>Scored by</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

  return `${roleNote()}${waiting}${form}<h2 class="section-title">All races</h2>${table}`;
}

function scoreButtons(r, byId) {
  const btn = (teamId) => {
    const t = byId.get(teamId);
    const on = r.winner === teamId;
    return `<button class="small${on ? " on" : ""}" data-action="score" data-race="${esc(r.id)}" data-team="${esc(teamId)}"
      ${on ? "disabled" : ""} title="${esc(t?.name)} won">${esc(t?.short ?? "?")} won</button>`;
  };
  return `${btn(r.teamA)}${btn(r.teamB)}${r.winner ? `<button class="small ghost" data-action="score" data-race="${esc(r.id)}" data-team="">Clear</button>` : ""}`;
}

function teamsTab() {
  const recs = new Map(standings(state.teams, state.races).map((r) => [r.team.id, r]));
  const sailor = (s) => `${esc(s.name)}${s.username ? ` <span class="handle">@${esc(s.username)}</span>` : ""}`;
  const table = !state.teams.length ? `<p class="muted">No teams yet.</p>`
    : `<div class="scroll"><table class="data teams">
        <thead><tr><th>Short</th><th>Team</th><th>Sailors</th><th class="num">W–L</th></tr></thead>
        <tbody>${state.teams.map((t) => {
          const r = recs.get(t.id);
          return `<tr><td><span class="sh">${esc(t.short)}</span></td><td>${esc(t.name)}</td>
            <td>${(t.sailors || []).map(sailor).join("<br>")}</td>
            <td class="num">${r ? `${r.w}–${r.l}` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>`;

  const form = !canAdd() ? "" : `<section class="panel">
      <h2>Add a team</h2>
      <form data-form="addTeam" class="form-grid team-form">
        <label class="wide">Team name<input id="tm-name" required maxlength="60" placeholder="e.g. Sam & Alex"></label>
        <label class="narrow">Short name<input id="tm-short" maxlength="6" placeholder="Auto"></label>
        <fieldset><legend>Sailor 1</legend>
          <label>Name<input id="s1-name" required maxlength="60"></label>
          <label>Username<input id="s1-user" maxlength="24" autocapitalize="none" placeholder="Optional"></label>
        </fieldset>
        <fieldset><legend>Sailor 2 <span class="muted">(optional)</span></legend>
          <label>Name<input id="s2-name" maxlength="60"></label>
          <label>Username<input id="s2-user" maxlength="24" autocapitalize="none" placeholder="Optional"></label>
        </fieldset>
        <div class="actions"><button type="submit">Add team</button></div>
      </form>
      <p class="hint">Sailors with a username become part of this event: they can add teams and races, and enter results for their own team's races. A username can be added before that person signs up.</p>
    </section>`;

  return `${roleNote()}${table}${form}`;
}

// ---------- actions ----------

// From the sign-in page, go where the person was headed. From a page that
// asked them to sign in, just stay: it fills in once signed in.
function afterSignIn() {
  if (state.route.page === "login") location.hash = state.afterLogin || "#/events";
}

// Live updates can re-render the page while a save is in flight, so reset
// whichever copy of the form is on the page now.
const resetForm = (name) => document.querySelector(`form[data-form="${name}"]`)?.reset();

const val = (id) => (document.getElementById(id)?.value ?? "").trim();

function authMessage(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Wrong username or password.";
  if (code.includes("email-already-in-use")) return "That username is taken.";
  if (code.includes("weak-password")) return "Use a password of at least 6 characters.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a minute and try again.";
  if (code === "app/bad-invite") return "That invite code isn't right.";
  if (code.includes("permission-denied")) return "You don't have permission to do that.";
  return e?.message || String(e);
}

async function busy(form, fn) {
  const btn = form?.querySelector("button[type=submit]");
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); flash("error", authMessage(e)); } finally { if (btn) btn.disabled = false; }
}

const forms = {
  async signIn(f) {
    const u = val("li-user").toLowerCase();
    await busy(f, async () => {
      await store.signIn(u, document.getElementById("li-pass").value);
      afterSignIn();
    });
  },

  async signUp(f) {
    const u = val("su-user").toLowerCase(), name = val("su-name");
    const p1 = document.getElementById("su-pass").value, p2 = document.getElementById("su-pass2").value;
    const code = val("su-code");
    if (!USERNAME_RE.test(u)) return flash("error", "Usernames are 3–24 lowercase letters, numbers, - or _.");
    if (p1 !== p2) return flash("error", "Passwords don't match.");
    await busy(f, async () => {
      state.pendingName = { username: u, name };
      await store.signUp(u, name, p1, code);
      if (state.user?.username === u) { state.user.displayName = name; render(); }
      afterSignIn();
    });
  },

  async redeem(f) {
    await busy(f, async () => {
      await store.redeemInvite(me(), state.user.displayName, val("rc-code"));
    });
  },

  async createEvent(f) {
    await busy(f, async () => {
      const id = await store.createEvent({ name: val("ev-name"), venue: val("ev-venue"), startDate: val("ev-date") }, me());
      location.hash = `#/e/${encodeURIComponent(id)}/teams`;
    });
  },

  async addTeam(f) {
    const name = val("tm-name");
    const short = (val("tm-short") || autoShort(name)).toUpperCase().slice(0, 6) || "T";
    const sailors = [];
    for (const n of ["s1", "s2"]) {
      const username = val(`${n}-user`).replace(/^@/, "").toLowerCase();
      const sname = val(`${n}-name`) || username;
      if (!sname) continue;
      if (username && !USERNAME_RE.test(username)) return flash("error", `"${username}" isn't a valid username.`);
      sailors.push({ name: sname, username: username || null });
    }
    if (!sailors.length) return flash("error", "Add at least one sailor.");
    const usernames = [...new Set(sailors.map((s) => s.username).filter(Boolean))];
    if (usernames.length < sailors.filter((s) => s.username).length) return flash("error", "The two sailors have the same username.");
    for (const u of usernames) {
      const other = state.teams.find((t) => t.usernames?.includes(u));
      if (other) return flash("error", `@${u} is already on ${other.name}.`);
    }
    if (state.teams.some((t) => t.short === short)) return flash("error", `Another team already uses the short name ${short}. Pick a different one.`);
    const newMembers = usernames.filter((u) => !state.event.members.includes(u));
    await busy(f, async () => {
      await store.addTeam(state.event.id, { name, short, sailors, usernames }, newMembers, me());
      resetForm("addTeam");
      flash("ok", `Added ${name}.`);
    });
  },

  async addRace(f) {
    const number = Number(val("r-num"));
    const teamA = val("r-a"), teamB = val("r-b"), res = val("r-res"), note = val("r-note");
    if (!Number.isInteger(number) || number < 1) return flash("error", "Race number must be a whole number.");
    if (!teamA || !teamB) return flash("error", "Choose both teams.");
    if (teamA === teamB) return flash("error", "A team can't race itself.");
    if (state.races.some((r) => r.number === number)) return flash("error", `There's already a race ${number}.`);
    const A = state.teams.find((t) => t.id === teamA), B = state.teams.find((t) => t.id === teamB);
    const participants = [...(A.usernames || []), ...(B.usernames || [])];
    const winner = res === "A" ? teamA : res === "B" ? teamB : null;
    if (winner && !isAdmin() && !participants.includes(me())) {
      return flash("error", "You can only enter a result for a race you sailed in. Add it as not sailed yet, and someone in it can score it.");
    }
    await busy(f, async () => {
      await store.addRace(state.event.id, { number, teamA, teamB, winner, participants, note }, me());
      resetForm("addRace");
      flash("ok", `Added race ${number}.`);
    });
  },
};

const actions = {
  async signout() {
    stopSubs();
    state.afterLogin = "#/events";
    await store.signOutUser();
    location.hash = "#/";
    flash("ok", "Signed out.");
  },
  async score(el) {
    const winner = el.dataset.team || null;
    el.disabled = true;
    try { await store.setResult(state.event.id, el.dataset.race, winner, me()); }
    catch (e) { console.error(e); flash("error", authMessage(e)); el.disabled = false; }
  },
  async delete(el) {
    const r = state.races.find((x) => x.id === el.dataset.race);
    if (!r || !confirm(`Delete race ${r.number}?`)) return;
    try { await store.deleteRace(state.event.id, r.id); flash("ok", `Deleted race ${r.number}.`); }
    catch (e) { console.error(e); flash("error", authMessage(e)); }
  },
};

$app.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(f);
});

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el);
});

// Keep the race form from offering the same team on both sides.
$app.addEventListener("change", (e) => {
  if (e.target.id !== "r-a" && e.target.id !== "r-b") return;
  const a = document.getElementById("r-a"), b = document.getElementById("r-b");
  for (const [sel, other] of [[a, b], [b, a]]) {
    [...sel.options].forEach((o) => { o.disabled = !!o.value && o.value === other.value; });
  }
});

// ---------- start ----------

window.addEventListener("hashchange", () => {
  const r = parseRoute();
  if (r.page !== "login" && r.page !== "home") state.afterLogin = location.hash;
  onRoute();
});

if (store.configured) {
  store.watchAuth((user) => {
    // A brand-new account's display name is saved just after sign-in fires.
    if (user && state.pendingName?.username === user.username) user.displayName = state.pendingName.name;
    state.user = user;
    state.authReady = true;
    if (!user) stopSubs();
    subscribe(state.route);
    render();
  });
}
onRoute();
