// Planches en grand : une légende commune (titre, dessinateur, liens vers Inducks) pour la
// fin de partie, le défi déjà joué, l'atelier et la case tout juste révélée.

import { h, capitalize } from "./util.js?v=09721b4";
import { t, tn, quote } from "./i18n.js?v=09721b4";
import { imageUrl, storyUrl, artistUrl, issueUrl, storyTitle } from "./data.js?v=09721b4";

const external = (href, ...text) => h("a", { href, target: "_blank", rel: "noopener" }, ...text);

// Une planche pour la visionneuse. note : une ligne de plus, par exemple la réponse donnée.
export function pageSlide(item, people, { note = null } = {}) {
  const name = people?.[item.artist]?.name || item.artist;
  const title = storyTitle(item) || t("common.untitled");
  const original = item.original && item.original !== title ? item.original : null;
  const issue = item.issue ? String(item.issue).replace(/\s+/g, " ") : null;
  return {
    src: imageUrl(item),
    alt: t("atelier.page_of", { name }),
    caption: [
      h("p", { class: "picture-title" }, h("strong", {}, quote(title)), item.year ? ` (${item.year})` : ""),
      original ? h("p", { class: "picture-original" }, t("picture.original", { title: quote(original) })) : null,
      h("p", {}, tn("picture.drawn_by", { name: external(artistUrl(item.artist), name) })),
      note ? h("p", { class: "picture-note" }, note) : null,
      h(
        "p",
        { class: "picture-links" },
        external(storyUrl(item.story), capitalize(t("common.see_story"))),
        issue ? [" · ", tn("picture.issue", { issue: external(issueUrl(item.issue), issue) })] : null,
      ),
    ],
  };
}
