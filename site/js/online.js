// Duckdle en ligne (Supabase) : statistiques communes, joueurs en ligne, comptes et
// synchronisation de la progression.
//
// Tout est facultatif : sans réseau, ou si Supabase ne répond pas, le jeu continue en local
// et rien ne s'affiche. La bibliothèque n'est chargée qu'après le premier affichage.

import { lang } from "./i18n.js";
import { blank, setAccount, replaceState, rememberPlayed, onChange } from "./store.js";
import { syncProgress } from "./sync.js";

export const SUPABASE_URL = "https://jzzpyknxuueiynyugiox.supabase.co";
// Clé publique : faite pour être dans le site, elle ne donne accès qu'aux fonctions prévues.
const SUPABASE_KEY = "sb_publishable_nMWd8aKhXrnJjy5JSLam0A_QUnMHVKH";
// Parties des contrôles automatiques (adresse avec ?test) : envoyées mais jamais comptées.
const TEST = new URLSearchParams(location.search).has("test");
// En dessous, un pourcentage ne veut pas dire grand-chose.
export const MIN_PANEL_ATTEMPTS = 5;
export const MIN_ARTIST_ATTEMPTS = 20;

let clientPromise = null;

export function client() {
  clientPromise ||= import("./vendor/supabase.js")
    .then(({ createClient }) => {
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: "duckdle:auth" },
      });
      watchAuth(sb);
      return sb;
    })
    .catch((error) => {
      clientPromise = null;
      throw error;
    });
  return clientPromise;
}

// Charge la bibliothèque quand le navigateur souffle, sans retarder l'affichage.
export function warmUp() {
  const go = () => client().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 800);
}

async function rpc(name, args = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

function quietly(promise, fallback = null) {
  return promise.catch((error) => {
    console.info("Duckdle en ligne :", error?.message || error);
    return fallback;
  });
}

// ------------------------------------------------------------------ parties et statistiques

export function submitGame({ kind, modeId, day, score, results }) {
  const answers = results
    .filter((r) => !r.skipped)
    .map((r) => ({ item: r.itemId, artist: r.answer, guess: r.guess || null, correct: !!r.correct, elapsed: Math.round(r.elapsed || 0) }));
  if (!answers.length) return Promise.resolve(null);
  const game = { kind, mode: modeId, day: kind === "daily" || kind === "archive" ? day : null, score, lang: lang(), test: TEST, answers };
  return quietly(rpc("submit_game", { game }));
}

export function liveStats(dayKey) {
  return quietly(rpc("live_stats", { day_key: dayKey }));
}

export function dailyStats(dayKey, score = null) {
  return quietly(rpc("daily_stats", { day_key: dayKey, my_score: score }));
}

export function panelStats(ids) {
  return quietly(
    rpc("panel_stats", { items: ids.slice(0, 50) }).then((rows) => new Map((rows || []).map((r) => [r.item, r]))),
    new Map(),
  );
}

let artistCache = null;
export function artistStats() {
  artistCache ||= quietly(
    rpc("artist_stats").then((rows) => new Map((rows || []).map((r) => [r.artist, r]))),
    null,
  ).then((map) => {
    if (!map) artistCache = null;
    return map || new Map();
  });
  return artistCache;
}

// ------------------------------------------------------------------ joueurs en ligne

let presence = null;
const onlineListeners = new Set();
let onlineCount = 0;

// Chaque onglet ouvert compte pour un, sans identifiant gardé : une clé tirée au hasard
// à chaque visite, oubliée à la fermeture.
export function watchOnline(fn) {
  onlineListeners.add(fn);
  if (onlineCount) fn(onlineCount);
  if (!presence) {
    presence = client()
      .then((sb) => {
        const key = Math.random().toString(36).slice(2);
        const channel = sb.channel("duckdle-online", { config: { presence: { key } } });
        const publish = () => {
          onlineCount = Object.keys(channel.presenceState()).length;
          onlineListeners.forEach((listener) => listener(onlineCount));
        };
        channel.on("presence", { event: "sync" }, publish);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED" && !document.hidden) channel.track({});
        });
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) channel.untrack();
          else channel.track({});
        });
        return channel;
      })
      .catch(() => {
        presence = null;
      });
  }
  return () => onlineListeners.delete(fn);
}

// ------------------------------------------------------------------ comptes

// Comptes par pseudo et mot de passe, sans e-mail : Supabase demande une adresse, alors
// chaque pseudo devient une adresse fictive en « .invalid » (domaine réservé, qui ne reçoit
// jamais rien). Il faut que « Confirm email » soit désactivé dans Supabase, sinon Supabase
// voudrait envoyer une confirmation : tant que ce n'est pas le cas, les comptes restent fermés.
const ACCOUNT_DOMAIN = "duckdle.invalid";
export const PASSWORD_MIN = 6;

