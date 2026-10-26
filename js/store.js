// Progression du joueur : gardée dans le navigateur, et dans son compte s'il est connecté.
//
// Les clés de stockage gardent l'ancien nom du jeu (« coup-de-patte ») : c'est là que
// les progressions existantes sont enregistrées, il ne faut pas les renommer.

const KEY = "coup-de-patte:v1";
// Lien avec un compte : propriétaire, version en ligne lue en dernier, parties pas encore envoyées.
const ACCOUNT_KEY = "coup-de-patte:account";
// Défis du jour joués sur cet appareil, à part de la progression : ils restent après une
// déconnexion ou la suppression du compte, pour qu'on ne puisse pas rejouer le défi du jour.
const PLAYED_KEY = "duckdle:played";
const PLAYED_DAYS = 7;
const SEEN_LIMIT = 400;

// Noms affichés : clés medal.<id> des traductions.
export const MEDALS = [
  { id: "or", need: 100 },
  { id: "argent", need: 40 },
  { id: "bronze", need: 10 },
];

export function blank() {
  return { v: 1, modes: {}, artists: {}, daily: {}, archives: {}, seen: [] };
}

let state = null;
const listeners = new Set();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* navigation privée ou stockage plein : tant pis, la partie reste jouable */
  }
}

// Un état venu d'ailleurs (ancienne version, compte en ligne) complété des champs manquants.
export function normalize(raw) {
  const s = { ...blank(), ...(raw && typeof raw === "object" ? raw : {}) };
  for (const key of ["modes", "artists", "daily", "archives"]) if (!s[key] || typeof s[key] !== "object") s[key] = {};
  if (!Array.isArray(s.seen)) s.seen = [];
  return s;
}

function load() {
  if (!state) state = normalize(read(KEY, null));
  return state;
}

// Un autre onglet vient d'écrire : on relira au prochain accès, plutôt que d'écraser sa
// progression avec la version gardée en mémoire ici.
globalThis.addEventListener?.("storage", (event) => {
  if (event.key === KEY || event.key === null) state = null;
});

function save() {
  write(KEY, state);
}

// Prévient (par exemple la synchronisation) qu'une partie vient d'être enregistrée.
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return load();
}

export function seenSet() {
  return new Set(load().seen);
}

// Ce qu'une partie terminée garde : de quoi la rejouer sur un autre état (synchronisation).
function compact({ kind, mode, day, score, results }) {
  return {
    kind,
    mode,
    day: day || null,
    score,
    results: results.map((r) => ({
      itemId: r.itemId,
      answer: r.answer,
      guess: r.guess || null,
      correct: !!r.correct,
      timeout: !!r.timeout,
      base: r.base || 0,
      bonus: r.bonus || 0,
    })),
  };
}

// Ajoute une partie à un état donné.
export function applyGame(s, { kind, mode, day, score, results }) {
  const m = (s.modes[mode] ||= { played: 0, best: 0, total: 0, correct: 0, rounds: 0, fast: 0 });
  m.played += 1;
  m.best = Math.max(m.best, score);
  m.total += score;
  for (const r of results) {
    m.rounds += 1;
    if (r.correct) m.correct += 1;
    if (r.bonus >= 50) m.fast += 1;
    const a = (s.artists[r.answer] ||= { seen: 0, right: 0 });
    a.seen += 1;
    if (r.correct) a.right += 1;
    s.seen.push(r.itemId);
  }
  if (s.seen.length > SEEN_LIMIT) s.seen = s.seen.slice(-SEEN_LIMIT);
  if (kind === "daily" && day && (!s.daily[day] || s.daily[day].partial)) {
    s.daily[day] = { score, mode, ...details(results) };
  }
  // Défi passé rejoué : on garde le meilleur score, sans toucher à la série.
  if (kind === "archive" && day) {
    if (!s.archives[day] || s.archives[day].score < score) s.archives[day] = { score, mode, ...details(results) };
  }
  return s;
}

export function recordGame(game) {
  const s = load();
  const entry = compact(game);
  applyGame(s, entry);
  save();
  if (entry.kind === "daily" && entry.day) markPlayed(entry.day, s.daily[entry.day]);
  const account = getAccount();
  if (account.owner) {
    account.pending.push(entry);
    setAccount(account);
  }
  listeners.forEach((fn) => fn(entry));
}

// Ce qu'on garde d'un défi pour le revoir : la marque, la réponse et les points de chaque case.
// Les défis joués avant cette version n'ont que les marques.
function details(results) {
  return {
    marks: results.map(markOf),
    picks: results.map((r) => r.guess || null),
    points: results.map((r) => (r.correct ? (r.base || 100) + (r.bonus || 0) : 0)),
  };
}

