import { SITE_NAME } from "./config.js";
import {
  esc, todayIso, autoShort, USERNAME_RE, fmtShortDate, fmtLongDate, fmtStamp, seasonOf, burgee,
} from "./util.js";
import { standings, eventSummary, renderReport, renderRankingSummary, renderGrid, renderAllRaces } from "./grid.js";

// ?demo uses sample data kept in this browser instead of Firebase.
const DEMO = new URLSearchParams(location.search).has("demo");
const store = DEMO ? await import("./demo.js") : await import("./data.js");

const $app = document.getElementById("app");
document.title = SITE_NAME;

const state = {
  authReady: false,
  user: null,            // { username, displayName, approved, isAdmin }
  route: { page: "home" },
  events: null,          // every event, for the home, season and schedule pages
  event: undefined,      // undefined = loading, null = not found
  teams: [],
  races: [],
  loaded: { teams: false, races: false },
  loadError: null,
  flash: null,
  stamp: new Date(),     // when data last arrived, shown at the top of the page
  afterLogin: "#/events",
};

// ---------- subscriptions ----------

let unsubs = [];
let subKey = null;

const PROTECTED = new Set(["events", "schedule", "seasons", "season", "event"]);
const needsSignIn = (route) => PROTECTED.has(route.page);

function stopSubs() {
  unsubs.forEach((u) => u());
  unsubs = [];
  subKey = null;
}

// Event data is only readable by approved accounts, so nothing is loaded until then.
// The home page lists events too, once someone approved is signed in.
function subscribe(route) {
  const wantsEvents = needsSignIn(route) || route.page === "home";
  const key = !state.user?.approved || !wantsEvents ? "none"
    : route.page === "event" ? `e:${route.id}` : "events";
  if (key === subKey) return;
  stopSubs();
  subKey = key;
  state.loadError = null;
  state.events = null;
  state.event = undefined; state.teams = []; state.races = [];
  state.loaded = { teams: false, races: false };
  const onErr = (e) => { state.loadError = e?.message || String(e); render(); };
  const got = () => { state.stamp = new Date(); };

  if (key === "events") {
    unsubs.push(store.watchEvents((evs) => { state.events = evs; got(); render(); }, onErr));
  } else if (key.startsWith("e:")) {
    unsubs.push(store.watchEvent(route.id, (ev) => { state.event = ev; got(); syncSummary(); render(); }, onErr));
    unsubs.push(store.watchTeams(route.id, (ts) => {
      state.teams = ts.sort((a, b) => a.name.localeCompare(b.name));
      state.loaded.teams = true; got(); syncSummary(); render();
    }, onErr));
    unsubs.push(store.watchRaces(route.id, (rs) => {
      state.races = rs.sort((a, b) => a.number - b.number);
      state.loaded.races = true; got(); syncSummary(); render();
    }, onErr));
  }
}

// Keep the event's stored results summary (shown on the home and season
// pages) in step with its races. Anyone in the event can write it.
let summaryTimer;
const summaryFailed = new Set();
const sameSummary = (a, b) => !!a && !!b
  && ["teams", "races", "scored", "last"].every((k) => (a[k] ?? null) === (b[k] ?? null))
  && (a.leader?.name ?? null) === (b.leader?.name ?? null)
  && (a.leader?.short ?? null) === (b.leader?.short ?? null);

function syncSummary() {
  const ev = state.event;
  if (!ev || !state.loaded.teams || !state.loaded.races || !canAdd() || summaryFailed.has(ev.id)) return;
  const s = eventSummary(state.teams, state.races);
  if (sameSummary(s, ev.summary)) return;
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    store.updateSummary(ev.id, s).catch((e) => {
      summaryFailed.add(ev.id);
      console.warn("Couldn't save the event's results summary. Republish firestore.rules to allow it.", e);
    });
  }, 600);
}

// ---------- routing ----------

