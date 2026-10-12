// Point d'entrée : routes, construction des parties, service worker.

import { dayKey, daysBetween, reducedMotion, toast } from "./util.js";
import { loadMeta, loadArtists, loadMode, loadDaily, loadArchive, loadTitles, toItem } from "./data.js";
import { initI18n, t } from "./i18n.js";
import { modeName } from "./modes.js";
import { rngFrom, randomSeed, shuffle, pick, weightedSample } from "./rng.js";
import { seenSet, recordGame, dailyResult, saveDailyProgress } from "./store.js";
import { close } from "./dialogs.js";
import { Game } from "./game.js";
import { submitGame, panelStats, warmUp } from "./online.js";
import { initAccountButton, openAccount } from "./social.js";
import { homeView, endView, dailyDoneView, challengeIntro, emptyState, openStats, openAbout, openLanguage, decodeChallenge, atelierView, pastDailiesView } from "./views.js";

const ARTISTS_PER_GAME = 9;
const ROUNDS = 8;
const root = document.getElementById("app");
let current = null;
let navigation = 0;
let renders = 0;
// Écran de fin de la dernière partie, pour le redessiner (changement de langue, connexion)
// sans relancer une partie : l'adresse devient #/fin dès la dernière réponse.
let lastEnd = null;

// Chaque navigation reçoit un jeton : un chargement lent ne doit pas écraser l'écran suivant.
function begin() {
  const token = ++navigation;
  return () => token === navigation;
}

// ------------------------------------------------------------------ parties

async function modeGame(modeId) {
  const [meta, mode] = await Promise.all([loadMeta(), loadMode(modeId)]);
  const info = meta.modes.find((m) => m.id === modeId);
  const rnd = rngFrom(randomSeed());
  // Poids calculés par le pipeline (notoriété) ; à défaut, la racine du nombre d'histoires.
  const weights = mode.weights?.length
    ? mode.weights
    : mode.counts?.length
      ? mode.counts.map((c) => Math.sqrt(c))
      : mode.artists.map(() => 1);
  const chosen = weightedSample(mode.artists, weights, ARTISTS_PER_GAME, rnd);
  const answers = shuffle(chosen, rnd).slice(0, ROUNDS);
  const seen = seenSet();
  const rounds = answers.map((code) => {
    const list = mode._byArtist.get(code);
    const fresh = list.filter((item) => !seen.has(item.id));
    return pick(fresh.length ? fresh : list, rnd);
  });
  return {
    kind: "mode",
    modeId,
    modeName: info ? modeName(info) : modeId,
    artists: shuffle(chosen, rnd),
    rounds,
    spares: new Map(chosen.map((code) => [code, mode._byArtist.get(code)])),
  };
}

// Nom du mode dans la langue du moment : elle a pu changer depuis le début de la partie.
async function modeLabel(modeId) {
  const meta = await loadMeta().catch(() => null);
  const info = meta?.modes.find((m) => m.id === modeId);
  return info ? modeName(info) : t("challenge.shared_game");
}

async function archivedItems() {
  const archive = await loadArchive();
  return { byId: new Map(archive.items.map((row) => [row[0], toItem(row)])), artists: archive.artists || {} };
}

async function fixedGame({ kind, modeId, artistCodes, roundIds, seed, day, target }) {
  const meta = await loadMeta();
  const info = meta.modes.find((m) => m.id === modeId);
  const mode = await loadMode(modeId).catch(() => null);
  let archive = null;
  const rounds = [];
  // Un défi du jour (ou passé) se joue avec les cases telles qu'elles ont été publiées :
  // l'archive les garde, alors que les modes suivent les réattributions d'Inducks.
  const published = kind === "daily" || kind === "archive";
  for (const id of roundIds) {
    let item = published ? null : mode?._byId.get(id);
    if (!item) {
      archive ||= await archivedItems().catch(() => ({ byId: new Map(), artists: {} }));
      item = archive.byId.get(id) || mode?._byId.get(id);
    }
    if (!item) return null;
    rounds.push(item);
  }
  const rnd = rngFrom(seed);
  return {
    kind,
    modeId,
    modeName: info ? modeName(info) : t("challenge.shared_game"),
    day,
    target,
    artists: shuffle(artistCodes, rnd),
    rounds,
    spares: new Map(artistCodes.map((code) => [code, mode?._byArtist.get(code) || []])),
    extraPeople: archive?.artists || {},
  };
}

async function people(setup) {
  const artists = await loadArtists();
  if (!setup.extraPeople || !Object.keys(setup.extraPeople).length) {
    // Les défis du jour peuvent citer un dessinateur sorti des modes depuis.
    const missing = setup.artists.some((code) => !artists[code]);
    if (missing) setup.extraPeople = (await archivedItems().catch(() => ({ artists: {} }))).artists;
  }
  return { ...(setup.extraPeople || {}), ...artists };
}

