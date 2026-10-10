// Deux appareils, un compte, une base simulée : la synchronisation ne perd ni ne double rien.
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const SITE = new URL("../site/js/", import.meta.url).href;
const store = await import(SITE + "store.js");
const { syncProgress } = await import(SITE + "sync.js");

// Base simulée : load_progress / save_progress avec écriture prudente.
let remote = null, clock = 0, hooks = {};
async function rpc(name, args) {
  if (name === "load_progress") { const r = remote && structuredClone(remote); await hooks.afterLoad?.(); return r; }
  if (name === "save_progress") {
    if ((remote?.updated_at ?? null) !== (args.base ?? null)) return null;
    remote = { state: structuredClone(args.new_state), updated_at: `t${++clock}` };
    return remote.updated_at;
  }
}
// Changer d'appareil = changer de stockage local.
const devices = { A: new Map(), B: new Map() };
let currentDevice = null;
function use(name) {
  if (currentDevice) devices[currentDevice] = new Map(mem);
  mem.clear(); for (const [k, v] of devices[name]) mem.set(k, v);
  currentDevice = name;
  store.replaceState(JSON.parse(mem.get("coup-de-patte:v1") || "null"));
}
const game = (score, day = null, kind = "mode") => ({ kind, mode: "it", day, score, results: [{ itemId: `i${score}`, answer: "Cas", correct: score > 0, timeout: false, bonus: 60 }] });
const played = () => store.getState().modes.it?.played || 0;
const me = () => "user-1";

use("A"); store.recordGame(game(100)); store.recordGame(game(150, "2026-10-11", "daily"));
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 2, "invité A ajouté au compte");
assert.equal(played(), 2);
assert.equal(store.getAccount().owner, "user-1");

use("B"); store.recordGame(game(50));
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 3, "invité B ajouté sans doubler A");
assert.ok(store.getState().daily["2026-10-11"], "le défi joué sur A apparaît sur B");

use("A"); store.recordGame(game(200));
assert.equal(store.getAccount().pending.length, 1);
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 4);
assert.equal(played(), 4, "A récupère la partie de B");
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 4, "resynchroniser ne change rien");

use("B"); await syncProgress(me, rpc);
assert.equal(played(), 4, "B rattrape A");

// Écritures concurrentes : B lit, A écrit entre-temps, B recommence.
store.recordGame(game(10));
hooks.afterLoad = async () => {
  hooks.afterLoad = null;
  const saved = new Map(mem); const st = store.getState();
  use("A"); store.recordGame(game(20)); await syncProgress(me, rpc);
  devices.A = new Map(mem); mem.clear(); for (const [k, v] of saved) mem.set(k, v); currentDevice = "B"; store.replaceState(st);
};
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 6, "aucune partie perdue en cas de conflit");
assert.equal(played(), 6);

// Partie finie pendant l'envoi : gardée en attente et dans la version locale.
store.recordGame(game(30));
hooks.afterLoad = async () => { hooks.afterLoad = null; store.recordGame(game(40)); };
await syncProgress(me, rpc);
assert.equal(remote.state.modes.it.played, 8, "la partie finie pendant l'envoi part au tour suivant");
assert.equal(played(), 8);
assert.equal(store.getAccount().pending.length, 0);
console.log("synchronisation : tous les cas passent");