const LEGACY_TABS = { grid: "full-scores", rankings: "report", races: "all", teams: "scoring" };
const EVENT_PAGES = ["report", "full-scores", "sailors", "all", "scoring"];

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "login") return { page: "login" };
  if (parts[0] === "events") return { page: "season", id: seasonOf(todayIso()).id };
  if (parts[0] === "schedule") return { page: "schedule" };
  if (parts[0] === "seasons") return { page: "seasons" };
  if (parts[0] === "season" && parts[1]) return { page: "season", id: parts[1] };
  if (parts[0] === "e" && parts[1]) {
    let tab = LEGACY_TABS[parts[2]] || parts[2] || "report";
    if (!EVENT_PAGES.includes(tab)) tab = "report";
    return { page: "event", id: parts[1], tab, team: parts[3] || null };
  }
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

// The menu has the logo in its middle, as on Techscore. Inside an event it
// switches to that event's pages.
function menuItems() {
  const ev = state.route.page === "event" && state.event ? state.event : null;
  const link = (href, label, current) => ({ href, label, current });
  if (ev) {
    const base = `#/e/${encodeURIComponent(ev.id)}`;
    const season = seasonOf(ev.startDate);
    const tab = state.route.tab;
    return [
      link("#/", "Home"),
      link(`#/season/${season.id}`, season.name),
      link(base, "Report", tab === "report"),
      link(`${base}/full-scores`, "Full Scores", tab === "full-scores"),
      link(`${base}/sailors`, "Sailors", tab === "sailors"),
      link(`${base}/all`, "All Races", tab === "all"),
      link(`${base}/scoring`, "Scoring", tab === "scoring"),
    ];
  }
  const season = seasonOf(todayIso());
  const page = state.route.page;
  const signedIn = state.authReady && state.user;
  return [
    link("#/", "Home", page === "home"),
    link("#/seasons", "Seasons", page === "seasons"),
    link("#/schedule", "Schedule", page === "schedule"),
    link(`#/season/${season.id}`, season.name, page === "season" && state.route.id === season.id),
    signedIn ? { action: "signout", label: "Sign out" } : link("#/login", "Sign in", page === "login"),
  ];
}

function layout(inner) {
  const u = state.user;
  const items = menuItems().map((it) => it.action
    ? `<li><a href="#/" data-action="${it.action}">${esc(it.label)}</a></li>`
    : `<li><a href="${it.href}"${it.current ? ' aria-current="page"' : ""}>${esc(it.label)}</a></li>`);
  items.splice(Math.ceil(items.length / 2), 0, `<li id="logo"><a href="#/" title="${esc(SITE_NAME)} home">${logo()}</a></li>`);

  const who = !state.authReady ? ""
    : u ? `<span class="who">${esc(u.displayName)} <span class="handle">@${esc(u.username)}</span>${u.isAdmin ? ' <span class="badge">admin</span>' : ""}</span>
           · <a href="#/" data-action="signout">Sign out</a>`
      : `<a href="#/login">Sign in</a> · <a href="#/login">Create an account</a>`;
  const demoFlag = DEMO ? `<span class="demo-flag" title="Sample data kept in this browser. Nothing is saved to Firebase.">Demo data · <a href="?demo=reset${esc(location.hash)}">reset</a></span>` : "";
  const f = state.flash ? `<div class="${state.flash.type === "error" ? "notice" : "message"} flash" role="status">${esc(state.flash.msg)}</div>` : "";
  const err = state.loadError ? `<div class="notice flash">Couldn't load data: ${esc(state.loadError)}</div>` : "";

  return `
    <div id="page-header">
      <div id="top-wrapper">
        <div id="last_updated">${esc(fmtStamp(state.stamp))}</div>
        <div id="social">${demoFlag}</div>
        <div id="account">${who}</div>
      </div>
      <div id="menu-wrapper"><ul id="menu">${items.join("")}</ul></div>
    </div>
    <div id="page-content">${f || err ? `<div class="flash-wrap">${f}${err}</div>` : ""}${inner}</div>
    <div id="page-footer">
      <h3>${esc(SITE_NAME)}</h3>
      <address>Live results from leis nights · Scores update as sailors enter them</address>
    </div>`;
}