async function play(setup, { dailyNumber } = {}, alive = () => true) {
  const [dict] = await Promise.all([people(setup), loadTitles()]);
  if (!alive()) return;
  if (setup.artists.some((code) => !Object.hasOwn(dict, code))) {
    root.replaceChildren(emptyState(t("game.unknown_artist")));
    return;
  }
  setup.title = t("game.ready");
  setup.subtitle =
    setup.kind === "daily"
      ? t("game.subtitle.daily", { n: dailyNumber })
      : setup.kind === "archive"
        ? t("game.subtitle.archive", { n: dailyNumber })
        : setup.modeName;
  const replayHash = setup.kind === "mode" ? `#/jouer/${encodeURIComponent(setup.modeId)}` : setup.kind === "archive" ? `#/jour/${setup.day}` : null;
  const replay = replayHash ? () => (location.hash = replayHash) : null;
  stopCurrent();
  // Part des joueurs qui ont trouvé chaque case : lue pendant la partie, montrée à la réponse.
  const crowd = panelStats(setup.rounds.map((item) => item.id));
  // La partie est enregistrée dès la dernière réponse, sans attendre « Voir mon score » :
  // fermer l'onglet à ce moment-là ne doit pas la perdre.
  let sent = null;
  const save = ({ score, results }) => {
    if (sent) return sent;
    recordGame({ kind: setup.kind, mode: setup.modeId, day: setup.day, score, results });
    sent = submitGame({ kind: setup.kind, modeId: setup.modeId, day: setup.day, score, results });
    return sent;
  };
  const game = new Game(root, setup, dict, {
    onFinish: ({ score, results }) => {
      if (current === game) current = null;
      save({ score, results });
      if (!alive()) return;
      const show = (name) => endView(root, { setup, score, results, people: dict, modeName: name, dailyNumber, onReplay: replay, sent, crowd });
      lastEnd = async () => show(await modeLabel(setup.modeId));
      history.replaceState(null, "", "#/fin");
      swap(() => show(setup.modeName));
    },
    onQuit: () => {
      if (current === game) current = null;
      if (location.hash === "#/" || location.hash === "") render();
      else location.hash = "#/";
    },
  });
  // Une seule tentative au défi du jour : il compte dès la première case, même interrompu.
  const progress = (results) => setup.kind === "daily" && saveDailyProgress(setup.day, { mode: setup.modeId, results });
  game.onRound = (index) => {
    if (index !== 0) return;
    // Le compte a pu apprendre entre-temps que ce défi a été joué sur un autre appareil.
    if (setup.kind === "daily" && dailyResult(setup.day)) {
      game.destroy();
      if (current === game) current = null;
      render();
      return;
    }
    progress([]);
  };
  game.onRoundEnd = (results) => {
    progress(results);
    if (results.length === setup.rounds.length) save({ score: game.score, results });
  };
  crowd.then((map) => {
    game.crowd = map;
  });
  current = game;
  swap(() => {
    if (alive() && current === game) game.mount();
  });
}

async function startMode(modeId) {
  stopCurrent();
  const alive = begin();
  try {
    const setup = await modeGame(modeId);
    if (!alive()) return;
    await play(setup, {}, alive);
  } catch (error) {
    console.error(error);
    // Une erreur arrivée après avoir quitté cet écran ne doit pas effacer le suivant.
    if (alive()) root.replaceChildren(emptyState(t("game.mode_unavailable")));
  }
}

async function startDaily(dateArg) {
  stopCurrent();
  const alive = begin();
  const daily = await loadDaily().catch(() => null);
  if (!alive()) return;
  const today = dayKey();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateArg || "") ? dateArg : today;
  if (day > today) {
    root.replaceChildren(emptyState(t("daily.not_out")));
    return;
  }
  const game = daily?.days?.[day];
  if (!game) {
    root.replaceChildren(emptyState(day === today ? t("daily.not_ready") : t("daily.missing")));
    return;
  }
  const n = daysBetween(daily.launch, day) + 1;
  const meta = await loadMeta();
  if (!alive()) return;
  const dailyMode = meta.modes.find((m) => m.id === game.mode);
  const modeLabel = dailyMode ? modeName(dailyMode) : "";
  const done = day === today ? dailyResult(today) : null;
  const kind = day === today ? "daily" : "archive";
  const setup = await fixedGame({ kind, modeId: game.mode, artistCodes: game.artists, roundIds: game.rounds, seed: `jour/${day}`, day }).catch(() => null);
  if (!alive()) return;
  if (done) {
    // Défi déjà joué : le résultat, puis les cases à revoir (si leurs données sont là).
    const dict = setup ? await people(setup).catch(() => null) : null;
    if (!alive()) return;
    const crowd = setup ? panelStats(setup.rounds.map((item) => item.id)) : null;
    dailyDoneView(root, { number: n, modeName: modeLabel, result: done, day: today, rounds: setup?.rounds, people: dict, crowd });
    return;
  }
  if (!setup) {
    root.replaceChildren(emptyState(t("daily.not_found")));
    return;
  }
  await play(setup, { dailyNumber: n }, alive);
}

