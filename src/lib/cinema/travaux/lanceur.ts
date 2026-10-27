/**
 * CINEMA IA — lancer un travail SANS bloquer la requete, et le reprendre.
 *
 * Le serveur de Studiio est un processus Node de longue duree (conteneur
 * Coolify), pas une fonction sans etat : une promesse non attendue y survit a
 * la reponse HTTP. Ce module ne cree pas de seconde architecture de file — la
 * file DURABLE est la table des travaux (un seul actif par film, bail, jeton
 * de prise). Ici il n'y a que :
 *
 *   - `demarrerTravail` : met l'executeur en file locale. UN seul rendu a la
 *     fois par processus : Chromium est le goulot, deux rendus de front sur le
 *     meme serveur ralentissent aussi Creer et l'Autopilote ;
 *   - `reprendreOrphelins` : relit la table et relance ce qui n'a plus
 *     d'executeur vivant (serveur redemarre, conteneur remplace, bail expire).
 *     Appelee a la lecture d'un travail, avec un espacement — pas de cron a
 *     poser, et un cron la rappellerait sans risque.
 */
import { executerTravail, type DependancesExecuteur } from '@/lib/cinema/travaux/executeur';
import type { DepotTravaux } from '@/lib/cinema/travaux/depot-travaux';

interface EtatLanceur {
  file: Promise<void>;
  enFile: Set<string>;
  derniereReprise: number;
}

const g = globalThis as unknown as { __cinemaLanceur?: EtatLanceur };
const etat = (): EtatLanceur => (g.__cinemaLanceur ??= { file: Promise.resolve(), enFile: new Set(), derniereReprise: 0 });

/** Espacement minimal entre deux reprises dans un processus. */
export const ESPACEMENT_REPRISE_MS = 30_000;

export function demarrerTravail(
  id: string, proprietaire: string, dependances: () => DependancesExecuteur,
  surFin?: (issue: string) => void,
): boolean {
  const e = etat();
  if (e.enFile.has(id)) return false;
  e.enFile.add(id);
  e.file = e.file.then(async () => {
    try {
      // ⚠️ Pas `surFin?.(await …)` : un appel optionnel n'evalue PAS son
      // argument quand la fonction est absente — l'executeur ne partirait jamais.
      const issue = await executerTravail(id, proprietaire, dependances());
      surFin?.(issue);
    } catch (err) {
      // Une exception ici n'est pas une erreur de production (l'executeur les
      // range en `echec`) : c'est le depot qui est injoignable. Le bail
      // expirera et la reprise rejouera le travail.
      console.error('[cinema/lanceur] executeur interrompu —', err instanceof Error ? (err.stack ?? err.message) : err);
    } finally {
      e.enFile.delete(id);
    }
  });
  return true;
}

/** Attend la fin de tout ce qui est en file (tests, arret propre). */
export function attendreFile(): Promise<void> { return etat().file; }

export async function reprendreOrphelins(
  travaux: DepotTravaux, dependances: () => DependancesExecuteur, maintenant = Date.now(),
): Promise<number> {
  const e = etat();
  if (maintenant - e.derniereReprise < ESPACEMENT_REPRISE_MS) return 0;
  e.derniereReprise = maintenant;
  let lances = 0;
  for (const t of await travaux.aReprendre(new Date(maintenant))) {
    if (demarrerTravail(t.id, t.proprietaire, dependances)) lances += 1;
  }
  return lances;
}

export function reinitialiserLanceurPourTests(): void {
  g.__cinemaLanceur = undefined;
}