// A white flag on a staff with a red pennant: this site's logo.
const logo = () => `<svg class="logo" viewBox="0 0 145 92" width="145" height="92" aria-hidden="true">
  <defs><linearGradient id="lg-cloth" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e7e7e7"/></linearGradient></defs>
  <g transform="rotate(-12 40 50)">
    <rect x="30" y="8" width="4" height="84" rx="1.5" fill="#8a8a8a"/>
    <path d="M34 12 C60 8 80 16 104 12 L104 52 C80 56 60 48 34 52 Z" fill="url(#lg-cloth)" stroke="#bbb"/>
    <path d="M104 12 L140 30 L104 46 Z" fill="#c8312b"/>
    <path d="M78 13.5 C88 14.5 96 13 104 12 L104 52 C96 53 88 54.5 78 53.5 Z" fill="#c8312b"/>
    <circle cx="56" cy="32" r="12" fill="none" stroke="#1d3f73" stroke-width="5"/>
    <text x="56" y="38" text-anchor="middle" font-family="Georgia, serif" font-size="17" font-weight="bold" fill="#1d3f73">${esc(SITE_NAME.charAt(0).toUpperCase())}</text>
  </g>
</svg>`;

// Techscore's boxed page title with the ring-and-rule ornaments either side,
// and a key/value list under it.
function contentHeader(title, info = []) {
  const rows = info.filter(Boolean).map(([k, v]) =>
    `<li><span class="page-info-key">${esc(k)}</span><span class="page-info-value">${v}</span></li>`).join("");
  return `<div id="content-header">${ornamentTitle(title)}${rows ? `<ul id="page-info">${rows}</ul>` : ""}</div>`;
}
const ornamentTitle = (title) => `<h1><span class="left-fill"></span><span>${esc(title)}</span><span class="right-fill"></span></h1>`;
const port = (title, body, cls = "") => `<div class="port${cls ? ` ${cls}` : ""}">${title ? `<h3>${title}</h3>` : ""}${body}</div>`;
const loading = () => port("", `<p class="muted">Loading…</p>`);

function view() {
  if (!store.configured) return setupView();
  if (needsSignIn(state.route)) {
    if (!state.authReady) return loading();
    if (!state.user) return loginView("Sign in to see events and results.");
    if (!state.user.approved) return inviteView();
  }
  switch (state.route.page) {
    case "login": return loginView();
    case "schedule": return scheduleView();
    case "seasons": return seasonsView();
    case "season": return seasonView(state.route.id);
    case "event": return eventView();
    default: return homeView();
  }
}

function setupView() {
  return `${contentHeader("Almost there")}
    ${port("Setup", `<p>Paste your Firebase project's config into <code>js/config.js</code>, then reload. The README walks through it. To look around first, open this page with <a href="?demo">?demo</a> at the end of the address.</p>`)}`;
}

// ----- shared event lists -----

const today = () => todayIso();
const eventLink = (e) => `<a href="#/e/${encodeURIComponent(e.id)}">${esc(e.name)}</a>`;
const teamsLabel = (e) => (e.summary?.teams ? `${e.summary.teams} Teams` : "");

// "Final", the last race scored, or nothing yet.
function statusOf(e) {
  const s = e.summary;
  if (!s || !s.races || !s.scored) return { none: true };
  if (s.scored === s.races && e.startDate < today()) return { final: true };
  return { last: s.last };
}

function comingTable(events) {
  if (!events.length) return `<p class="muted center">Nothing scheduled.</p>`;
  return `<table class="coming-regattas">
    <thead><tr><th>Name</th><th>Host</th><th>Type</th><th>Scoring</th><th>Start date</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td>${eventLink(e)}</td><td>${esc(e.venue || "")}</td><td>Team Race</td><td>${esc(teamsLabel(e) || "Team")}</td>
      <td>${esc(fmtShortDate(e.startDate))}</td></tr>`).join("")}</tbody>
  </table>`;
}

// A season's leis nights, newest week first, each week under its own heading.
function seasonTable(events, { weeks = true } = {}) {
  if (!events.length) return `<p class="muted center">No leis nights yet.</p>`;
  const sorted = [...events].sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name));
  const rows = [];
  let lastWeek = null, i = 0;
  for (const e of sorted) {
    const wk = weeks ? weekOf(e, events) : null;
    if (weeks && wk !== lastWeek) { rows.push(`<tr><th colspan="7">Week ${wk}</th></tr>`); lastWeek = wk; i = 0; }
    const st = statusOf(e);
    rows.push(`<tr class="row${i++ % 2}">
      <td>${eventLink(e)}</td><td>${esc(e.venue || "")}</td><td>Team Race</td><td>${esc(teamsLabel(e))}</td>
      <td>${esc(fmtShortDate(e.startDate))}</td>
      <td>${st.final ? "<strong>Final</strong>" : st.none ? "" : `In progress: race ${st.last}`}</td>
      <td title="${esc(e.summary?.leader?.name || "")}">${!st.none && e.summary?.leader ? burgee(e.summary.leader) : ""}</td>
    </tr>`);
  }
  return `<table class="season-summary">
    <thead><tr><th>Name</th><th>Host</th><th>Type</th><th>Scoring</th><th>Start date</th><th>Status</th><th>Leading</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

