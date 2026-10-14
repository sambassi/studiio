/**
 * A2.3 — MOTEUR D'EXPORT SERVEUR, derrière un interrupteur éteint par défaut.
 *
 * Un rendu Remotion côté serveur pour une tentative `rendus` DÉJÀ réservée
 * (`/api/render/jobs`), à la place du compositeur navigateur. Le rendu
 * produit l'objet à la clé que le serveur avait lui-même attribuée, puis la
 * tentative passe par la MÊME porte de confirmation que le navigateur
 * (`confirmerAvecPreuve`) : même preuve, même politique, même débit unique.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   • aucune réservation, aucun tarif : la ligne existe déjà, son format
 *     facturé (`rendus.format`) fait foi ;
 *   • aucun nouveau mapper : la spec part telle quelle dans
 *     `renderCreerSimple`, donc dans `versEntreeRemotion` ;
 *   • aucun verrou partagé : la place et l'ensemble des travaux en cours
 *     vivent dans CE processus (conteneur unique). Deux conteneurs ne se
 *     verraient pas — limite assumée d'A2.3.
 *
 * Le compteur est SÉPARÉ de celui de l'Autopilote (`capacite.ts`) : un
 * export demandé depuis Créer ne doit pas être refusé parce qu'un montage de
 * rushes tourne, et inversement.
 */
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import type { SpecRendu } from '@/lib/render/spec-rendu';
import type { LigneRendu } from '@/lib/rendus/confirmation';

/** L'interrupteur, et lui seul. Lu à CHAQUE appel, jamais mémoïsé. */
export function moteurExportServeurActif(): boolean {
  return process.env.MOTEUR_EXPORT_SERVEUR === 'true';
}

/** Budget d'un rendu serveur : au-delà, il est annulé et la tentative échoue. */
export const DELAI_RENDU_SERVEUR_MS = 600_000;

/** Une seule composition Remotion à la fois sur ce serveur. */
export const MAX_RENDUS_SERVEUR_SIMULTANES = 1;

/** Opérations dont la tentative peut être rendue par le serveur. */
export const OPERATIONS_RENDU_SERVEUR = ['apercu', 'bureau', 'calendrier'] as const;

let rendusEnCours = 0;
const jobsEnCours = new Set<string>();
const travaux = new Map<string, Promise<IssueRenduServeur>>();

export interface PlaceRenduServeur {
  /** IDEMPOTENTE : un second appel ne rend ni la place ni le job deux fois. */
  liberer(): void;
}

/**
 * Prend, d'un seul tenant et sans attente, le job ET la place.
 *
 * Synchrone : deux requêtes simultanées ne peuvent pas passer toutes deux le
 * contrôle. Le même job déjà en cours → `deja_en_cours` (409) ; un autre job
 * occupe la place → `capacite_saturee` (429).
 */
export function prendreExecution(jobId: string):
  | { ok: true; place: PlaceRenduServeur }
  | { ok: false; motif: 'deja_en_cours' | 'capacite_saturee' } {
  if (jobsEnCours.has(jobId)) return { ok: false, motif: 'deja_en_cours' };
  if (rendusEnCours >= MAX_RENDUS_SERVEUR_SIMULTANES) return { ok: false, motif: 'capacite_saturee' };
  rendusEnCours += 1;
  jobsEnCours.add(jobId);
  let rendue = false;
  return {
    ok: true,
    place: {
      liberer() {
        if (rendue) return;
        rendue = true;
        rendusEnCours -= 1;
        jobsEnCours.delete(jobId);
      },
    },
  };
}

/** Ce job est-il en train d'être rendu sur ce serveur ? */
export function renduServeurEnCours(jobId: string): boolean {
  return jobsEnCours.has(jobId);
}

/** Combien de places sont prises. Pour le diagnostic et les tests. */
export function rendusServeurEnCoursMaintenant(): number {
  return rendusEnCours;
}

/** Le travail de fond d'un job, s'il en a un. Pour les tests. */
export function travailRenduServeur(jobId: string): Promise<IssueRenduServeur> | undefined {
  return travaux.get(jobId);
}

