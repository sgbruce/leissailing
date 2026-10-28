// Demo data store: the same API as data.js, kept in this browser only.
// Open the site with ?demo to use it (?demo=reset starts over with fresh sample data).
// Nothing here talks to Firebase. Any username and password signs in; "admin" is an admin.

import { eventSummary } from "./grid.js";

export const configured = true;
export const demo = true;

const KEY = "trs-demo-v2";
const AUTH_KEY = "trs-demo-user";

const uid = () => Math.random().toString(36).slice(2, 12);
const iso = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
const daysFromToday = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ---------- sample data ----------

const PEOPLE = [
  ["Sam Bruce", "sam"], ["Alex Kim", "alex"], ["Jordan Lee", "jordan"], ["Casey Moore", "casey"],
  ["Riley Chen", "riley"], ["Morgan Diaz", "morgan"], ["Taylor Brooks", null], ["Jamie Ortiz", "jamie"],
  ["Avery Patel", "avery"], ["Quinn Walsh", null], ["Drew Novak", "drew"], ["Parker Hughes", "parker"],
  ["Rowan Fischer", "rowan"], ["Emerson Hale", null], ["Sasha Ivanova", "sasha"], ["Blake Turner", "blake"],
  ["Hayden Cruz", "hayden"], ["Reese Park", null], ["Logan Price", "logan"], ["Skyler Grant", "skyler"],
];

function makeTeams(pairs) {
  return pairs.map(([i, j]) => {
    const a = PEOPLE[i], b = j == null ? null : PEOPLE[j];
    const sailors = [{ name: a[0], username: a[1] }, ...(b ? [{ name: b[0], username: b[1] }] : [])];
    const name = sailors.map((s) => s.name.split(" ")[0]).join(" & ");
    const short = sailors.map((s) => s.name.split(" ").map((w) => w[0]).join("")).join("").toUpperCase().slice(0, 6);
    return { id: uid(), name, short, sailors, usernames: sailors.map((s) => s.username).filter(Boolean), createdBy: "sam" };
  });
}

// A full round robin (each pair once), in a sensible running order,
// with results decided by a hidden team strength so the standings look real.
function roundRobin(teams, { scored = Infinity, rematches = 0, seed = 1 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const strength = new Map(teams.map((t, i) => [t.id, teams.length - i + rand() * 3]));
  const ids = teams.map((t) => t.id);
  if (ids.length % 2) ids.push(null);
  const pairs = [];
  for (let r = 0; r < ids.length - 1; r++) {
    for (let k = 0; k < ids.length / 2; k++) {
      const a = ids[k], b = ids[ids.length - 1 - k];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    ids.splice(1, 0, ids.pop());
  }
  for (let k = 0; k < rematches; k++) pairs.push([pairs[k][1], pairs[k][0]]);
  const byId = new Map(teams.map((t) => [t.id, t]));
  return pairs.map(([a, b], i) => {
    const pa = strength.get(a) + rand() * 4, pb = strength.get(b) + rand() * 4;
    const winner = i < scored ? (pa >= pb ? a : b) : null;
    const participants = [...byId.get(a).usernames, ...byId.get(b).usernames];
    return {
      id: uid(), number: i + 1, teamA: a, teamB: b, winner, participants,
      note: winner && rand() < 0.06 ? "Protest heard, result stands" : "",
      createdBy: "sam", updatedBy: winner ? participants[0] || "sam" : null,
    };
  });
}

function sampleData() {
  const events = [];
  const add = (ev, teams, races) => events.push({ ...ev, id: uid(), createdBy: "sam",
    members: [...new Set(["sam", ...teams.flatMap((t) => t.usernames)])], teams, races });

  const live = makeTeams([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]]);
  add({ name: "Tuesday Leis Night", venue: "MIT Sailing Pavilion", startDate: daysFromToday(0) },
    live, roundRobin(live, { scored: 19, seed: 7 }));

  const champs = makeTeams([[0, 2], [1, 3], [4, 6], [5, 7], [8, 10], [9, 11]]);
  add({ name: "Charles River Leis Night", venue: "Boston", startDate: daysFromToday(-12) },
    champs, roundRobin(champs, { rematches: 3, seed: 3 }));

  const frosh = makeTeams([[12, 14], [13, 15], [16, 17], [18, 19], [2, 9]]);
  add({ name: "Frosh-Soph Leis Night", venue: "Tufts", startDate: daysFromToday(-26) },
    frosh, roundRobin(frosh, { seed: 11 }));

  const upcoming = makeTeams([[0, 1], [4, 5], [10, 11], [14, 15]]);
  add({ name: "Halloween Leis Night", venue: "Community Boating", startDate: daysFromToday(4) }, upcoming, []);
  add({ name: "Thanksgiving Leis Night", venue: "Coast Guard", startDate: daysFromToday(25) }, [], []);

  const spring = makeTeams([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]]);
  add({ name: "Spring Leis Night Finale", venue: "Charleston", startDate: daysFromToday(-190) },
    spring, roundRobin(spring, { seed: 5 }));
  const spring2 = makeTeams([[12, 13], [14, 15], [16, 17], [18, 19]]);
  add({ name: "April Showers Leis Night", venue: "Brown", startDate: daysFromToday(-200) },
    spring2, roundRobin(spring2, { rematches: 2, seed: 9 }));

  const old = makeTeams([[0, 3], [1, 2], [5, 8], [7, 11], [9, 14]]);
  add({ name: "Frostbite Leis Night", venue: "Yale", startDate: daysFromToday(-360) }, old, roundRobin(old, { seed: 2 }));

  for (const ev of events) {
    ev.summary = eventSummary(ev.teams, ev.races);
  }
  return { events };
}

