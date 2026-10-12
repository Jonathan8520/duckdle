// Morceaux d'interface du jeu en ligne : joueurs en ligne, statistiques communes, compte.
// Chaque bloc s'affiche seulement quand les chiffres arrivent : hors ligne, rien ne bouge.

import { h, icon, number, dayKey, toast } from "./util.js?v=afcf8db";
import { t } from "./i18n.js?v=afcf8db";
import { confirmDialog, openSheet } from "./dialogs.js?v=afcf8db";
import { getState, getAccount } from "./store.js?v=afcf8db";
import {
  watchOnline, liveStats, dailyStats, onAccount, accountsOpen, signIn, signUp,
  signOut, deleteAccount, pseudoKey, PASSWORD_MIN, MIN_PANEL_ATTEMPTS,
} from "./online.js?v=afcf8db";

const percent = (n) => t("stats.percent", { n: Math.round(n) });
const points = (n) => t("common.points", { n });

function reveal(el) {
  el.hidden = false;
  el.classList.add("arrive");
}

// ------------------------------------------------------------------ accueil

export function liveLine() {
  const label = h("span", {});
  const online = h("span", { class: "live-online", hidden: true }, h("i", { class: "live-dot", "aria-hidden": "true" }), label);
  const games = h("span", { class: "live-games", hidden: true });
  const line = h("p", { class: "live", hidden: true }, online, games);
  const update = () => {
    if (!online.hidden || !games.hidden) reveal(line);
  };
  let seen = false;
  const stop = watchOnline((n) => {
    if (seen && !line.isConnected) return stop();
    seen = true;
    // Seul en ligne, on ne l'affiche pas : « 1 joueur en ligne », c'est soi-même.
    online.hidden = n < 2;
    label.textContent = t("live.online", { n });
    update();
  });
  liveStats(dayKey()).then((stats) => {
    if (!stats?.games_24h) return;
    games.textContent = t("live.games_24h", { n: stats.games_24h });
    games.hidden = false;
    update();
  });
  return line;
}

// Sous le défi du jour : combien l'ont déjà joué, ou comment ils s'en sont sortis.
export function dailyCrowd(day, done) {
  const line = h("p", { class: "daily-crowd", hidden: true });
  if (done && !done.partial) {
    dailyStats(day, done.score).then((stats) => {
      if (!stats?.players) return;
      line.textContent = t("daily.crowd", { n: stats.players, average: points(stats.average) });
      reveal(line);
    });
  } else if (!done) {
    liveStats(day).then((stats) => {
      if (!stats?.daily_players) return;
      line.textContent = t("daily.crowd_before", { n: stats.daily_players });
      reveal(line);
    });
  }
  return line;
}

// ------------------------------------------------------------------ fin de partie

// Défi du jour (ou défi passé) : rang parmi les joueurs et répartition des cases trouvées.
export function crowdSection({ day, score, correct, archive = false, after = null }) {
  const box = h("section", { class: "crowd", hidden: true, "aria-labelledby": "crowd-title" });
  Promise.resolve(after)
    .then(() => dailyStats(day, score))
    .then((stats) => {
      if (!stats?.players) return;
      const most = Math.max(1, ...stats.correct);
      const alone = !archive && stats.players === 1;
      const rows = stats.correct.map((n, k) =>
        h(
          "li",
          { class: k === correct ? "mine" : null, style: { "--share": String(n / most) } },
          h("span", { class: "crowd-k" }, String(k)),
          h("span", { class: "crowd-bar" }, h("i", {})),
          h("span", { class: "crowd-n" }, number.format(n)),
        ),
      );
      box.append(
        h("h2", { id: "crowd-title" }, t("end.crowd.title")),
        h(
          "p",
          { class: "crowd-line" },
          alone ? t("end.crowd.first") : t(archive ? "end.crowd.better_archive" : "end.crowd.better", { percent: percent(stats.better_than ?? 0) }),
        ),
        h("p", { class: "muted" }, t("end.crowd.summary", { n: stats.players, average: points(stats.average) })),
        h("figure", { class: "crowd-figure" }, h("figcaption", {}, t("end.crowd.chart")), h("ol", { class: "crowd-chart" }, rows)),
      );
      reveal(box);
    });
  return box;
}

// Part des joueurs qui ont trouvé une case, quand assez de monde l'a vue.
export function panelShare(stat) {
  if (!stat || stat.attempts < MIN_PANEL_ATTEMPTS) return null;
  return percent((100 * stat.found) / stat.attempts);
}

// ------------------------------------------------------------------ compte

function who(user) {
  const meta = user.user_metadata || {};
  return meta.pseudo || String(user.email || "?").split("@")[0];
}

const SYNC_TEXT = { syncing: "account.syncing", synced: "account.synced", error: "account.sync_error" };

// Pastille ronde : l'initiale du pseudo une fois connecté, une silhouette sinon. La petite
// marque en bas à droite dit où en est la synchronisation.
function avatar(user, sync, { big = false } = {}) {
  const name = user ? who(user) : "";
  return h(
    "span",
    { class: `account-avatar${user ? " is-user" : ""}${big ? " is-big" : ""}`, "data-sync": user ? sync : null, "aria-hidden": "true" },
    name ? name.trim().charAt(0).toLocaleUpperCase() : icon("i-user"),
  );
}

