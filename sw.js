// Réseau d'abord, cache en secours : l'appli reste à jour et s'ouvre même hors ligne.
//
// Deux caches : celui de l'appli, renouvelé à chaque déploiement, et celui des données et
// des traductions, gardé d'une version à l'autre (sinon, juste après une mise à jour, l'appli
// s'ouvrirait hors ligne sans rien à montrer).
const SHELL_CACHE = "duckdle-09721b4";
const DATA_CACHE = "duckdle-data";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/game.js", "js/views.js", "js/data.js", "js/util.js", "js/rng.js", "js/store.js", "js/dialogs.js", "js/i18n.js", "js/modes.js", "js/online.js", "js/sync.js", "js/social.js", "js/pictures.js", "i18n/fr.json", "icons/favicon.svg", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // cache: "reload" : la nouvelle version vient du serveur, pas du cache HTTP du navigateur.
  const requests = SHELL.map((path) => new Request(path, { cache: "reload" }));
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const data = /\/(data|i18n)\//.test(url.pathname);
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(data ? DATA_CACHE : SHELL_CACHE).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(event.request, { ignoreSearch: true });
        if (hit) return hit;
        // La page d'accueil seulement pour une page : un fichier JSON ou un module qui
        // recevrait du HTML échouerait de façon bien plus confuse.
        if (event.request.mode === "navigate") return (await caches.match("index.html")) || Response.error();
        return Response.error();
      }),
  );
});