// Week 1 is the week (Monday to Sunday) of the season's first event.
const mondayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
};
function weekOf(e, events) {
  const sid = seasonOf(e.startDate).id;
  const first = events.filter((x) => seasonOf(x.startDate).id === sid).map((x) => x.startDate).sort()[0];
  return Math.round((mondayOf(e.startDate) - mondayOf(first)) / (7 * 864e5)) + 1;
}

function seasonsOf(events) {
  const map = new Map();
  for (const e of events) {
    const s = seasonOf(e.startDate);
    if (!map.has(s.id)) map.set(s.id, { ...s, events: [] });
    map.get(s.id).events.push(e);
  }
  const cur = seasonOf(today());
  if (!map.has(cur.id)) map.set(cur.id, { ...cur, events: [] });
  return [...map.values()].sort((a, b) => b.sort.localeCompare(a.sort));
}

function otherSeasons() {
  if (!state.events) return "";
  const list = seasonsOf(state.events);
  return `<div id="submenu-wrapper"><ul id="other-seasons">
    ${list.map((s) => `<li><a href="#/season/${s.id}">${esc(s.name)}</a></li>`).join("")}
  </ul></div>`;
}

// ----- home (public: event data only once signed in and approved) -----

function homeView() {
  const u = state.authReady ? state.user : null;
  const approved = !!u?.approved;

  const welcome = `<div id="welcome">${ornamentTitle("Welcome")}<div>
      <p>Welcome to ${esc(SITE_NAME)}, the home for live results of our leis nights. Follow each event as scores come in, see every matchup on the round-robin grid, and keep up with the standings.</p>
      <p>Each leis night has a <b>report</b> with the current results and every team's sailors, <b>full scores</b> with the win–loss grid, and a list of <b>all races</b>. An archive of <a href="#/seasons">all previous seasons</a> is also available.</p>
      <p>Sailors can enter the result of any race they sail in, from the leis night's <b>scoring</b> page. Results update live for everyone watching.</p>
      <p>Results are for members. To follow an event, sign in with your account. New accounts need an invite code from an event organizer.</p>
    </div></div>`;

  let right;
  if (!state.authReady) {
    right = `<p class="muted">Loading…</p>`;
  } else if (!approved) {
    right = `<div class="signin-callout">
        <p>${u ? `Your account <b>@${esc(u.username)}</b> needs an invite code before you can see results.` : "Sign in to see the latest leis nights, standings and race-by-race results."}</p>
        <p class="actions">${u ? `<a class="button" href="#/events">Enter your invite code</a>` : `<a class="button" href="#/login">Sign in</a> <a class="button" href="#/login">Create an account</a>`}</p>
      </div>`;
  } else if (state.events === null) {
    right = `<p class="muted">Loading…</p>`;
  } else {
    const recent = state.events.filter((e) => e.startDate <= today()).slice(0, 12);
    right = !recent.length ? `<p class="muted">No leis nights yet. <a href="#/events">Create one</a>.</p>`
      : `<table class="season-summary"><thead><tr><th>Name</th><th>Host</th><th>Scoring</th><th>Status</th><th>Leading</th></tr></thead><tbody>
        ${recent.map((e, i) => {
          const st = statusOf(e);
          const status = st.none ? `<td colspan="2"><em>No scores yet</em></td>`
            : `<td><strong>${st.final ? "Final" : `Race ${st.last}`}</strong></td><td title="${esc(e.summary.leader?.name || "")}">${burgee(e.summary.leader)}</td>`;
          return `<tr class="row${i % 2}"><td>${eventLink(e)}</td><td>${esc(e.venue || "")}</td><td>${esc(teamsLabel(e))}</td>${status}</tr>`;
        }).join("")}
      </tbody></table>`;
  }

  const upcoming = approved && state.events
    ? port("Upcoming schedule", comingTable(state.events.filter((e) => e.startDate > today())
        .sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 10)))
    : "";

  return `<div id="message-container">${welcome}<div id="in-progress">${ornamentTitle("Recent leis nights")}${right}</div></div>
    ${upcoming}${approved ? otherSeasons() : ""}`;
}

