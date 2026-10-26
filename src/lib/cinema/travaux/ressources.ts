/**
 * CINEMA IA — LES RESSOURCES DU SERVEUR avant un rendu lourd.
 *
 * Un rendu Remotion lance un Chromium et plusieurs processus : sur le petit
 * serveur partage avec l'application, deux rendus simultanes (Autopilote /
 * `/api/render` d'un cote, Cinema de l'autre) peuvent le mettre a genoux — ou
 * le faire tuer par le noyau (OOM). Cinema ATTEND donc son tour :
 *
 *   - tant qu'un rendu `renderVideo` du processus est actif
 *     (`rendusRemotionActifs`, le compteur PASSIF deja en place) ;
 *   - tant que la memoire libre est sous le seuil.
 *
 * Et il S'ANNONCE (`entrerRenduRemotion`) pendant son propre rendu, pour que
 * les autres le voient. L'Autopilote n'est pas modifie : il ne lit pas ce
 * compteur, il n'est jamais retarde par Cinema.
 *
 * L'attente est BORNEE : au-dela, le travail echoue avec une phrase claire
 * (« serveur occupe ») plutot que de rester « en cours » indefiniment.
 * ⚠️ `os.freemem()` voit la machine, pas le plafond du conteneur : c'est une
 * sentinelle grossiere, pas un quota.
 */
import os from 'os';
import { rendusRemotionActifs } from '@/lib/render/occupation-remotion';

export interface EtatRessources { rendusEnCours: number; ramLibreMo: number; cpus: number }
export interface SeuilsRessources { ramMinMo: number; delaiMaxMs: number; pasMs: number }

export const SEUILS_DEFAUT: SeuilsRessources = { ramMinMo: 1536, delaiMaxMs: 10 * 60_000, pasMs: 5_000 };

export function lireRessources(): EtatRessources {
  return { rendusEnCours: rendusRemotionActifs(), ramLibreMo: Math.floor(os.freemem() / 1_048_576), cpus: os.cpus().length };
}

/** Le motif de l'attente, ou `null` si le rendu peut partir. */
export function motifAttente(e: EtatRessources, s: SeuilsRessources): string | null {
  if (e.rendusEnCours > 0) return 'un autre rendu est en cours sur le serveur';
  if (e.ramLibreMo < s.ramMinMo) return `memoire du serveur insuffisante (${e.ramLibreMo} Mo libres, ${s.ramMinMo} Mo requis)`;
  return null;
}

/** Le serveur est reste occupe plus longtemps que la patience accordee. */
export class ServeurOccupe extends Error {
  constructor(motif: string) { super(`serveur occupe : ${motif}. Reessayez dans quelques minutes ; rien n'a ete rendu ni facture.`); this.name = 'ServeurOccupe'; }
}

export interface DependancesAttente {
  lire?: () => EtatRessources;
  seuils?: Partial<SeuilsRessources>;
  pause?: (ms: number) => Promise<void>;
  /** Appelee a chaque tour d'attente (renouvelle le bail, repere un arret demande). Peut lever. */
  surAttente?: (motif: string) => Promise<void>;
}

export async function attendreRessources(dep: DependancesAttente = {}): Promise<void> {
  const s = { ...SEUILS_DEFAUT, ...dep.seuils };
  const lire = dep.lire ?? lireRessources;
  const pause = dep.pause ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let attendu = 0;
  for (;;) {
    const motif = motifAttente(lire(), s);
    if (!motif) return;
    if (attendu >= s.delaiMaxMs) throw new ServeurOccupe(motif);
    await dep.surAttente?.(motif);
    await pause(s.pasMs);
    attendu += s.pasMs;
  }
}

/** Concurrence Chromium : 2 par defaut, 1 sur une machine a 2 coeurs ou moins, jamais plus de 4. */
export function concurrenceRendu(env: NodeJS.ProcessEnv = process.env, cpus = os.cpus().length): number {
  const demandee = Number(env.CINEMA_CONCURRENCE_RENDU);
  const base = Number.isInteger(demandee) && demandee >= 1 ? demandee : 2;
  return Math.max(1, Math.min(4, cpus <= 2 ? 1 : base));
}
