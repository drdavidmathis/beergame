// Data layer. Same small API whether the game runs on Firebase (classroom)
// or entirely inside one browser (local test mode).
//
//   uid()                     this browser's id (per tab for students)
//   getDoc(path) / getCol(path)
//   setDoc(path, data) / updateDoc(path, patch) / deleteDoc(path)
//   batch([{op:"set"|"update"|"delete", path, data}])
//   watchDoc(path, cb) / watchCol(path, cb)  -> unsubscribe
//   createOnce(path, data)    -> true if created, false if it already existed
//   transact(path, fn)        fn(current) returns next data (undefined = skip)
//   perTabIdentity(on)        (classroom mode) give this tab its own student identity

import { BACKEND, FIREBASE_CONFIG } from "./config.js";

export const backendName = BACKEND;
let impl = null;

// role "host" keeps one identity per browser (the instructor);
// role "player" gets a separate identity per tab, so a refresh keeps
// your seat and a second tab can be a second student when testing.
export function perTabIdentity(on) {
  if (on) sessionStorage.setItem("bg-tab-identity", "1"); else sessionStorage.removeItem("bg-tab-identity");
}

export async function initStore(role) {
  if (impl) return impl;
  impl = BACKEND === "firebase" ? await firebaseStore(role) : localStore(role);
  return impl;
}

const rid = p => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

// ---------------------------------------------------------------------
// Local test mode
// ---------------------------------------------------------------------
function localStore(role) {
  const PFX = "bg/";
  const listeners = new Set();
  const read = path => {
    try { const s = localStorage.getItem(PFX + path); return s ? JSON.parse(s) : null; }
    catch { return null; }
  };
  const colIds = path => {
    const pre = PFX + path + "/";
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k.slice(pre.length));
    }
    return out.sort();
  };
  const readCol = path => colIds(path).map(id => ({ id, ...read(path + "/" + id) }));
  const parentOf = path => path.split("/").slice(0, -1).join("/");
  const fire = path => {
    for (const l of listeners) {
      if (l.type === "doc" && l.path === path) l.cb(read(path));
      if (l.type === "col" && l.path === parentOf(path)) l.cb(readCol(l.path));
    }
  };
  window.addEventListener("storage", e => {
    if (e.key && e.key.startsWith(PFX)) fire(e.key.slice(PFX.length));
  });
  const write = (path, data) => {
    if (data == null) localStorage.removeItem(PFX + path);
    else localStorage.setItem(PFX + path, JSON.stringify(data));
    queueMicrotask(() => fire(path));
  };
  const withLock = (path, fn) => navigator.locks ? navigator.locks.request("bg-lock/" + path, fn) : fn();

  let id;
  if (role === "host") {
    id = localStorage.getItem("bg-host-id") || rid("h");
    localStorage.setItem("bg-host-id", id);
  } else {
    // Test mode: each tab is its own student (a refresh keeps the seat).
    id = sessionStorage.getItem("bg-player-id") || rid("p");
    sessionStorage.setItem("bg-player-id", id);
  }

  const api = {
    local: true,
    uid: () => id,
    getDoc: async path => read(path),
    getCol: async path => readCol(path),
    setDoc: async (path, data) => write(path, structuredClone(data)),
    updateDoc: async (path, patch) => write(path, { ...(read(path) || {}), ...structuredClone(patch) }),
    deleteDoc: async path => write(path, null),
    async batch(ops) {
      for (const o of ops) {
        if (o.op === "delete") write(o.path, null);
        else if (o.op === "update") write(o.path, { ...(read(o.path) || {}), ...structuredClone(o.data) });
        else write(o.path, structuredClone(o.data));
      }
    },
    watchDoc(path, cb) {
      const l = { type: "doc", path, cb };
      listeners.add(l);
      queueMicrotask(() => listeners.has(l) && cb(read(path)));
      return () => listeners.delete(l);
    },
    watchCol(path, cb) {
      const l = { type: "col", path, cb };
      listeners.add(l);
      queueMicrotask(() => listeners.has(l) && cb(readCol(path)));
      return () => listeners.delete(l);
    },
    createOnce: (path, data) => withLock(path, async () => {
      if (read(path)) return false;
      write(path, structuredClone(data));
      return true;
    }),
    transact: (path, fn) => withLock(path, async () => {
      const next = await fn(read(path));
      if (next !== undefined) write(path, next);
      return next;
    }),
    newId: () => rid("m"),
    // local mode only: wipe all test data
    wipe() {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(PFX)) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    },
  };
  return api;
}

// ---------------------------------------------------------------------
// Firebase (Firestore + anonymous sign-in)
// ---------------------------------------------------------------------
async function firebaseStore(role) {
  const V = "10.12.2";
  const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const au = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

  const fbApp = app.initializeApp(FIREBASE_CONFIG);
  const db = fs.initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
  // Students keep one identity per browser, so a refresh, a closed tab or
  // a dropped connection brings them back to the same seat. For testing,
  // a tab can opt into its own separate identity (see the join screen).
  const perTab = role !== "host" && sessionStorage.getItem("bg-tab-identity") === "1";
  const auth = au.initializeAuth(fbApp, {
    persistence: perTab ? au.browserSessionPersistence : au.browserLocalPersistence,
  });
  await auth.authStateReady();
  const user = auth.currentUser || (await au.signInAnonymously(auth)).user;
  const uid = user.uid;

  const ref = path => fs.doc(db, path);
  const colRef = path => fs.collection(db, path);
  const onErr = err => console.error("Firestore:", err);

  return {
    local: false,
    uid: () => uid,
    getDoc: async path => { const s = await fs.getDoc(ref(path)); return s.exists() ? s.data() : null; },
    getCol: async path => (await fs.getDocs(colRef(path))).docs.map(d => ({ id: d.id, ...d.data() })),
    setDoc: (path, data) => fs.setDoc(ref(path), data),
    updateDoc: (path, patch) => fs.setDoc(ref(path), patch, { merge: true }),
    deleteDoc: path => fs.deleteDoc(ref(path)),
    async batch(ops) {
      // Firestore batches hold up to 500 writes
      for (let i = 0; i < ops.length; i += 450) {
        const b = fs.writeBatch(db);
        for (const o of ops.slice(i, i + 450)) {
          if (o.op === "delete") b.delete(ref(o.path));
          else if (o.op === "update") b.set(ref(o.path), o.data, { merge: true });
          else b.set(ref(o.path), o.data);
        }
        await b.commit();
      }
    },
    watchDoc: (path, cb) => fs.onSnapshot(ref(path), s => cb(s.exists() ? s.data() : null), onErr),
    watchCol: (path, cb) => fs.onSnapshot(colRef(path), q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), onErr),
    createOnce: (path, data) => fs.runTransaction(db, async tx => {
      const s = await tx.get(ref(path));
      if (s.exists()) return false;
      tx.set(ref(path), data);
      return true;
    }),
    transact: (path, fn) => fs.runTransaction(db, async tx => {
      const s = await tx.get(ref(path));
      const next = await fn(s.exists() ? s.data() : null);
      if (next !== undefined) tx.set(ref(path), next);
      return next;
    }),
    newId: () => fs.doc(colRef("_ids")).id,
  };
}