// ----- seasons, schedule (signed in) -----

function seasonView(id) {
  if (state.events === null) return loading();
  const all = seasonsOf(state.events);
  const season = all.find((s) => s.id === id) || { ...seasonOf(today()), events: [] };
  const evs = season.events;
  const started = evs.filter((e) => e.startDate <= today());
  const coming = evs.filter((e) => e.startDate > today()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const weeks = new Set(started.map((e) => weekOf(e, evs))).size;
  const entries = evs.reduce((n, e) => n + (e.summary?.teams || 0), 0);

  const create = state.user ? port("New leis night", `<form data-form="createEvent" class="form-box">
      <div class="field"><label for="ev-name">Leis night name</label><input id="ev-name" required maxlength="100" placeholder="Tuesday Leis Night"></div>
      <div class="field"><label for="ev-venue">Host</label><input id="ev-venue" maxlength="100" placeholder="Optional"></div>
      <div class="field"><label for="ev-date">Start date</label><input id="ev-date" type="date" required value="${todayIso()}"></div>
      <div class="field"><span></span><span><button type="submit">Create leis night</button></span></div>
      <p class="hint">You'll be part of any leis night you create, so you can add teams and races to it.</p>
    </form>`) : "";

  return `${contentHeader(season.name, [
      ["Number of Weekends", weeks],
      ["Number of Leis Nights", evs.length],
      ["Number of Entries", entries],
    ])}
    ${coming.length ? port("Coming soon", comingTable(coming)) : ""}
    ${port("Season leis nights", seasonTable(started), "full")}
    ${create}
    ${otherSeasons()}`;
}

function seasonsView() {
  if (state.events === null) return loading();
  const cur = seasonOf(today()).id;
  return `${contentHeader("All Seasons", seasonsOf(state.events).map((s) => [s.name,
      `<a href="#/season/${s.id}">${s.events.length} ${s.events.length === 1 ? "leis night" : "leis nights"}${s.id === cur ? " (current)" : ""}</a>`]))}`;
}

function scheduleView() {
  if (state.events === null) return loading();
  const upcoming = state.events.filter((e) => e.startDate > today()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const todays = state.events.filter((e) => e.startDate === today());
  const past = state.events.filter((e) => e.startDate < today());
  return `${contentHeader("Schedule", [
      ["Today", todays.length ? todays.map(eventLink).join(", ") : "No leis nights"],
      ["Upcoming", upcoming.length],
      ["Past", past.length],
    ])}
    ${port("Coming soon", comingTable(upcoming))}
    ${port("Past leis nights", seasonTable([...todays, ...past], { weeks: false }), "full")}`;
}

// ----- login -----

function loginView(message) {
  if (state.user) {
    return `${contentHeader("Sign in")}${port("", `<p class="center">You're signed in as <b>@${esc(me())}</b>. <a href="#/events">Go to leis nights</a></p>`)}`;
  }
  const demoNote = DEMO ? `<p class="message">Demo mode: any username and password works. Try <b>sam</b> (sails in most events) or <b>admin</b>.</p>` : "";
  return `${message || demoNote ? `<div class="port">${message ? `<p class="notice">${esc(message)}</p>` : ""}${demoNote}</div>` : ""}
    <div id="message-container" class="login">
      <div id="welcome">${ornamentTitle("Sign in")}
        <form data-form="signIn" class="form-box plain">
          <div class="field"><label for="li-user">Username</label><input id="li-user" autocomplete="username" required autocapitalize="none"></div>
          <div class="field"><label for="li-pass">Password</label><input id="li-pass" type="password" autocomplete="current-password" required></div>
          <div class="field"><span></span><span><button type="submit">Sign in</button></span></div>
        </form>
      </div>
      <div id="in-progress">${ornamentTitle("New account")}
        <form data-form="signUp" class="form-box plain">
          <div class="field"><label for="su-user">Username</label><input id="su-user" autocomplete="username" required autocapitalize="none"
            pattern="[a-z0-9_\\-]{3,24}" placeholder="3–24 lowercase letters, numbers, - or _"></div>
          <div class="field"><label for="su-name">Your name</label><input id="su-name" required maxlength="60" placeholder="Shown next to your username"></div>
          <div class="field"><label for="su-pass">Password</label><input id="su-pass" type="password" autocomplete="new-password" required minlength="6"></div>
          <div class="field"><label for="su-pass2">Confirm password</label><input id="su-pass2" type="password" autocomplete="new-password" required minlength="6"></div>
          <div class="field"><label for="su-code">Invite code</label><input id="su-code" required autocapitalize="none" autocomplete="off" spellcheck="false"></div>
          <div class="field"><span></span><span><button type="submit">Create account</button></span></div>
        </form>
        <p class="hint">Teammates add you to a team by your username. There's no email reset, so if you forget your password, ask an admin to delete your login in Firebase and sign up again with the same username.</p>
      </div>
    </div>`;
}

// ----- invite code (signed in, not yet approved) -----

function inviteView() {
  return `${contentHeader("Invite code")}
    ${port("", `<p>Your account <b>@${esc(me())}</b> needs an invite code before you can see leis nights.</p>
      <form data-form="redeem" class="form-box">
        <div class="field"><label for="rc-code">Invite code</label><input id="rc-code" required autocapitalize="none" autocomplete="off" spellcheck="false"></div>
        <div class="field"><span></span><span><button type="submit">Continue</button></span></div>
      </form>`)}`;
}

// ----- event -----

function eventView() {
  const ev = state.event;
  if (ev === undefined) return loading();
  if (ev === null) return `${contentHeader("Leis night not found")}${port("", `<p class="center"><a href="#/events">Back to this season's leis nights</a></p>`)}`;

  const { tab } = state.route;
  const scored = state.races.filter((r) => r.winner);
  const last = scored.length ? Math.max(...scored.map((r) => r.number)) : null;
  const final = state.races.length > 0 && scored.length === state.races.length && ev.startDate < today();
  const status = !state.races.length ? "No races yet"
    : final ? "Final"
    : `${scored.length} of ${state.races.length} races scored${last ? ` · last: race ${last}` : ""}`;

  const header = contentHeader(ev.name, [
    ev.venue ? ["Host", esc(ev.venue)] : null,
    ["Date", `<time datetime="${esc(ev.startDate)}">${esc(fmtLongDate(ev.startDate))}</time>`],
    ["Type", "Team Race · Round Robin"],
    ["Scoring", "Team"],
    ["Teams", state.teams.length],
    ["Status", esc(status)],
  ]);
  const body = tab === "full-scores" ? fullScoresPage(final)
    : tab === "sailors" ? sailorsPage()
    : tab === "all" ? allRacesPage()
    : tab === "scoring" ? scoringPage()
    : reportPage(final);
  return `${header}${body}`;
}

const base = () => `#/e/${encodeURIComponent(state.event.id)}`;
const allLink = (teamId) => `${base()}/all/${encodeURIComponent(teamId)}`;
const noTeams = () => port("", `<p class="center muted">No teams yet. ${canAdd() ? `<a href="${base()}/scoring">Add teams</a> to get started.` : ""}</p>`);

function reportPage(final) {
  if (!state.teams.length) return noTeams();
  return port(final ? "Final Results" : "Current Results", renderReport(state.teams, state.races));
}

function fullScoresPage() {
  if (!state.teams.length) return noTeams();
  return `${port("Ranking summary", renderRankingSummary(state.teams, state.races, allLink))}
    ${port("Round robin", `${renderGrid(state.teams, state.races, allLink)}
      <p class="legend"><span class="key tr-win">W (#4)</span> row team won race 4
        <span class="key tr-lose">L (#7)</span> lost race 7
        <span class="key tr-pending">#9</span> race 9, not sailed yet.
        Rematches stack in one cell. Click a record to see that team's races.</p>`, "wide")}`;
}

function sailorsPage() {
  if (!state.teams.length) return noTeams();
  const recs = new Map(standings(state.teams, state.races).map((r) => [r.team.id, r]));
  const rows = state.teams.map((t, i) => {
    const sailors = t.sailors?.length ? t.sailors : [{ name: "" }];
    const r = recs.get(t.id);
    const cell = (s) => `<td class="sailor-name">${esc(s.name)}</td><td class="handle-cell">${s.username ? `@${esc(s.username)}` : ""}</td>`;
    return `<tr class="topborder row${i % 2}">
        <td rowspan="${sailors.length}" class="burgee-cell">${burgee(t)}</td>
        <td rowspan="${sailors.length}" class="teamname"><b>${esc(t.name)}</b></td>
        <td rowspan="${sailors.length}" class="teamname">${esc(t.short)}</td>
        ${cell(sailors[0])}
        <td rowspan="${sailors.length}"><a href="${allLink(t.id)}">${r ? `${r.w}/${r.l}` : ""}</a></td>
      </tr>${sailors.slice(1).map((s) => `<tr class="row${i % 2}">${cell(s)}</tr>`).join("")}`;
  }).join("");
  return port("Sailors", `<table class="sailors results">
    <thead><tr><th></th><th class="teamname">Team</th><th class="teamname">Short</th><th class="teamname">Sailor</th><th class="teamname">Username</th><th>Rec.</th></tr></thead>
    <tbody>${rows}</tbody></table>`);
}

function allRacesPage() {
  if (!state.races.length) return port("All races", `<p class="center muted">No races yet.${canAdd() ? ` <a href="${base()}/scoring">Add races</a>.` : ""}</p>`);
  const team = state.teams.some((t) => t.id === state.route.team) ? state.route.team : null;
  const filter = `<div id="team-filter-wrap"><label for="team-filter">Show races for team:</label>
    <select id="team-filter"><option value="">[All teams]</option>
      ${state.teams.map((t) => `<option value="${esc(t.id)}"${t.id === team ? " selected" : ""}>${esc(t.name)}</option>`).join("")}
    </select></div>`;
  return port("All races", `${filter}${renderAllRaces(state.teams, state.races, team)}`, "wide");
}

function roleNote() {
  if (!state.authReady) return "";
  if (!state.user) return `<p class="notice"><a href="#/login">Sign in</a> to add teams or report results.</p>`;
  if (isAdmin()) return `<p class="message">You're an admin, so you can enter results for any race.</p>`;
  if (isMember()) return "";
  return `<p class="notice">Only people in this leis night can add teams and races. Ask someone in it to add you to a team.</p>`;
}

function teamOptions(selected) {
  return `<option value="">Choose a team</option>` + state.teams.map((t) =>
    `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.short)} · ${esc(t.name)}</option>`).join("");
}

function scoreButtons(r, byId) {
  const btn = (teamId) => {
    const t = byId.get(teamId);
    const on = r.winner === teamId;
    return `<button class="small${on ? " on" : ""}" data-action="score" data-race="${esc(r.id)}" data-team="${esc(teamId)}"
      ${on ? "disabled" : ""} title="${esc(t?.name)} won">${esc(t?.short ?? "?")} won</button>`;
  };
  return `${btn(r.teamA)}${btn(r.teamB)}${r.winner ? `<button class="small" data-action="score" data-race="${esc(r.id)}" data-team="">Clear</button>` : ""}`;
}

function scoringPage() {
  const byId = new Map(state.teams.map((t) => [t.id, t]));
  const next = state.races.length ? Math.max(...state.races.map((r) => r.number)) + 1 : 1;
  const label = (id) => { const t = byId.get(id); return t ? esc(t.name) : `<span class="noshow">(removed team)</span>`; };

  const mine = me() ? state.races.filter((r) => !r.winner && r.participants?.includes(me())) : [];
  const waiting = !mine.length ? "" : port("Waiting on your result", `<table class="scoring-table">
      <tbody>${mine.map((r) => `<tr><td>${r.number}</td>
        <td class="team1 burgee-col">${burgee(byId.get(r.teamA), 20)}</td><td class="team1">${label(r.teamA)}</td><td class="vscell">vs</td>
        <td class="team2">${label(r.teamB)}</td><td class="team2 burgee-col">${burgee(byId.get(r.teamB), 20)}</td>
        <td class="btns">${scoreButtons(r, byId)}</td></tr>`).join("")}</tbody></table>`);

  const raceForm = !canAdd() ? "" : state.teams.length < 2
    ? port("Add a race", `<p class="center muted">Add at least two teams before adding races.</p>`)
    : port("Add a race", `<form data-form="addRace" class="form-box">
        <div class="field"><label for="r-num">Race #</label><input id="r-num" type="number" min="1" step="1" required value="${next}" class="narrow"></div>
        <div class="field"><label for="r-a">Team 1</label><select id="r-a" required>${teamOptions()}</select></div>
        <div class="field"><label for="r-b">Team 2</label><select id="r-b" required>${teamOptions()}</select></div>
        <div class="field"><label for="r-res">Result</label><select id="r-res">
            <option value="" selected>Not sailed yet</option>
            <option value="A">Team 1 won</option>
            <option value="B">Team 2 won</option>
          </select></div>
        <div class="field"><label for="r-note">Note</label><input id="r-note" maxlength="200" placeholder="Optional, e.g. protest upheld"></div>
        <div class="field"><span></span><span><button type="submit">Add race</button></span></div>
        <p class="hint">Teams can meet more than once: each race gets its own number and shows up in the same grid cell. You can enter a result here only if you sailed in the race.</p>
      </form>`);

  const teamForm = !canAdd() ? "" : port("Add a team", `<form data-form="addTeam" class="form-box">
      <div class="field"><label for="tm-name">Team name</label><input id="tm-name" required maxlength="60" placeholder="e.g. Sam & Alex"></div>
      <div class="field"><label for="tm-short">Short name</label><input id="tm-short" maxlength="6" placeholder="Auto" class="narrow"></div>
      <div class="field"><label for="s1-name">Sailor 1</label><span class="pair"><input id="s1-name" required maxlength="60" placeholder="Name"><input id="s1-user" maxlength="24" autocapitalize="none" placeholder="Username (optional)"></span></div>
      <div class="field"><label for="s2-name">Sailor 2</label><span class="pair"><input id="s2-name" maxlength="60" placeholder="Name (optional)"><input id="s2-user" maxlength="24" autocapitalize="none" placeholder="Username (optional)"></span></div>
      <div class="field"><span></span><span><button type="submit">Add team</button></span></div>
      <p class="hint">Sailors with a username become part of this leis night: they can add teams and races, and enter results for their own team's races. A username can be added before that person signs up.</p>
    </form>`);

  const rows = state.races.map((r) => {
    const a = !r.winner ? "" : r.winner === r.teamA ? "tr-win" : "tr-lose";
    const b = !r.winner ? "" : r.winner === r.teamB ? "tr-win" : "tr-lose";
    const actions = [canScore(r) ? scoreButtons(r, byId) : "",
      canDelete(r) ? `<button class="small danger" data-action="delete" data-race="${esc(r.id)}">Delete</button>` : ""].join(" ");
    return `<tr${r.winner ? ' class="tr-sailed-row"' : ""}>
      <td>${r.number}</td>
      <td class="${a} team1">${label(r.teamA)}</td>
      <td class="vscell">vs</td>
      <td class="${b} team2">${label(r.teamB)}</td>
      <td class="races opt">${r.updatedBy ? `@${esc(r.updatedBy)}` : ""}</td>
      <td class="races opt">${esc(r.note)}</td>
      <td class="btns">${actions}</td>
    </tr>`;
  }).join("");
  const table = !state.races.length ? `<p class="center muted">No races yet.</p>`
    : `<table class="scoring-table">
        <thead><tr><th>#</th><th>Team 1</th><th></th><th>Team 2</th><th class="opt">Scored by</th><th class="opt">Note</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`;

  const note = roleNote();
  return `${note ? port("", note) : ""}${waiting}${port("Races", table, "wide")}${raceForm}${teamForm}`;
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
      location.hash = `#/e/${encodeURIComponent(id)}/scoring`;
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

$app.addEventListener("change", (e) => {
  // "Show races for team" on All Races.
  if (e.target.id === "team-filter") {
    location.hash = e.target.value ? allLink(e.target.value) : `${base()}/all`;
    return;
  }
  // Keep the race form from offering the same team on both sides.
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