// Clé d'un pseudo : sans accents ni majuscules, lettres latines, chiffres, _ et -.
export function pseudoKey(pseudo) {
  const key = String(pseudo || "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /^[a-z0-9_-]{3,20}$/.test(key) ? key : null;
}

let settingsPromise = null;
export function accountsOpen() {
  settingsPromise ||= fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((settings) => Boolean(settings.external?.email && settings.mailer_autoconfirm && !settings.disable_signup))
    .catch(() => {
      settingsPromise = null;
      return false;
    });
  return settingsPromise;
}

// Erreurs de Supabase traduites en ce que le joueur peut corriger.
function reason(error) {
  const code = error?.code || "";
  const text = String(error?.message || "").toLowerCase();
  if (code === "user_already_exists" || text.includes("already registered")) return "taken";
  if (code === "weak_password" || text.includes("password should")) return "short_password";
  if (code === "invalid_credentials" || text.includes("invalid login")) return "wrong";
  if (code.includes("rate_limit") || text.includes("rate limit")) return "busy";
  return "error";
}

export async function signUp(pseudo, password) {
  const key = pseudoKey(pseudo);
  if (!key) throw new Error("bad_pseudo");
  if (password.length < PASSWORD_MIN) throw new Error("short_password");
  const sb = await client();
  const { data, error } = await sb.auth.signUp({
    email: `${key}@${ACCOUNT_DOMAIN}`,
    password,
    options: { data: { pseudo: pseudo.trim() } },
  });
  if (error) throw new Error(reason(error));
  // Sans session, Supabase attend une confirmation par e-mail : les comptes ne sont pas prêts.
  if (!data.session) throw new Error("error");
}

export async function signIn(pseudo, password) {
  const key = pseudoKey(pseudo);
  if (!key) throw new Error("wrong");
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email: `${key}@${ACCOUNT_DOMAIN}`, password });
  if (error) throw new Error(reason(error));
}

let user = null;
let syncState = "idle"; // idle | syncing | synced | error
const accountListeners = new Set();

function notifyAccount() {
  accountListeners.forEach((fn) => fn({ user, sync: syncState }));
}

export function onAccount(fn) {
  accountListeners.add(fn);
  fn({ user, sync: syncState });
  return () => accountListeners.delete(fn);
}

export function currentUser() {
  return user;
}

let welcomed = null;
function watchAuth(sb) {
  sb.auth.onAuthStateChange((event, session) => {
    const before = user?.id;
    user = session?.user || null;
    if (user && user.id !== before) {
      // Attendre la fin du traitement interne de Supabase avant de l'appeler à nouveau.
      setTimeout(() => {
        sync().then((ok) => {
          if (ok && event === "SIGNED_IN" && welcomed !== user?.id) {
            welcomed = user.id;
            window.dispatchEvent(new CustomEvent("duckdle:signed-in"));
          }
        });
      }, 0);
    }
    if (!user) syncState = "idle";
    notifyAccount();
  });
}

// Déconnexion : la progression reste dans le compte et quitte cet appareil. Seuls les
// derniers défis du jour restent notés, pour qu'on ne puisse pas les rejouer en invité.
export async function signOut() {
  const sb = await client();
  await sb.auth.signOut({ scope: "local" });
  rememberPlayed();
  setAccount(null);
  replaceState(blank());
  user = null;
  notifyAccount();
}

export async function deleteAccount() {
  await rpc("delete_account");
  const sb = await client();
  await sb.auth.signOut({ scope: "local" });
  // La progression de cet appareil reste, comme celle d'un joueur sans compte.
  setAccount(null);
  user = null;
  notifyAccount();
}

// ------------------------------------------------------------------ synchronisation

let syncing = null;
let again = false;

export function sync() {
  if (!user) return Promise.resolve(false);
  if (syncing) {
    again = true;
    return syncing;
  }
  syncState = "syncing";
  notifyAccount();
  syncing = syncProgress(() => user?.id || null, rpc)
    .then((changed) => {
      syncState = "synced";
      // Progression venue d'un autre appareil : les écrans affichés se mettent à jour.
      if (changed) window.dispatchEvent(new CustomEvent("duckdle:progress"));
      return true;
    })
    .catch((error) => {
      console.info("Synchronisation :", error?.message || error);
      syncState = "error";
      return false;
    })
    .finally(() => {
      syncing = null;
      notifyAccount();
      if (again) {
        again = false;
        sync();
      }
    });
  return syncing;
}

// Après chaque partie, une synchronisation un peu plus tard (plusieurs parties d'affilée = un envoi).
let timer = null;
onChange(() => {
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(sync, 1500);
});