// ---------- storage ----------

let db;
function load() {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "reset") {
    localStorage.removeItem(KEY);
    history.replaceState(null, "", location.pathname + "?demo" + location.hash);
  }
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db?.events) { db = sampleData(); save(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ }
}
load();

const listeners = new Set();
function emit() { save(); listeners.forEach((fn) => fn()); }
function listen(fn) { listeners.add(fn); queueMicrotask(fn); return () => listeners.delete(fn); }

const clone = (x) => JSON.parse(JSON.stringify(x));
const eventDoc = ({ teams, races, ...ev }) => clone(ev);
const findEvent = (id) => db.events.find((e) => e.id === id);

// ---------- auth ----------

let authCb = null;
const titleCase = (u) => u.charAt(0).toUpperCase() + u.slice(1);
function currentUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function setUser(u) {
  if (u) localStorage.setItem(AUTH_KEY, JSON.stringify(u)); else localStorage.removeItem(AUTH_KEY);
  setTimeout(() => authCb?.(u), 0);
}
const person = (username) => PEOPLE.find((p) => p[1] === username)?.[0];

export const usernameOf = (user) => user?.username || "";
export function watchAuth(cb) { authCb = cb; setTimeout(() => cb(currentUser()), 0); return () => { authCb = null; }; }
export async function signIn(username) {
  setUser({ username, displayName: person(username) || titleCase(username), approved: true, isAdmin: username === "admin" });
}
export async function signUp(username, displayName) {
  setUser({ username, displayName, approved: true, isAdmin: username === "admin" });
}
export async function redeemInvite() {}
export async function signOutUser() { setUser(null); }

// ---------- live reads ----------

export function watchEvents(cb) {
  return listen(() => cb(db.events.map(eventDoc).sort((a, b) => b.startDate.localeCompare(a.startDate))));
}
export function watchEvent(eventId, cb) {
  return listen(() => { const e = findEvent(eventId); cb(e ? eventDoc(e) : null); });
}
export function watchTeams(eventId, cb) {
  return listen(() => cb(clone(findEvent(eventId)?.teams || [])));
}
export function watchRaces(eventId, cb) {
  return listen(() => cb(clone(findEvent(eventId)?.races || [])));
}

// ---------- writes ----------

export async function createEvent({ name, venue, startDate }, me) {
  const id = uid();
  db.events.push({ id, name, venue, startDate, createdBy: me, members: [me], teams: [], races: [] });
  emit();
  return id;
}
export async function addTeam(eventId, team, newMembers, me) {
  const ev = findEvent(eventId);
  const id = uid();
  ev.teams.push({ ...team, id, createdBy: me });
  ev.members = [...new Set([...ev.members, ...newMembers])];
  emit();
  return id;
}
export async function addRace(eventId, race, me) {
  const id = uid();
  findEvent(eventId).races.push({ ...race, id, createdBy: me, ...(race.winner ? { updatedBy: me } : {}) });
  emit();
  return id;
}
export async function setResult(eventId, raceId, winner, me) {
  const r = findEvent(eventId).races.find((x) => x.id === raceId);
  Object.assign(r, { winner, updatedBy: me });
  emit();
}
export async function deleteRace(eventId, raceId) {
  const ev = findEvent(eventId);
  ev.races = ev.races.filter((r) => r.id !== raceId);
  emit();
}
export async function updateSummary(eventId, summary) {
  findEvent(eventId).summary = summary;
  emit();
}
