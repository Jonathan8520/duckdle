// Synchronisation de la progression avec le compte : fusion sans double comptage.
//
// Un appareil rattaché à un compte garde la liste des parties pas encore envoyées. Pour
// synchroniser, on relit la version en ligne, on y rejoue ces parties, on réunit les défis
// joués, puis on écrit seulement si personne n'a écrit entre-temps (sinon on recommence).
// La première fois, toute la progression invitée de l'appareil s'ajoute au compte.

import { blank, normalize, getState, getAccount, setAccount, replaceState, applyGame, addCounters, mergeMaps } from "./store.js";

export async function syncProgress(currentUserId, rpc) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const me = currentUserId();
    if (!me) return;
    let account = getAccount();
    // Premier lien de cet appareil avec ce compte : toute la progression invitée s'y ajoute.
    // Le lien est noté tout de suite, pour que les parties finies pendant l'envoi soient gardées.
    const linking = account.owner !== me || account.linking;
    if (linking) {
      account = { owner: me, base: null, pending: [], linking: true };
      setAccount(account);
    }
    const local = normalize(structuredClone(getState()));
    const sent = linking ? 0 : account.pending.length;
    const remote = await rpc("load_progress");

    // Rien de neuf de part et d'autre : la version locale est déjà la bonne.
    if (!linking && !sent && remote && remote.updated_at === account.base) return;

    const merged = remote ? normalize(remote.state) : blank();
    if (linking) addCounters(merged, local);
    else for (const game of account.pending.slice(0, sent)) applyGame(merged, game);
    mergeMaps(merged, local);
    const stamp = await rpc("save_progress", { new_state: merged, base: remote?.updated_at ?? null });
    if (!stamp) continue; // un autre appareil a écrit entre-temps : on relit et on recommence

    // Les parties finies pendant l'envoi restent à envoyer, et s'ajoutent à la version locale.
    const later = getAccount().pending.slice(sent);
    const next = normalize(structuredClone(merged));
    for (const game of later) applyGame(next, game);
    replaceState(next);
    setAccount({ owner: me, base: stamp, pending: later });
    if (!later.length) return;
  }
  throw new Error("trop de conflits");
}