async function startChallenge(payload) {
  const alive = begin();
  const data = decodeChallenge(payload);
  if (!data) {
    root.replaceChildren(emptyState(t("challenge.broken")));
    return;
  }
  const setup = await fixedGame({ kind: "challenge", modeId: data.m, artistCodes: data.a, roundIds: data.r, seed: `defi/${payload}`, day: null, target: Number(data.s) });
  if (!alive()) return;
  if (!setup) {
    root.replaceChildren(emptyState(t("challenge.gone")));
    return;
  }
  // Chaque case doit pouvoir être trouvée : son dessinateur fait partie des noms proposés.
  if (setup.rounds.some((item) => !data.a.includes(item.artist))) {
    root.replaceChildren(emptyState(t("challenge.broken")));
    return;
  }
  setup.artists = data.a.slice();
  challengeIntro(root, { target: Number(data.s), modeName: setup.modeName, rounds: setup.rounds.length, onStart: () => play(setup, {}, begin()) });
}

// ------------------------------------------------------------------ routes

function stopCurrent() {
  if (current) {
    current.destroy();
    current = null;
  }
}

function parse(hash) {
  const path = hash.replace(/^#\/?/, "");
  const [section, ...rest] = path.split("/");
  return { section: section || "", arg: rest.join("/") };
}

function swap(update) {
  if (!document.startViewTransition || reducedMotion() || document.hidden) return update();
  const transition = document.startViewTransition(update);
  // Transition sautée parce qu'un autre écran arrive déjà : rien d'anormal.
  transition.ready.catch(() => {});
  return transition.updateCallbackDone;
}

// soft : simple mise à jour de l'écran affiché (progression arrivée d'un autre appareil),
// sans fermer les feuilles ouvertes ni remonter en haut de la page.
async function render({ soft = false } = {}) {
  const { section, arg } = parse(location.hash);
  const mine = ++renders;
  if (!soft) {
    stopCurrent();
    document.querySelectorAll("dialog[open]").forEach((d) => close(d));
    document.documentElement.style.overflow = "";
    window.scrollTo({ top: 0 });
  }
  try {
    if (section === "fin") {
      if (lastEnd) return swap(lastEnd);
      history.replaceState(null, "", "#/");
    }
    if (section === "jouer" && arg) return await startMode(decodeURIComponent(arg));
    if (section === "jour") return await startDaily(arg);
    if (section === "atelier") {
      const alive = begin();
      const mount = await atelierView(root, decodeURIComponent(arg || ""));
      if (alive()) swap(mount);
      return;
    }
    if (section === "defis") {
      const alive = begin();
      const mount = await pastDailiesView(root);
      if (alive()) swap(mount);
      return;
    }
    if (section === "defi" && arg) return await startChallenge(arg);
    const alive = begin();
    const mount = await homeView(root);
    if (alive()) swap(mount);
    document.title = t("app.title");
  } catch (error) {
    console.error(error);
    // Seulement si l'on n'a pas changé d'écran entre-temps.
    if (mine === renders && !current) root.replaceChildren(emptyState());
  }
}

window.addEventListener("hashchange", async (event) => {
  const game = current;
  // Retour arrière pendant une partie : on demande d'abord, comme avec le bouton ✕.
  if (game?.inProgress()) {
    const target = location.hash;
    if (event.oldURL) history.replaceState(null, "", event.oldURL);
    if (!(await game.confirmLeave()) || current !== game) return;
    game.destroy();
    current = null;
    history.replaceState(null, "", target || "#/");
  }
  render();
});

// Après une connexion, le défi du jour joué ailleurs doit apparaître tout de suite, sans
// recharger la page. Seuls l'accueil et la liste des défis sont redessinés : une partie ou
// un écran de fin restent tels quels. Même chose au passage de minuit, pour le nouveau défi.
for (const name of ["duckdle:progress", "duckdle:newday"]) {
  window.addEventListener(name, () => {
    const { section } = parse(location.hash);
    if (!current && (section === "" || section === "defis")) render({ soft: true });
  });
}

document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open]");
  if (!opener) return;
  if (opener.dataset.open === "stats") openStats();
  if (opener.dataset.open === "about") openAbout();
  if (opener.dataset.open === "lang") openLanguage();
  if (opener.dataset.open === "account") openAccount();
});

// Lien d'évitement : aller au contenu sans changer de route.
document.querySelector(".skip")?.addEventListener("click", (event) => {
  event.preventDefault();
  root.focus();
});

window.addEventListener("duckdle:signed-in", () => toast(t("account.welcome")));

initI18n()
  .catch((error) => console.error(error))
  .then(() => {
    loadTitles();
    render();
    initAccountButton();
    warmUp();
  });

// Hors ligne : l'appli se recharge depuis le cache, les images restent sur Inducks.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  // Chrome : « Failed to fetch », Firefox : « NetworkError… », Safari : « Load failed ».
  if (event.reason instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(event.reason.message)) toast(t("common.connection_lost"));
});
