// Router: #/            home
//         #/play/CODE   student
//         #/host        instructor: create a session
//         #/host/CODE   instructor dashboard
//         #/lab         simulation lab (computer players, no database)
import { initStore, backendName } from "./store.js";
import { topbar, esc } from "./ui.js";

const root = document.getElementById("app");
let cleanup = null;

async function route() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  try { cleanup?.(); } catch { }
  cleanup = null;
  if (page === "lab") {
    const m = await import("./lab.js");
    cleanup = m.mount(root);
    return;
  }
  const role = page === "host" ? "host" : "player";
  let store;
  try {
    store = await initStore(role);
  } catch (e) {
    root.innerHTML = `${topbar()}<div class="wrap narrow"><div class="card"><h2>Can't connect</h2>
      <p>The game could not reach its database. Check the internet connection, then reload.</p>
      <p class="tiny">${esc(e.message)}</p></div></div>`;
    return;
  }
  // The store is set up once per tab with the role of the first page
  // opened; reload when switching between instructor and student.
  if (store.role && store.role !== role) { location.reload(); return; }
  store.role = role;

  const banner = backendName === "local"
    ? `<div class="testbanner">Test mode: everything stays in this browser. Open more tabs to play more teams.</div>` : "";

  if (page === "host") {
    const m = await import("./instructor.js");
    cleanup = await m.mount(root, store, (arg || "").toUpperCase(), banner);
  } else if (page === "play") {
    const m = await import("./student.js");
    cleanup = await m.mount(root, store, (arg || "").toUpperCase(), banner);
  } else {
    root.innerHTML = `${banner}${topbar()}
      <div class="wrap narrow stack" style="padding-top:48px">
        <h1>The Beer Game</h1>
        <p class="muted">A supply chain simulation of the bullwhip effect.</p>
        <div class="card stack">
          <a class="btn primary big" href="#/play" style="justify-content:center">Join a game</a>
          <a class="btn big" href="#/host" style="justify-content:center">Instructor</a>
        </div>
      </div>`;
  }
}

window.addEventListener("hashchange", route);
route();