/** Remet tout à zéro — POUR LES TESTS, et pour eux seuls. */
export function reinitialiserMoteurExportServeurPourTests(): void {
  rendusEnCours = 0;
  jobsEnCours.clear();
  travaux.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// La spec reçue : liste blanche
// ─────────────────────────────────────────────────────────────────────────

type Genre = 'texte' | 'nombre' | 'booleen' | 'objet' | 'liste' | 'texte_ou_null' | 'objet_ou_null' | 'liste_ou_null';

/**
 * Les clés de `SpecRendu` acceptées, avec leur type de base.
 *
 * ABSENTES, donc refusées : `surimpressions` et `ctaCopies` — leurs médias
 * ne sont pas couverts par `localiserEntreesRendu`, et le moteur de rendu
 * irait les lire lui-même (SSRF). Toute clé inconnue est refusée aussi.
 */
const CLES_SPEC: Record<Exclude<keyof SpecRendu, 'surimpressions' | 'ctaCopies'>, Genre> = {
  title: 'texte', subtitle: 'texte', cards: 'liste', ctaText: 'texte', ctaSubText: 'texte',
  posterUrl: 'texte_ou_null', posterOnAllSequences: 'booleen', cardBoxes: 'objet_ou_null',
  cardBackground: 'texte_ou_null', cardValueColor: 'texte_ou_null', sequenceBackgrounds: 'objet',
  videoUrl: 'texte_ou_null', rushs: 'liste_ou_null', montage: 'liste_ou_null', musicUrl: 'texte_ou_null',
  gradientStart: 'texte', gradientEnd: 'texte', gradientOpacity: 'nombre', titleColor: 'texte',
  titleFont: 'texte', titleScale: 'nombre', titleBold: 'booleen', titleItalic: 'booleen',
  titleLetterSpacing: 'nombre', titleLineHeight: 'nombre', subtitleFont: 'texte', subtitleScale: 'nombre',
  ctaFont: 'texte', ctaScale: 'nombre', ctaBold: 'booleen', ctaItalic: 'booleen',
  ctaLetterSpacing: 'nombre', ctaLineHeight: 'nombre',
  titleCase: 'texte', titleAlign: 'texte', titleUnderline: 'booleen', titleStrike: 'booleen',
  subtitleCase: 'texte', subtitleAlign: 'texte', subtitleUnderline: 'booleen', subtitleStrike: 'booleen',
  ctaCase: 'texte', ctaAlign: 'texte', ctaUnderline: 'booleen', ctaStrike: 'booleen',
  cardStyle: 'texte', cardsTypography: 'objet', titlePos: 'objet', ctaPos: 'objet',
  titleWidth: 'nombre', ctaWidth: 'nombre', watermark: 'texte',
  introDuration: 'nombre', cardsDuration: 'nombre', videoDuration: 'nombre', ctaDuration: 'nombre',
  sequenceOrder: 'liste', format: 'texte', elements: 'liste', transition: 'texte', textAnimation: 'texte',
  sequenceVoiceUrls: 'objet', voiceUrl: 'texte_ou_null', musicVolume: 'nombre', voiceVolume: 'nombre',
  rushVolume: 'nombre', rushMuted: 'booleen', audioKeyframes: 'liste',
  subtitleColor: 'texte_ou_null', ctaColor: 'texte', ctaSubColor: 'texte', ctaBackground: 'texte_ou_null',
};

const FORMATS_VISUELS = ['9:16', '1:1', '16:9'] as const;

const estObjet = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

function genreValide(v: unknown, g: Genre): boolean {
  switch (g) {
    case 'texte': return typeof v === 'string';
    case 'nombre': return typeof v === 'number' && Number.isFinite(v);
    case 'booleen': return typeof v === 'boolean';
    case 'objet': return estObjet(v);
    case 'liste': return Array.isArray(v);
    case 'texte_ou_null': return v === null || typeof v === 'string';
    case 'objet_ou_null': return v === null || estObjet(v);
    case 'liste_ou_null': return v === null || Array.isArray(v);
  }
}

/**
 * La spec reçue est-elle acceptable ? Liste blanche des clés, types de base,
 * titre et format visuel obligatoires. Ne transforme RIEN : la spec retenue
 * est l'objet reçu, tel quel.
 */
export function validerSpecServeur(v: unknown):
  | { ok: true; spec: SpecRendu }
  | { ok: false; motif: string } {
  if (!estObjet(v)) return { ok: false, motif: 'spec_absente' };
  const o = v as Record<string, unknown>;
  for (const [cle, valeur] of Object.entries(o)) {
    const genre = (CLES_SPEC as Record<string, Genre | undefined>)[cle];
    if (!genre) return { ok: false, motif: `cle_refusee:${cle.slice(0, 40)}` };
    if (valeur === undefined) continue;
    if (!genreValide(valeur, genre)) return { ok: false, motif: `type_invalide:${cle}` };
  }
  if (typeof o.title !== 'string') return { ok: false, motif: 'titre_absent' };
  if (!(FORMATS_VISUELS as readonly unknown[]).includes(o.format)) return { ok: false, motif: 'format_invalide' };
  return { ok: true, spec: o as unknown as SpecRendu };
}

// ─────────────────────────────────────────────────────────────────────────
// Le travail de fond
// ─────────────────────────────────────────────────────────────────────────

export type IssueRenduServeur =
  | { issue: 'confirme' }
  | { issue: 'echec'; motif: string }
  | { issue: 'laisse_ouvert'; motif: string }
  | { issue: 'abandonne'; motif: 'etat_change' };

/** Signal d'annulation au format Remotion (`CancelSignal`), sans l'importer. */
function signalAnnulation() {
  let annule = false;
  const rappels: Array<() => void> = [];
  return {
    cancelSignal: (cb: () => void) => { if (annule) cb(); else rappels.push(cb); },
    annuler: () => {
      if (annule) return;
      annule = true;
      for (const cb of rappels.splice(0)) { try { cb(); } catch { /* le rendu gère */ } }
    },
    estAnnule: () => annule,
  };
}

/**
 * Rend, téléverse à la clé de la ligne, puis confirme par la porte commune.
 *
 * Ne jette JAMAIS : chaque issue est rendue et journalisée sans donnée
 * personnelle. La place n'est libérée qu'en `finally`, donc APRÈS la fin
 * réelle du rendu — y compris après une annulation par délai.
 */
export async function executerRenduServeur(input: {
  userId: string;
  rendu: LigneRendu;
  spec: SpecRendu;
  place: PlaceRenduServeur;
  delaiMs?: number;
}): Promise<IssueRenduServeur> {
  const travail = executer(input);
  travaux.set(input.rendu.id, travail);
  void travail.finally(() => { if (travaux.get(input.rendu.id) === travail) travaux.delete(input.rendu.id); });
  return travail;
}

async function executer(input: {
  userId: string;
  rendu: LigneRendu;
  spec: SpecRendu;
  place: PlaceRenduServeur;
  delaiMs?: number;
}): Promise<IssueRenduServeur> {
  const { userId, rendu, spec, place } = input;
  const jobId = rendu.id;
  const signal = signalAnnulation();
  let delaiDepasse = false;
  const minuterie = setTimeout(() => { delaiDepasse = true; signal.annuler(); }, input.delaiMs ?? DELAI_RENDU_SERVEUR_MS);
  // Le fichier que Remotion écrit (`worker.ts`) : connu d'avance, pour être
  // effacé même si le rendu jette à mi-chemin.
  let fichier: string | null = path.join(os.tmpdir(), `studiio-render-${jobId}.mp4`);
  let televerse = false;
  let phase: 'rendu' | 'televersement' | 'confirmation' = 'rendu';

  const echouer = async (motif: string): Promise<IssueRenduServeur> => {
    try {
      const { cloreRendu } = await import('@/lib/rendus/service');
      await cloreRendu(userId, jobId, 'failed', motif);
    } catch { /* reste reserved, relisible */ }
    console.warn(`[RenduServeur/A2.3] ${jobId} — failed : ${motif}`);
    return { issue: 'echec', motif };
  };

  try {
    // ── SSRF : le moteur ne lit QUE notre stockage ────────────────────
    const { localiserEntreesRendu } = await import('@/lib/securite/medias-externes');
    let design: SpecRendu;
    try {
      design = await localiserEntreesRendu(spec) as SpecRendu;
    } catch {
      return await echouer('localisation_refusee');
    }
    if (signal.estAnnule()) return await echouer('delai_depasse');

    const { renderCreerSimple } = await import('@/lib/render/creerSimple');
    try {
      const { outputPath } = await renderCreerSimple({
        jobId, userId, design, cancelSignal: signal.cancelSignal,
      });
      fichier = outputPath;
    } catch {
      return await echouer(delaiDepasse ? 'delai_depasse' : 'rendu_echoue');
    }
    if (delaiDepasse) return await echouer('delai_depasse');

    // ── L'état a-t-il changé pendant le rendu (annulé, clos) ? ────────
    const { lireRendu } = await import('@/lib/rendus/service');
    const { rendu: relu } = await lireRendu(userId, jobId);
    if (!relu || relu.etat !== 'reserved') {
      console.warn(`[RenduServeur/A2.3] ${jobId} — état changé pendant le rendu, rien n'est écrit`);
      return { issue: 'abandonne', motif: 'etat_change' };
    }

    // ── Téléversement à la clé attribuée par le serveur ───────────────
    phase = 'televersement';
    const { uploadToStorage } = await import('@/lib/storage/upload');
    try {
      await uploadToStorage({
        filePath: fichier, bucket: relu.bucket, storagePath: relu.cle_objet, contentType: 'video/mp4',
      });
      televerse = true;
    } catch {
      return await echouer('televersement_echoue');
    }

    // ── La porte commune : preuve, politique, débit unique ────────────
    phase = 'confirmation';
    const { confirmerAvecPreuve } = await import('@/lib/rendus/confirmation');
    const issue = await confirmerAvecPreuve(userId, relu as LigneRendu);
    if (issue.status === 200) {
      console.log(`[RenduServeur/A2.3] ${jobId} — confirmé`);
      return { issue: 'confirme' };
    }
    const motif = typeof issue.body.motif === 'string' ? issue.body.motif : `http_${issue.status}`;
    // Stockage injoignable ou socle absent : la panne est de notre côté, la
    // tentative reste ouverte (re-confirmable par `/confirm`).
    if (issue.status === 503) {
      console.warn(`[RenduServeur/A2.3] ${jobId} — laissé reserved : ${motif}`);
      return { issue: 'laisse_ouvert', motif };
    }
    // Objet invalide : déjà clos par `confirmerAvecPreuve`. Solde
    // insuffisant ou refus SQL : clos ici (`clore_rendu` n'agit que sur
    // `reserved`, un second appel est sans effet).
    if (issue.status === 422 && issue.body.error === 'Aucun montage valide a cette cle') {
      console.warn(`[RenduServeur/A2.3] ${jobId} — failed : ${motif}`);
      return { issue: 'echec', motif };
    }
    return await echouer(motif);
  } catch (e: unknown) {
    const nom = e instanceof Error ? e.name : 'inconnu';
    if (phase === 'confirmation') {
      // La confirmation a pu aboutir en base avant la coupure : AUCUN
      // réessai automatique, aucune clôture. La ligne reste relisible
      // (GET) et `/confirm` répond `dejaConfirme` si elle a abouti.
      console.warn(`[RenduServeur/A2.3] ${jobId} — confirmation interrompue (${nom}), aucun réessai`);
      return { issue: 'laisse_ouvert', motif: 'confirmation_interrompue' };
    }
    return await echouer(`${phase}_interrompu`);
  } finally {
    clearTimeout(minuterie);
    // `uploadToStorage` efface le fichier une fois en ligne ; sinon, on le fait.
    if (fichier && !televerse) await fsp.unlink(fichier).catch(() => undefined);
    place.liberer();
  }
}
