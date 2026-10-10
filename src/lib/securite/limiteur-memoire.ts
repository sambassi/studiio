/**
 * Limiteur de débit EN MÉMOIRE — fenêtres glissantes par clé.
 *
 * Chaque clé (typiquement un userId) garde l'horodatage de ses passages ;
 * un passage est accepté seulement si TOUTES les fenêtres ont encore de la
 * place (ex. 10 par minute ET 60 par heure). Un refus n'est pas compté.
 *
 * Limites assumées, écrites noir sur blanc :
 *   - la mémoire est celle DU processus : plusieurs instances = plusieurs
 *     compteurs, un redémarrage remet à zéro. C'est un garde-fou contre le
 *     clic en rafale et le script naïf, pas une facturation ;
 *   - le nombre de clés suivies est borné (`maxCles`) : au-delà, la clé la
 *     plus anciennement créée est oubliée, jamais de croissance sans fin.
 *
 * L'horloge est injectable (`maintenant`) pour que les tests avancent le
 * temps sans attendre.
 */

export interface FenetreLimite {
  /** Durée de la fenêtre glissante, en millisecondes. */
  dureeMs: number;
  /** Passages acceptés au plus dans cette fenêtre. */
  max: number;
}

export type ResultatLimite = { ok: true } | { ok: false; reessayerDansS: number };

export interface LimiteurMemoire {
  /** Compte un passage pour `cle` s'il est permis ; sinon dit dans combien de secondes réessayer. */
  consommer(cle: string): ResultatLimite;
  /** Oublie tout (tests). */
  reinitialiser(): void;
}

export function creerLimiteurMemoire(options: {
  fenetres: readonly FenetreLimite[];
  maintenant?: () => number;
  maxCles?: number;
}): LimiteurMemoire {
  const fenetres = options.fenetres.filter((f) => f.dureeMs > 0 && f.max > 0);
  const horizon = Math.max(0, ...fenetres.map((f) => f.dureeMs));
  const maintenant = options.maintenant ?? (() => Date.now());
  const maxCles = Math.max(1, options.maxCles ?? 10_000);
  const passages = new Map<string, number[]>();

  return {
    consommer(cle) {
      const t = maintenant();
      const liste = (passages.get(cle) ?? []).filter((h) => t - h < horizon);
      let attenteMs = 0;
      for (const f of fenetres) {
        const dansFenetre = liste.filter((h) => t - h < f.dureeMs);
        if (dansFenetre.length >= f.max) {
          // Le passage qui libère une place : le plus ancien parmi les `max` derniers.
          const liberateur = dansFenetre[dansFenetre.length - f.max];
          attenteMs = Math.max(attenteMs, liberateur + f.dureeMs - t);
        }
      }
      if (attenteMs > 0) {
        passages.set(cle, liste);
        return { ok: false, reessayerDansS: Math.max(1, Math.ceil(attenteMs / 1000)) };
      }
      liste.push(t);
      if (!passages.has(cle) && passages.size >= maxCles) {
        const plusAncienne = passages.keys().next().value;
        if (plusAncienne !== undefined) passages.delete(plusAncienne);
      }
      passages.set(cle, liste);
      return { ok: true };
    },
    reinitialiser() {
      passages.clear();
    },
  };
}
