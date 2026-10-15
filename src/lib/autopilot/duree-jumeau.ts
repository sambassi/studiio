/**
 * LA DURÉE DU JUMEAU — mesurée, jamais inventée (PR A1).
 *
 * La séquence « Vidéo » d'un montage-jumeau dure la parole de l'avatar. Avant
 * ce module, une sonde en échec rendait `null`, converti en `0` au montage
 * (`jumeauSeconds ?? 0`) ; la fabrique du design posait alors une séquence
 * Vidéo de 0 s, que `planSequences` SUPPRIME : l'avatar, déjà payé,
 * disparaissait du montage sans un mot.
 *
 * Désormais :
 *   1. la sonde habituelle (`probeRushSeconds`, `@remotion/media-parser`) ;
 *   2. en secours, une mesure LOCALE indépendante : le fichier du jumeau est
 *      lu dans NOTRE stockage (MinIO, lecture interne) et sondé par ffprobe
 *      (fichier local, protocole `file` seul). Aucun fournisseur, aucun crédit.
 *   3. aucune durée fiable → `null` : l'appelant ARRÊTE le montage
 *      (`JumeauIllisibleError`) au lieu de le produire sans avatar.
 *
 * ⚠️ La `duration_seconds` d'`avatar_generations` n'est PAS un secours : c'est
 * la durée ANNONCÉE par le fournisseur (`statut.ts`), pas une mesure du
 * fichier stocké (qui peut avoir été recadré/réencodé au rapatriement), et
 * rien ne permet de la vérifier sans mesurer le fichier — ce que fait déjà
 * le secours. Aucune estimation (longueur du texte) n'est jamais utilisée.
 */

import { probeRushSeconds } from '@/lib/autopilot/poster';
import { DUREE_CIBLE_MAX_SECONDES } from '@/lib/autopilot/analyse/montage-contrat';

/**
 * Plafond d'une durée de jumeau acceptée. Aucune constante propre au jumeau
 * n'existe dans le code : c'est la durée MAXIMALE d'un montage du produit
 * (`DUREE_CIBLE_MAX_SECONDES`, 120 s — celle que borne `MONTAGE_DUREE_MAX`).
 * Le script d'un jumeau d'Autopilote est borné à 600 caractères, bien en deçà.
 */
export const DUREE_JUMEAU_MAX_S = DUREE_CIBLE_MAX_SECONDES;

/** Une durée exploitable : nombre fini, > 0, ≤ plafond. Sinon `null`. Pure. */
export function dureeJumeauValide(s: unknown): number | null {
  return typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= DUREE_JUMEAU_MAX_S ? s : null;
}

/** Code porté par l'erreur — reconnu sans `instanceof` (modules doublés en test). */
export const CODE_JUMEAU_ILLISIBLE = 'jumeau_illisible';

/** Le message lu par l'utilisateur. */
export const MESSAGE_JUMEAU_ILLISIBLE = 'La vidéo de votre avatar est illisible : le montage n’a pas été produit.';

/** Levée par `produireUnMontage` AVANT tout rendu, tout débit, toute affiche IA. */
export class JumeauIllisibleError extends Error {
  readonly code = CODE_JUMEAU_ILLISIBLE;
  constructor(readonly url: string) {
    super(MESSAGE_JUMEAU_ILLISIBLE);
    this.name = 'JumeauIllisibleError';
  }
}

export function estJumeauIllisible(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === CODE_JUMEAU_ILLISIBLE;
}

export interface MesureJumeau {
  secondes: number;
  methode: 'sonde' | 'secours';
}

export interface DepsMesureJumeau {
  /** 1re méthode — par défaut `probeRushSeconds(url, {}, userId)`, inchangée. */
  sonder?: (url: string, userId: string) => Promise<number | null>;
  /** Secours : la durée du fichier lu dans notre stockage (`null` : rien de fiable). */
  secours?: (url: string, userId: string) => Promise<number | null>;
}

/**
 * La durée FIABLE du jumeau, ou `null`. Ne lève jamais.
 */
export async function mesurerDureeJumeau(
  args: { url: string; userId: string },
  deps: DepsMesureJumeau = {},
): Promise<MesureJumeau | null> {
  const sonder = deps.sonder ?? ((u: string, id: string) => probeRushSeconds(u, {}, id));
  const secours = deps.secours ?? dureeFichierStocke;
  let premiere: unknown = null;
  try { premiere = await sonder(args.url, args.userId); } catch { premiere = null; }
  const ok = dureeJumeauValide(premiere);
  if (ok !== null) return { secondes: ok, methode: 'sonde' };

  let seconde: unknown = null;
  try { seconde = await secours(args.url, args.userId); } catch { seconde = null; }
  const ok2 = dureeJumeauValide(seconde);
  if (ok2 !== null) {
    console.warn(`[Jumeau][durée] sonde illisible (${String(premiere)}), durée mesurée en secours : ${ok2.toFixed(2)} s`);
    return { secondes: ok2, methode: 'secours' };
  }
  console.error(`[Jumeau][durée] aucune durée fiable (sonde ${String(premiere)}, secours ${String(seconde)}) : ${args.url}`);
  return null;
}

/**
 * Secours par défaut : le jumeau DE CE COMPTE, lu en interne dans MinIO
 * (jamais par le relais public, jamais une URL tierce), écrit dans un dossier
 * temporaire privé et sondé par ffprobe. Toute autre URL : `null`.
 */
async function dureeFichierStocke(url: string, userId: string): Promise<number | null> {
  const { cibleJumeau, depotJumeauxParDefaut, BUCKET_JUMEAUX, TAILLE_MAX_JUMEAU } = await import('@/lib/avatar/jumeau-plein-cadre');
  const cible = cibleJumeau(url, userId);
  if (cible.genre !== 'source' && cible.genre !== 'derivee') return null;
  const depot = await depotJumeauxParDefaut();
  const contenu = await depot.lire(BUCKET_JUMEAUX, cible.cle, TAILLE_MAX_JUMEAU);
  if (!contenu || contenu.length === 0) return null;
  return dureeDuContenu(contenu);
}

/** ffprobe sur un contenu en mémoire (fichier local temporaire). `null` si illisible. */
export async function dureeDuContenu(contenu: Buffer): Promise<number | null> {
  const { dossierTemporaire, retirerDossierTemporaire, infosVideo } = await import('@/lib/avatar/preparation-source');
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let dossier: string | null = null;
  try {
    dossier = await dossierTemporaire();
    const chemin = join(dossier, 'jumeau.mp4');
    await writeFile(chemin, contenu);
    const infos = await infosVideo(chemin);
    return dureeJumeauValide(infos.dureeS);
  } catch {
    return null;
  } finally {
    await retirerDossierTemporaire(dossier);
  }
}
