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
assert.equal(await syncProgress(me, rpc), false, "rien de neuf : rien à redessiner");

// Défi du jour commencé sur A puis abandonné : il part au compte sans partie terminée,
// et B ne peut plus le jouer.
const started = "2026-10-13";
const firstPanel = [{ itemId: "x", answer: "Cas", guess: "Cas", correct: true, timeout: false, base: 100, bonus: 40 }];
use("A"); store.saveDailyProgress(started, { mode: "it", results: [] });
store.saveDailyProgress(started, { mode: "it", results: firstPanel });
assert.ok(store.getAccount().dirty, "défi commencé : à envoyer");
await syncProgress(me, rpc);
assert.equal(remote.state.daily[started]?.partial, true, "défi interrompu envoyé au compte");
assert.equal(store.getAccount().dirty, 0);
use("B"); await syncProgress(me, rpc);
assert.equal(store.dailyResult(started)?.marks.length, 1, "B voit le défi commencé sur A");
// Défi avancé pendant l'envoi : rien de perdu, ni en local ni au compte.
use("A");
hooks.afterLoad = async () => { hooks.afterLoad = null; store.saveDailyProgress(started, { mode: "it", results: [...firstPanel, { ...firstPanel[0], itemId: "y" }] }); };
store.saveDailyProgress(started, { mode: "it", results: firstPanel });
await syncProgress(me, rpc);
assert.equal(store.getState().daily[started].marks.length, 2, "la case jouée pendant l'envoi reste en local");
assert.equal(remote.state.daily[started].marks.length, 2, "et part au compte au tour suivant");
assert.equal(store.getAccount().dirty, 0);
// B reprend la main (la suite suppose que A a du retard sur le compte).
use("B"); store.recordGame(game(5)); await syncProgress(me, rpc);

// Le défi du jour ne se rejoue pas en se déconnectant, ni en supprimant son compte.
const today = "2026-10-12";
use("A"); store.recordGame(game(300, today, "daily"));
assert.equal(await syncProgress(me, rpc), true);
use("B");
assert.equal(store.dailyResult(today), null, "B n'a pas encore reçu le défi joué sur A");
assert.equal(await syncProgress(me, rpc), true, "B reçoit le défi de A : l'écran doit se redessiner");
assert.equal(store.dailyResult(today).score, 300);
// Déconnexion sur B (comme signOut) : progression vidée, défi du jour toujours noté.
store.rememberPlayed(); store.setAccount(null); store.replaceState(store.blank());
assert.equal(played(), 0, "déconnecté : plus de statistiques sur B");
assert.equal(store.dailyResult(today)?.score, 300, "invité sur B : le défi reste joué");
// Un autre compte sur le même appareil garde son propre défi.
store.setAccount({ owner: "user-2", base: null, pending: [] });
assert.equal(store.dailyResult(today), null, "autre compte : défi libre");
store.setAccount(null);
// Partie jouée en invité puis suppression d'un compte : le défi reste noté aussi.
use("A"); store.setAccount(null);
assert.equal(store.dailyResult(today)?.score, 300);
console.log("synchronisation : tous les cas passent");
