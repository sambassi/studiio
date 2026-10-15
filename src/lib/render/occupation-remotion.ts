/**
 * A2.3 — compteur PASSIF des rendus Remotion en cours dans ce processus.
 *
 * Incrémenté à l'entrée de `renderVideo` (`worker.ts`), décrémenté dans son
 * `finally`. Il ne refuse RIEN : le worker se comporte exactement comme
 * avant. Seul le rendu serveur A2.3 le LIT, pour ne pas lancer un second
 * Chromium pendant qu'un autre rendu (Autopilote, `/api/render`) tourne.
 * L'Autopilote ne le lit pas : A2.3 ne le bloque jamais.
 *
 * Module feuille, sans import : la route A2.3 le lit sans charger Remotion.
 * Ne compte que les rendus passés par `renderVideo` — le rendu hybride
 * (ffmpeg) de l'Autopilote n'y figure pas.
 */
let actifs = 0;

/** Combien de `renderVideo` sont en cours dans ce processus. */
export function rendusRemotionActifs(): number {
  return actifs;
}

/** Entre dans un rendu ; la fonction rendue en sort (idempotente). */
export function entrerRenduRemotion(): () => void {
  actifs += 1;
  let sorti = false;
  return () => {
    if (sorti) return;
    sorti = true;
    actifs -= 1;
  };
}