// Bouton du compte dans la barre du haut : on voit d'un coup d'œil si l'on est connecté.
export function initAccountButton() {
  const button = document.querySelector("[data-open=account]");
  if (!button) return;
  let current = { user: null, sync: "idle" };
  const draw = () => {
    const { user, sync } = current;
    // Compte lié à cet appareil, session pas encore relue : pas de « Se connecter » trompeur.
    const pending = !user && Boolean(getAccount().owner);
    button.classList.toggle("is-signed-in", Boolean(user));
    button.querySelector(".account-avatar").replaceWith(avatar(user, sync));
    button.querySelector(".account-name").textContent = user ? who(user) : pending ? "" : t("account.sign_in");
    button.setAttribute("aria-label", user ? t("nav.account_signed_in", { who: who(user) }) : t("nav.account"));
  };
  onAccount((state) => {
    current = state;
    draw();
  });
  window.addEventListener("duckdle:lang", draw);
}

export function openAccount() {
  openSheet(t("nav.account"), accountSection());
}

// Une ligne dans « Mes statistiques », qui renvoie vers la feuille du compte.
export function accountLine() {
  const line = h("button", { class: "account-line", type: "button", onclick: openAccount });
  let drawn = false;
  const stop = onAccount(({ user, sync }) => {
    if (drawn && !line.isConnected) return stop();
    drawn = true;
    line.replaceChildren(
      avatar(user, sync),
      h("span", { class: "account-line-text" }, user ? t("account.signed_in", { who: who(user) }) : t("account.local_only")),
      h("span", { class: "account-line-action" }, user ? t("account.manage") : t("account.sign_in")),
    );
  });
  return line;
}

export function accountSection() {
  const box = h("section", { class: "account" });
  let drawn = false;
  const stop = onAccount(({ user, sync }) => {
    if (drawn && !box.isConnected) return stop();
    drawn = true;
    if (user) signedIn(box, user, sync);
    else signedOut(box);
  });
  return box;
}

function signedIn(box, user, sync) {
  const status = SYNC_TEXT[sync];
  const games = Object.values(getState().modes).reduce((total, m) => total + (m.played || 0), 0);
  box.replaceChildren(
    h(
      "div",
      { class: "account-card" },
      avatar(user, sync, { big: true }),
      h("div", {}, h("strong", { class: "account-card-name" }, who(user)), h("p", { class: "muted", role: "status" }, status ? t(status) : "")),
    ),
    h("p", {}, t("account.progress", { n: games })),
    h(
      "div",
      { class: "btn-row" },
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: async () => {
            const ok = await confirmDialog({ title: t("account.sign_out_title"), text: t("account.sign_out_text"), confirm: t("account.sign_out"), cancel: t("common.cancel") });
            if (!ok) return;
            await signOut().catch(() => {});
            toast(t("account.signed_out"));
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          },
        },
        t("account.sign_out"),
      ),
      h(
        "button",
        {
          class: "btn btn-ghost btn-small",
          type: "button",
          onclick: async () => {
            const ok = await confirmDialog({ title: t("account.delete_title"), text: t("account.delete_text"), confirm: t("account.delete_confirm"), cancel: t("common.cancel") });
            if (!ok) return;
            try {
              await deleteAccount();
              toast(t("account.deleted"));
            } catch {
              toast(t("account.error"));
            }
          },
        },
        t("account.delete"),
      ),
    ),
  );
}

function signedOut(box) {
  const area = h("div", { class: "account-choices" });
  box.replaceChildren(h("p", {}, t("account.pitch")), area);
  accountsOpen().then((open) => {
    area.replaceChildren(open ? accountForm() : h("p", { class: "muted" }, t("account.unavailable")));
  });
}

function accountForm() {
  const field = (props, label) => h("label", { class: "field" }, h("span", {}, label), h("input", { class: "text-input", ...props }));
  const pseudo = field(
    { name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true, minlength: 3, maxlength: 20 },
    t("account.pseudo"),
  );
  const password = field({ name: "password", type: "password", autocomplete: "current-password", required: true, minlength: PASSWORD_MIN }, t("account.password"));
  const note = h("p", { class: "account-note", role: "status" });
  const login = h("button", { class: "btn btn-yellow", type: "submit", value: "in" }, t("account.sign_in"));
  const create = h("button", { class: "btn", type: "submit", value: "up" }, t("account.sign_up"));
  const form = h(
    "form",
    { class: "account-form", novalidate: true },
    pseudo,
    password,
    h("div", { class: "btn-row" }, login, create),
    note,
    h("p", { class: "muted" }, t("account.rules", { n: PASSWORD_MIN })),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const creating = event.submitter?.value === "up";
    const name = pseudo.querySelector("input").value.trim();
    const secret = password.querySelector("input").value;
    note.textContent = "";
    if (!pseudoKey(name)) {
      note.textContent = t(creating ? "account.bad_pseudo" : "account.wrong");
      return;
    }
    if (creating && secret.length < PASSWORD_MIN) {
      note.textContent = t("account.short_password", { n: PASSWORD_MIN });
      return;
    }
    // Un gestionnaire de mots de passe doit savoir qu'il s'agit d'un nouveau mot de passe.
    password.querySelector("input").autocomplete = creating ? "new-password" : "current-password";
    login.disabled = create.disabled = true;
    try {
      await (creating ? signUp(name, secret) : signIn(name, secret));
    } catch (error) {
      const known = ["taken", "short_password", "wrong", "busy", "bad_pseudo"];
      note.textContent = t(known.includes(error.message) ? `account.${error.message}` : "account.error", { n: PASSWORD_MIN });
    } finally {
      login.disabled = create.disabled = false;
    }
  });
  return form;
}