// Progression du défi du jour, enregistrée case par case.
export function saveDailyProgress(day, { mode, results }) {
  const s = load();
  if (!day || (s.daily[day] && !s.daily[day].partial)) return;
  const score = results.reduce((total, r) => total + (r.correct ? r.base + r.bonus : 0), 0);
  s.daily[day] = { score, mode, ...details(results), partial: true };
  save();
  markPlayed(day, s.daily[day]);
  // Le compte doit l'apprendre tout de suite : un défi commencé ici puis abandonné ne doit
  // pas pouvoir se rejouer sur un autre appareil.
  const account = getAccount();
  if (account.owner) {
    account.dirty = (account.dirty || 0) + 1;
    setAccount(account);
  }
  listeners.forEach((fn) => fn({ kind: "daily", day, partial: true }));
}

export function markOf(result) {
  if (!result.correct) return result.timeout ? "time" : "ko";
  return result.bonus >= 50 ? "fast" : "ok";
}

export function dailyResult(day) {
  return load().daily[day] || playedHere(day);
}

// Le défi d'un jour a-t-il déjà été joué sur cet appareil ? Oui pour un invité, et pour le
// compte qui l'a joué ; un autre compte, sur un appareil partagé, garde son propre défi.
function playedHere(day) {
  const entry = read(PLAYED_KEY, {})?.[day];
  if (!entry?.result) return null;
  const me = getAccount().owner;
  if (entry.owner && me && entry.owner !== me) return null;
  return entry.result;
}

function markPlayed(day, result) {
  if (!day || !result) return;
  const played = read(PLAYED_KEY, {}) || {};
  const known = played[day]?.result;
  if (known && !known.partial && result.partial) return;
  played[day] = { result, owner: getAccount().owner };
  const kept = Object.keys(played).sort().slice(-PLAYED_DAYS);
  write(PLAYED_KEY, Object.fromEntries(kept.map((key) => [key, played[key]])));
}

// Avant de vider l'appareil (déconnexion), noter les derniers défis du jour joués.
export function rememberPlayed() {
  const days = Object.keys(load().daily).sort().slice(-PLAYED_DAYS);
  for (const day of days) markPlayed(day, load().daily[day]);
}

export function dailyStreak(todayKey, previousKey) {
  const s = load();
  let streak = 0;
  let key = s.daily[todayKey] ? todayKey : previousKey(todayKey);
  while (key && s.daily[key]) {
    streak += 1;
    key = previousKey(key);
  }
  return streak;
}

export function medalFor(correct) {
  return MEDALS.find((medal) => correct >= medal.need) || null;
}

export function nextMedal(correct) {
  return [...MEDALS].reverse().find((medal) => correct < medal.need) || null;
}

export function archiveResult(day) {
  return load().archives?.[day] || null;
}

// ------------------------------------------------------------------ fusion et compte

// Additionne les compteurs de source dans target (progression invitée rattachée à un compte).
export function addCounters(target, source) {
  for (const [id, m] of Object.entries(source.modes)) {
    const t = (target.modes[id] ||= { played: 0, best: 0, total: 0, correct: 0, rounds: 0, fast: 0 });
    for (const key of ["played", "total", "correct", "rounds", "fast"]) t[key] += m[key] || 0;
    t.best = Math.max(t.best, m.best || 0);
  }
  for (const [code, a] of Object.entries(source.artists)) {
    const t = (target.artists[code] ||= { seen: 0, right: 0 });
    t.seen += a.seen || 0;
    t.right += a.right || 0;
  }
  return target;
}

// Réunit les défis joués et les cases déjà vues, sans rien compter deux fois.
export function mergeMaps(target, source) {
  for (const [day, result] of Object.entries(source.daily)) {
    const known = target.daily[day];
    // Un défi fini l'emporte sur un défi interrompu ; entre deux interrompus, le plus avancé.
    const further = (result.marks?.length || 0) > (known?.marks?.length || 0);
    if (!known || (known.partial && (!result.partial || further))) target.daily[day] = result;
  }
  for (const [day, result] of Object.entries(source.archives)) {
    const known = target.archives[day];
    if (!known || known.score < result.score) target.archives[day] = result;
  }
  const seen = new Set(target.seen);
  for (const id of source.seen) if (!seen.has(id)) target.seen.push(id);
  if (target.seen.length > SEEN_LIMIT) target.seen = target.seen.slice(-SEEN_LIMIT);
  return target;
}

export function replaceState(next) {
  state = normalize(next);
  save();
}

export function getAccount() {
  const a = read(ACCOUNT_KEY, null);
  // dirty : changements locaux qui ne sont pas des parties (défi du jour en cours) à envoyer.
  return { owner: a?.owner || null, base: a?.base || null, pending: Array.isArray(a?.pending) ? a.pending : [], linking: !!a?.linking, dirty: a?.dirty || 0 };
}

export function setAccount(account) {
  if (!account?.owner) {
    try {
      localStorage.removeItem(ACCOUNT_KEY);
    } catch {
      /* rien à faire */
    }
    return;
  }
  write(ACCOUNT_KEY, account);
}
