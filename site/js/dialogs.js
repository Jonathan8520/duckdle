// Feuilles latérales et fenêtres, avec ouverture et fermeture animées.
//
// Les animations passent par l'API Web Animations plutôt que par des transitions CSS :
// un <dialog> qui vient d'apparaître n'a pas encore d'état « avant » calculé, et Safari
// affichait alors la feuille d'un coup. Ici, le point de départ est donné explicitement.

import { h, icon, reducedMotion } from "./util.js";
import { t } from "./i18n.js";

// Départ en douceur (vitesse nulle), arrivée freinée : pas d'apparition brusque.
const EASE_OPEN = "cubic-bezier(.35, 0, .15, 1)";
const EASE_CLOSE = "cubic-bezier(.4, 0, .9, .4)";

// Dernière façon d'agir : au clavier, le focus va au premier bouton de la fenêtre ; au doigt
// ou à la souris, il reste sur la fenêtre (sinon Safari dessine un anneau sur « Fermer »).
let keyboard = false;
addEventListener("keydown", (event) => {
  if (!event.metaKey && !event.altKey && !event.ctrlKey) keyboard = true;
}, true);
addEventListener("pointerdown", () => {
  keyboard = false;
}, true);

function lockScroll(lock) {
  document.documentElement.style.overflow = lock ? "hidden" : "";
}

function parts(dialog) {
  return {
    scrim: dialog.querySelector(".scrim"),
    panel: dialog.querySelector(".sheet-inner, .modal-inner"),
    isSheet: dialog.classList.contains("sheet"),
  };
}

// Position de la feuille quand elle est cachée : à droite sur grand écran, en bas sur téléphone.
function hiddenTransform() {
  return window.matchMedia("(min-width: 760px)").matches ? "translateX(100%)" : "translateY(100%)";
}

function animateIn(dialog) {
  const { scrim, panel, isSheet } = parts(dialog);
  const reduce = reducedMotion();
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 120 : 340, easing: "ease-out", fill: "both" });
  let frames;
  if (reduce) frames = [{ opacity: 0 }, { opacity: 1 }];
  else if (isSheet) frames = [{ transform: hiddenTransform() }, { transform: "translate(0, 0)" }];
  else frames = [{ opacity: 0, transform: "translateY(18px) scale(.96)" }, { opacity: 1, transform: "translateY(0) scale(1)" }];
  const animation = panel.animate(frames, { duration: reduce ? 150 : isSheet ? 480 : 340, easing: EASE_OPEN, fill: "both" });
  return animation.finished.catch(() => {});
}

function animateOut(dialog) {
  const { scrim, panel, isSheet } = parts(dialog);
  const reduce = reducedMotion();
  // On repart de l'endroit où se trouve le panneau, même s'il était encore en train d'arriver.
  const from = getComputedStyle(panel);
  const start = { transform: from.transform === "none" ? "translate(0, 0)" : from.transform, opacity: from.opacity };
  const scrimFrom = getComputedStyle(scrim).opacity;
  for (const el of [scrim, panel]) el.getAnimations().forEach((a) => a.cancel());
  let end;
  if (reduce) end = { opacity: 0 };
  else if (isSheet) end = { transform: hiddenTransform() };
  else end = { opacity: 0, transform: "translateY(12px) scale(.97)" };
  const duration = reduce ? 120 : isSheet ? 300 : 220;
  const a = panel.animate([reduce ? { opacity: start.opacity } : start, end], { duration, easing: EASE_CLOSE, fill: "forwards" });
  const b = scrim.animate([{ opacity: scrimFrom }, { opacity: 0 }], { duration, easing: "ease-in", fill: "forwards" });
  return Promise.all([a.finished, b.finished]).catch(() => {});
}

function mount(dialog) {
  // Safari fait défiler la fenêtre pour montrer l'élément qui reçoit le focus. Pendant l'arrivée,
  // le bouton est encore hors de l'écran : le panneau sautait vers le haut puis redescendait.
  // Le focus va donc d'abord à la fenêtre elle-même, puis au bon bouton une fois en place.
  dialog.tabIndex = -1;
  dialog.setAttribute("autofocus", "");
  const target = dialog.querySelector("[data-autofocus]") || dialog.querySelector(".sheet-head .icon-btn, .picture-close, button");
  document.body.append(dialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(dialog);
  });
  // Un clic sur le voile, en dehors du contenu, ferme la fenêtre.
  dialog.querySelector(".scrim").addEventListener("click", () => close(dialog));
  // Aucun défilement interne ne doit déplacer le panneau.
  dialog.addEventListener("scroll", () => {
    dialog.scrollTop = 0;
    dialog.scrollLeft = 0;
  });
  dialog.showModal();
  dialog.scrollTop = 0;
  lockScroll(true);
  animateIn(dialog).then(() => {
    if (keyboard && dialog.open && !dialog.dataset.closing) target?.focus({ preventScroll: true });
  });
  return dialog;
}

export function close(dialog, value) {
  if (!dialog || dialog.dataset.closing) return Promise.resolve();
  dialog.dataset.closing = "1";
  return animateOut(dialog).then(() => {
    dialog.close(value);
    dialog.remove();
    if (!document.querySelector("dialog[open]")) lockScroll(false);
    dialog.dispatchEvent(new CustomEvent("closed", { detail: value }));
    return value;
  });
}

