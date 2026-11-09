import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getFirestore, onSnapshot, runTransaction, setDoc } from "firebase/firestore";

const appId = "ashrinuseva-production";

// This Firebase web configuration is the existing public client identifier.
const firebaseConfig = {
  apiKey: "AIzaSyC5-eKe4v_X2uPYss0FU0FxwvrzMDcbPAQ",
  authDomain: "ashrinuseva.firebaseapp.com",
  projectId: "ashrinuseva",
  storageBucket: "ashrinuseva.firebasestorage.app",
  messagingSenderId: "1058011263523",
  appId: "1:1058011263523:web:ec7ed7a67fe86987d4f796"
};

const isFirebaseConfigured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes("Dummy") &&
  !firebaseConfig.apiKey.includes("הכנס_כאן");

window.isFirebaseConfigured = isFirebaseConfigured;

const SAVE_DEBOUNCE_MS = 250;

let db = null;
let auth = null;

try {
  if (isFirebaseConfigured) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  }
} catch {
  console.log("Cloud sync initialized in local fallback mode.");
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// Deterministic stringify so "unchanged" comparisons do not depend on key order.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const same = (left, right) => stable(left) === stable(right);

// An empty list counts as a record list too: "all records removed" must still delete.
function looksLikeRecordList(value) {
  return Array.isArray(value) && value.every((item) => isPlainObject(item) && item.id !== undefined);
}

function mergeRecordList(base = [], ours = [], theirs = []) {
  const baseMap = new Map(base.map((item) => [String(item.id), item]));
  const oursMap = new Map(ours.map((item) => [String(item.id), item]));
  const theirsMap = new Map(theirs.map((item) => [String(item.id), item]));

  const order = [];
  const seen = new Set();
  for (const item of [...ours, ...theirs, ...base]) {
    const key = String(item.id);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }

  const merged = [];
  for (const key of order) {
    const baseItem = baseMap.get(key);
    const ourItem = oursMap.get(key);
    const theirItem = theirsMap.get(key);

    // Removed on the server (or by the other client): the removal wins.
    if (theirItem === undefined) {
      if (ourItem === undefined) continue;
      if (baseItem === undefined) merged.push(clone(ourItem));
      continue;
    }

    // Removed locally: the removal wins.
    if (ourItem === undefined) {
      if (baseItem === undefined) merged.push(clone(theirItem));
      continue;
    }

    if (same(ourItem, theirItem)) {
      merged.push(clone(ourItem));
      continue;
    }
    if (baseItem !== undefined && same(ourItem, baseItem)) {
      merged.push(clone(theirItem));
      continue;
    }
    if (baseItem !== undefined && same(theirItem, baseItem)) {
      merged.push(clone(ourItem));
      continue;
    }
    merged.push(mergeValue(baseItem, ourItem, theirItem));
  }
  return merged;
}

function mergePlainList(base = [], ours = [], theirs = []) {
  if (same(ours, theirs)) return clone(ours);
  if (same(ours, base)) return clone(theirs);
  if (same(theirs, base)) return clone(ours);

  // Both sides appended different entries: keep a stable union.
  const result = clone(ours);
  const known = new Set(ours.map((item) => stable(item)));
  for (const item of theirs) {
    const key = stable(item);
    if (!known.has(key)) {
      known.add(key);
      result.push(clone(item));
    }
  }
  return result;
}

function mergeValue(base, ours, theirs) {
  if (ours === undefined && theirs === undefined) return undefined;
  if (ours === undefined) return clone(theirs);
  if (theirs === undefined) return clone(ours);
  if (same(ours, theirs)) return clone(ours);

  if (isPlainObject(ours) && isPlainObject(theirs)) {
    const baseObject = isPlainObject(base) ? base : {};
    const result = {};
    const keys = new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(baseObject)]);
    for (const key of keys) {
      const merged = mergeValue(baseObject[key], ours[key], theirs[key]);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }

  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const baseList = Array.isArray(base) ? base : [];
    if (looksLikeRecordList(ours) && looksLikeRecordList(theirs)) {
      return mergeRecordList(baseList, ours, theirs);
    }
    return mergePlainList(baseList, ours, theirs);
  }

  // Scalar conflict: whoever actually changed the value wins; local change takes precedence.
  if (base !== undefined && same(ours, base)) return clone(theirs);
  return clone(ours);
}

function mergeDocument(base, ours, theirs) {
  return mergeValue(base || {}, ours || {}, theirs || {}) || {};
}

function storeReference() {
  return doc(db, "artifacts", appId, "public", "data", "systemData", "mainStore");
}

let lastKnownRemote = null;
let pendingPayload = null;
let flushTimer = null;
let writing = null;

async function flushPending() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pendingPayload) return;
  const payload = pendingPayload;
  pendingPayload = null;

  const reference = storeReference();
  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const remote = snapshot.exists() ? snapshot.data() || {} : {};
      const merged = mergeDocument(lastKnownRemote || {}, payload, remote);
      if (same(merged, remote)) return;
      transaction.set(reference, merged);
    });
  } catch (error) {
    // Transaction unavailable (offline, rules, contention): fall back to a merge write so
    // one client's save can never wipe the whole store for everyone else.
    try {
      const merged = mergeDocument(lastKnownRemote || {}, payload, lastKnownRemote || {});
      await setDoc(reference, merged, { merge: true });
    } catch (fallbackError) {
      console.warn("Cloud save notice:", error, fallbackError);
    }
  }
}

function scheduleFlush() {
  if (!db || !auth) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writing = flushPending().finally(() => {
      writing = null;
    });
  }, SAVE_DEBOUNCE_MS);
}

window.addEventListener("pagehide", () => {
  if (pendingPayload) flushPending();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && pendingPayload) flushPending();
});

window.cloudStorage = {
  async initAuth() {
    if (!auth) return null;

    try {
      const credential = await signInAnonymously(auth);
      return credential.user;
    } catch (error) {
      console.warn("Cloud auth notice:", error);
      return null;
    }
  },

  listenData(callback) {
    if (!db || !auth) return;

    onSnapshot(
      storeReference(),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() || {};
        lastKnownRemote = clone(data);
        callback(data);
      },
      (error) => console.log("Cloud sync snapshot notice:", error)
    );
  },

  // Safe multi-user save: merge this client's changes into the live document inside a
  // transaction instead of overwriting the whole store, so one student's click never
  // removes another user's records or session data.
  async saveData(data) {
    if (!db || !auth) return;
    pendingPayload = clone(data);
    scheduleFlush();
  },

  async flush() {
    if (writing) await writing;
    await flushPending();
    if (writing) await writing;
  }
};
