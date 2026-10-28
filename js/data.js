// Every read and write to Firebase goes through this file.
import { auth, db, authSdk, fsSdk, configured } from "./firebase.js";
import { USERNAME_DOMAIN } from "./config.js";

const {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp, arrayUnion,
} = fsSdk;

export { configured };

const withId = (snap) => ({ id: snap.id, ...snap.data() });
export const usernameOf = (user) => (user?.email || "").split("@")[0];

// ---------- auth ----------

// The callback gets null when signed out, or { username, displayName,
// approved, isAdmin }. "approved" means the account has entered the invite code.
let authCb = null;
let authSeq = 0;

async function report(user) {
  const seq = ++authSeq;
  if (!user) return authCb?.(null);
  const username = usernameOf(user);
  let profile = null, isAdmin = false;
  try { const p = await getDoc(doc(db, "users", username)); profile = p.exists() ? p.data() : null; } catch { /* no profile */ }
  try { isAdmin = (await getDoc(doc(db, "admins", username))).exists(); } catch { /* not an admin */ }
  if (seq !== authSeq) return; // a newer auth update arrived meanwhile
  authCb?.({
    username,
    displayName: profile?.displayName || user.displayName || username,
    approved: !!profile,
    isAdmin,
  });
}

export function watchAuth(cb) {
  authCb = cb;
  return authSdk.onAuthStateChanged(auth, report);
}

export async function signIn(username, password) {
  await authSdk.signInWithEmailAndPassword(auth, `${username}@${USERNAME_DOMAIN}`, password);
}

const badInvite = () => Object.assign(new Error("That invite code isn't right."), { code: "app/bad-invite" });

// The invite code is checked by the security rules when the profile is saved.
// If it's wrong, the new login is deleted again so the username stays free.
export async function signUp(username, displayName, password, invite) {
  const cred = await authSdk.createUserWithEmailAndPassword(auth, `${username}@${USERNAME_DOMAIN}`, password);
  try {
    await setDoc(doc(db, "users", username), { displayName, invite, createdAt: serverTimestamp() });
  } catch (e) {
    await cred.user.delete().catch(() => authSdk.signOut(auth));
    throw e?.code === "permission-denied" ? badInvite() : e;
  }
  await authSdk.updateProfile(cred.user, { displayName }).catch(() => {});
  await report(cred.user);
}

// For a signed-in account that hasn't entered the invite code yet.
export async function redeemInvite(username, displayName, invite) {
  try {
    await setDoc(doc(db, "users", username), { displayName, invite, createdAt: serverTimestamp() });
  } catch (e) {
    throw e?.code === "permission-denied" ? badInvite() : e;
  }
  await report(auth.currentUser);
}

export const signOutUser = () => authSdk.signOut(auth);

// ---------- live reads ----------

export function watchEvents(cb, onErr) {
  const q = query(collection(db, "events"), orderBy("startDate", "desc"), limit(200));
  return onSnapshot(q, (s) => cb(s.docs.map(withId)), onErr);
}

export function watchEvent(eventId, cb, onErr) {
  return onSnapshot(doc(db, "events", eventId), (s) => cb(s.exists() ? withId(s) : null), onErr);
}

export function watchTeams(eventId, cb, onErr) {
  return onSnapshot(collection(db, "events", eventId, "teams"), (s) => cb(s.docs.map(withId)), onErr);
}

export function watchRaces(eventId, cb, onErr) {
  return onSnapshot(collection(db, "events", eventId, "races"), (s) => cb(s.docs.map(withId)), onErr);
}

// ---------- writes ----------

export async function createEvent({ name, venue, startDate }, me) {
  const ref = await addDoc(collection(db, "events"), {
    name, venue, startDate, createdBy: me, members: [me], createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Adds a team and, in the same write, adds its sailors' usernames to the event's members.
export async function addTeam(eventId, team, newMembers, me) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, "events", eventId, "teams"));
  batch.set(ref, { ...team, createdBy: me, createdAt: serverTimestamp() });
  if (newMembers.length) {
    batch.update(doc(db, "events", eventId), {
      members: arrayUnion(...newMembers), updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return ref.id;
}

export async function addRace(eventId, race, me) {
  const data = { ...race, createdBy: me, createdAt: serverTimestamp() };
  if (race.winner) Object.assign(data, { updatedBy: me, updatedAt: serverTimestamp() });
  const ref = await addDoc(collection(db, "events", eventId, "races"), data);
  return ref.id;
}

export function setResult(eventId, raceId, winner, me) {
  return updateDoc(doc(db, "events", eventId, "races", raceId), {
    winner, updatedBy: me, updatedAt: serverTimestamp(),
  });
}

export function deleteRace(eventId, raceId) {
  return deleteDoc(doc(db, "events", eventId, "races", raceId));
}