// Panneau qui glisse depuis la droite (ou du bas sur téléphone).
export function openSheet(title, body, { onClose } = {}) {
  document.querySelectorAll("dialog.sheet").forEach((d) => close(d));
  const heading = h("h2", { id: `sheet-${Date.now()}` }, title);
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-labelledby": heading.id },
    h("div", { class: "scrim", "aria-hidden": "true" }),
    h(
      "div",
      { class: "sheet-inner" },
      h(
        "div",
        { class: "sheet-head" },
        heading,
        h("button", { class: "icon-btn", type: "button", "aria-label": t("common.close"), onclick: () => close(dialog) }, icon("i-close")),
      ),
      h("div", { class: "sheet-body" }, body),
    ),
  );
  if (onClose) dialog.addEventListener("closed", onClose);
  return mount(dialog);
}

// Petite fenêtre de confirmation. Résout avec true si l'action est confirmée.
export function confirmDialog({ title, text, confirm, cancel = t("common.cancel") }) {
  return new Promise((resolve) => {
    let answer = false;
    const heading = h("h2", { id: `modal-${Date.now()}` }, title);
    const dialog = h(
      "dialog",
      { class: "modal", "aria-labelledby": heading.id },
      h("div", { class: "scrim", "aria-hidden": "true" }),
      h(
        "div",
        { class: "modal-inner" },
        heading,
        text ? h("p", {}, text) : null,
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn", type: "button", onclick: () => { answer = true; close(dialog); } }, confirm),
          h("button", { class: "btn btn-ghost", type: "button", "data-autofocus": true, onclick: () => close(dialog) }, cancel),
        ),
      ),
    );
    dialog.addEventListener("closed", () => resolve(answer));
    mount(dialog);
  });
}

// Planches en grand, une ou plusieurs. Avec plusieurs : flèches, touches ← → et glissement
// du doigt sur l'image. slides : [{ src, alt, caption }]
export function openGallery(slides, start = 0) {
  if (!slides?.length) return null;
  let index = Math.min(Math.max(0, start), slides.length - 1);
  const many = slides.length > 1;
  const frame = h("div", { class: "picture-frame" });
  const caption = h("div", { class: "picture-caption" });
  const position = h("span", { class: "picture-position", "aria-live": "polite" });
  const step = (delta, label, name) =>
    h("button", { class: "icon-btn picture-step", type: "button", "aria-label": t(label), onclick: () => go(delta) }, icon(name));
  const prev = step(-1, "picture.prev", "i-left");
  const next = step(1, "picture.next", "i-right");
  // Flèches posées sur les bords de l'image, numéro en haut à gauche : la légende garde la place.
  const stage = h("div", { class: "picture-stage" }, frame, many ? [prev, next, position] : null);
  const dialog = h(
    "dialog",
    { class: "modal picture" },
    h("div", { class: "scrim", "aria-hidden": "true" }),
    h(
      "div",
      { class: "modal-inner" },
      h("button", { class: "icon-btn picture-close", type: "button", "aria-label": t("common.close"), onclick: () => close(dialog) }, icon("i-close")),
      stage,
      caption,
    ),
  );
  // L'image prend la hauteur que la légende lui laisse (la légende change d'une planche à l'autre).
  const fit = () => {
    const room = window.innerHeight - 32 - 28 - 14 - caption.offsetHeight;
    frame.style.setProperty("--room", `${Math.max(180, Math.floor(room))}px`);
  };
  window.addEventListener("resize", fit);
  dialog.addEventListener("closed", () => window.removeEventListener("resize", fit));

  function show(direction = 0) {
    const slide = slides[index];
    const img = h("img", { src: slide.src, alt: slide.alt || "", decoding: "async" });
    img.addEventListener("error", () => frame.replaceChildren(h("p", { class: "picture-missing" }, t("common.image_missing"))));
    frame.replaceChildren(img);
    if (direction && !reducedMotion()) {
      img.animate([{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE_OPEN });
    }
    caption.replaceChildren(...[slide.caption].flat().filter(Boolean));
    dialog.setAttribute("aria-label", slide.alt || "");
    if (dialog.isConnected) fit();
    if (!many) return;
    position.textContent = t("picture.position", { n: index + 1, total: slides.length });
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    // Les voisines se chargent à l'avance : passer de l'une à l'autre ne laisse pas de vide.
    for (const k of [index - 1, index + 1]) if (slides[k]) new Image().src = slides[k].src;
  }

  function go(delta) {
    const target = index + delta;
    if (target < 0 || target >= slides.length || target === index) return;
    index = target;
    show(delta);
  }

  if (many) {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    });
    // Glisser d'un doigt, nettement à l'horizontale ; le pincement pour zoomer reste libre.
    let from = null;
    frame.addEventListener("touchstart", (event) => {
      const zoomed = (window.visualViewport?.scale || 1) > 1.05;
      from = event.touches.length === 1 && !zoomed ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }, { passive: true });
    frame.addEventListener("touchend", (event) => {
      if (!from || event.touches.length) return (from = null);
      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      from = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > 1.6 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  show();
  mount(dialog);
  fit();
  return dialog;
}

// Une seule planche, avec sa légende.
export function openPicture({ src, alt, caption }) {
  return openGallery([{ src, alt, caption }]);
}
