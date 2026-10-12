// Synchronisation de la progression avec le compte : fusion sans double comptage.
//
// Un appareil rattaché à un compte garde la liste des parties pas encore envoyées. Pour
// synchroniser, on relit la version en ligne, on y rejoue ces parties, on réunit les défis
// joués, puis on écrit seulement si personne n'a écrit entre-temps (sinon on recommence).
// La première fois, toute la progression invitée de l'appareil s'ajoute au compte.

import { blank, normalize, getState, getAccount, setAccount, replaceState, applyGame, addCounters, mergeMaps } from "./store.js?v=afcf8db";

// Renvoie true si la progression de l'appareil a changé (parties venues d'ailleurs).
export async function syncProgress(currentUserId, rpc) {
  let changed = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const me = currentUserId();
    if (!me) return changed;
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
    const dirty = linking ? 0 : account.dirty;
    const remote = await rpc("load_progress");

    // Rien de neuf de part et d'autre : la version locale est déjà la bonne.
    if (!linking && !sent && !dirty && remote && remote.updated_at === account.base) return changed;

    const merged = remote ? normalize(remote.state) : blank();
    if (linking) addCounters(merged, local);
    else for (const game of account.pending.slice(0, sent)) applyGame(merged, game);
    mergeMaps(merged, local);
    const stamp = await rpc("save_progress", { new_state: merged, base: remote?.updated_at ?? null });
    if (!stamp) continue; // un autre appareil a écrit entre-temps : on relit et on recommence

    // Les parties finies pendant l'envoi restent à envoyer, et s'ajoutent à la version locale,
    // comme le défi du jour avancé entre-temps.
    const after = getAccount();
    const later = after.pending.slice(sent);
    const next = normalize(structuredClone(merged));
    for (const game of later) applyGame(next, game);
    mergeMaps(next, normalize(structuredClone(getState())));
    const stillDirty = after.dirty !== dirty ? after.dirty : 0;
    if (JSON.stringify(next) !== JSON.stringify(getState())) changed = true;
    replaceState(next);
    setAccount({ owner: me, base: stamp, pending: later, dirty: stillDirty });
    if (!later.length && !stillDirty) return changed;
  }
  throw new Error("trop de conflits");
}
