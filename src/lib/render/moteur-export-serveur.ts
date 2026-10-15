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

/**
 * Budget d'un rendu serveur. À l'échéance, la tentative est close en
 * `failed` IMMÉDIATEMENT et le rendu reçoit l'ordre d'annulation ; sa place
 * reste prise jusqu'à ce que sa promesse rende la main.
 */
export const DELAI_RENDU_SERVEUR_MS = 600_000;

/**
 * Marge ajoutée au Retry-After : `renderMedia` rejette par course dès
 * l'annulation, mais l'arrêt de Chromium / ffmpeg continue quelques secondes.
 */
export const MARGE_NETTOYAGE_S = 30;

/** Plafond du corps de POST /serveur, en octets. */
export const TAILLE_MAX_CORPS = 256 * 1024;

/** Une seule composition Remotion à la fois sur ce serveur. */
export const MAX_RENDUS_SERVEUR_SIMULTANES = 1;

/** Opérations dont la tentative peut être rendue par le serveur. */
export const OPERATIONS_RENDU_SERVEUR = ['apercu', 'bureau', 'calendrier'] as const;

let rendusEnCours = 0;
const jobsEnCours = new Set<string>();
/** Début de chaque job en cours (horloge), pour le Retry-After. */
const debuts = new Map<string, number>();
/**
 * Derniers travaux de fond, CONSERVÉS une fois finis (bornés) : un appelant
 * qui arrive après la fin lit encore l'issue.
 */
const travaux = new Map<string, Promise<IssueRenduServeur>>();
const TRAVAUX_CONSERVES = 50;

export interface PlaceRenduServeur {
  /** IDEMPOTENTE : un second appel ne rend ni la place ni le job deux fois. */
  liberer(): void;
}

/**
 * Prend, d'un seul tenant et sans attente, le job ET la place.
 *
 * Synchrone : deux requêtes simultanées ne peuvent pas passer toutes deux le
 * contrôle. Le même job déjà en cours → `deja_en_cours` (409) ; un autre job
 * occupe la place, ou `autresRendusRemotion > 0` (`rendusRemotionActifs()`)
 * → `capacite_saturee` (429).
 */
export function prendreExecution(jobId: string, autresRendusRemotion = 0):
  | { ok: true; place: PlaceRenduServeur }
  | { ok: false; motif: 'deja_en_cours' | 'capacite_saturee' } {
  if (jobsEnCours.has(jobId)) return { ok: false, motif: 'deja_en_cours' };
  if (rendusEnCours >= MAX_RENDUS_SERVEUR_SIMULTANES) return { ok: false, motif: 'capacite_saturee' };
  // P-a : un `renderVideo` étranger (Autopilote, `/api/render`) tient déjà
  // un Chromium dans ce processus — on ne lance pas le second.
  if (autresRendusRemotion > 0) return { ok: false, motif: 'capacite_saturee' };
  rendusEnCours += 1;
  jobsEnCours.add(jobId);
  debuts.set(jobId, Date.now());
  let rendue = false;
  return {
    ok: true,
    place: {
      liberer() {
        if (rendue) return;
        rendue = true;
        rendusEnCours -= 1;
        jobsEnCours.delete(jobId);
        debuts.delete(jobId);
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

/**
 * Retry-After d'un refus 429, en secondes : le reste du budget du job le plus
 * long en cours, plus la marge de nettoyage. Sans job A2.3 connu (place prise
 * par un autre rendu Remotion), le budget entier.
 */
export function retryAfterSecondes(maintenant: number = Date.now()): number {
  let reste = -1;
  for (const debut of debuts.values()) reste = Math.max(reste, debut + DELAI_RENDU_SERVEUR_MS - maintenant);
  if (reste < 0 && debuts.size === 0) return Math.ceil(DELAI_RENDU_SERVEUR_MS / 1000) + MARGE_NETTOYAGE_S;
  return Math.max(0, Math.ceil(reste / 1000)) + MARGE_NETTOYAGE_S;
}

/** Le travail de fond d'un job (en cours ou récemment fini). */
export function travailRenduServeur(jobId: string): Promise<IssueRenduServeur> | undefined {
  return travaux.get(jobId);
}

/** Remet tout à zéro — POUR LES TESTS, et pour eux seuls. */
export function reinitialiserMoteurExportServeurPourTests(): void {
  rendusEnCours = 0;
  jobsEnCours.clear();
  debuts.clear();
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

/** Bornes de la spec (C1). */
export const BORNES_SPEC = {
  dureeMaxS: 120,
  texteMax: 2000,
  profondeurMax: 8,
  listes: { cards: 20, rushs: 10, rushUrls: 10, elements: 50, montage: 100 } as Record<string, number>,
  listeParDefaut: 200,
} as const;
const DUREES = new Set(['introDuration', 'cardsDuration', 'videoDuration', 'ctaDuration']);

/**
 * Champ média : absent / null, ou une URL http(s) CANONIQUE — `new URL(v)`
 * réussit et `href === v`, sans blanc, sans `\`, sans `//` initial. Ce que
 * `localiserEntreesRendu` copierait autrement depuis n'importe où (SSRF).
 */
export function urlMediaValide(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  if (/\s/.test(v) || v.includes('\\') || v.startsWith('//')) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.href === v;
}

const COULEUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
/** Couleur : absente / null, ou hex / rgb(a) stricts. Rien qui finisse dans un `url(…)` CSS. */
export function couleurValide(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === 'string' && COULEUR.test(v);
}

/** Clés dont la valeur est un média (à toute profondeur). */
const estCleMedia = (cle: string) => /url$/i.test(cle);
/** Clés dont TOUTES les valeurs sont des médias (`*Urls`, `sequenceBackgrounds`). */
const estCarteMedias = (cle: string) => /urls$/i.test(cle) || cle === 'sequenceBackgrounds';
/** Clés de couleur (à toute profondeur). */
const estCleCouleur = (cle: string) => /(color|background)$/i.test(cle) || cle === 'gradientStart' || cle === 'gradientEnd';

/**
 * Un média est une CHAÎNE valide ou null — jamais un conteneur. Un tableau
 * d'un élément passerait sinon élément par élément, échapperait à
 * `localiserEntreesRendu` (qui ne localise que les chaînes) et Remotion le
 * stringifierait (`<Img src={["http://…"]}>`) : Chromium appellerait l'hôte.
 */
const mediaUnitaireValide = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.length <= BORNES_SPEC.texteMax && urlMediaValide(v));

/** Carte de médias : objet PLAT de chaînes | null, ou (`*Urls`) tableau de chaînes. */
function carteMediasValide(v: unknown, cle: string): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) {
    if (cle === 'sequenceBackgrounds') return false;
    if (v.length > (BORNES_SPEC.listes[cle] ?? BORNES_SPEC.listeParDefaut)) return false;
    return v.every((e) => typeof e === 'string' && mediaUnitaireValide(e));
  }
  if (!estObjet(v)) return false;
  const valeurs = Object.values(v as Record<string, unknown>);
  if (valeurs.length > BORNES_SPEC.listeParDefaut) return false;
  return valeurs.every(mediaUnitaireValide);
}

/**
 * Parcours profond : médias, couleurs, bornes. `cle` est la clé qui porte la
 * valeur (pour un élément de liste, celle de la liste).
 */
function parcourir(v: unknown, cle: string, chemin: string, profondeur: number): string | null {
  if (profondeur > BORNES_SPEC.profondeurMax) return `borne:profondeur:${chemin}`;
  if (estCarteMedias(cle)) return carteMediasValide(v, cle) ? null : `media_invalide:${chemin}`;
  if (estCleMedia(cle)) return mediaUnitaireValide(v) ? null : `media_invalide:${chemin}`;
  if (estCleCouleur(cle) && !estObjet(v) && !Array.isArray(v)) {
    return couleurValide(v) ? null : `couleur_invalide:${chemin}`;
  }
  if (typeof v === 'string') return v.length > BORNES_SPEC.texteMax ? `borne:texte:${chemin}` : null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return `borne:nombre:${chemin}`;
    if (DUREES.has(cle) && (v < 0 || v > BORNES_SPEC.dureeMaxS)) return `borne:duree:${chemin}`;
    return null;
  }
  if (Array.isArray(v)) {
    const max = BORNES_SPEC.listes[cle] ?? BORNES_SPEC.listeParDefaut;
    if (v.length > max) return `borne:liste:${chemin}`;
    for (let i = 0; i < v.length; i++) {
      const m = parcourir(v[i], cle, `${chemin}[${i}]`, profondeur + 1);
      if (m) return m;
    }
    return null;
  }
  if (estObjet(v)) {
    for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
      const m = parcourir(w, k, `${chemin}.${k.slice(0, 40)}`, profondeur + 1);
      if (m) return m;
    }
  }
  return null;
}

/**
 * La spec reçue est-elle acceptable ? Liste blanche des clés (propres, jamais
 * héritées), types de base, titre et format visuel obligatoires, puis
 * parcours profond : médias (B1), couleurs (B2), bornes (C1). Ne transforme
 * RIEN : la spec retenue est l'objet reçu, tel quel.
 */
export function validerSpecServeur(v: unknown):
  | { ok: true; spec: SpecRendu }
  | { ok: false; motif: string } {
  if (!estObjet(v)) return { ok: false, motif: 'spec_absente' };
  const o = v as Record<string, unknown>;
  for (const [cle, valeur] of Object.entries(o)) {
    // Propre, jamais héritée (`constructor`, `toString`…) — `Object.hasOwn`
    // en sémantique ; la lib TS du projet (< es2022) ne le déclare pas.
    if (!Object.prototype.hasOwnProperty.call(CLES_SPEC, cle)) return { ok: false, motif: `cle_refusee:${cle.slice(0, 40)}` };
    if (valeur === undefined) continue;
    // Un champ média mal formé (conteneur compris) est un refus MÉDIA, pas
    // un simple refus de type.
    if (estCleMedia(cle) || estCarteMedias(cle)) {
      const motif = parcourir(valeur, cle, cle, 0);
      if (motif) return { ok: false, motif };
    }
    const genre = (CLES_SPEC as Record<string, Genre>)[cle];
    if (!genreValide(valeur, genre)) return { ok: false, motif: `type_invalide:${cle}` };
  }
  if (typeof o.title !== 'string') return { ok: false, motif: 'titre_absent' };
  if (!(FORMATS_VISUELS as readonly unknown[]).includes(o.format)) return { ok: false, motif: 'format_invalide' };
  for (const [cle, valeur] of Object.entries(o)) {
    const motif = parcourir(valeur, cle, cle, 0);
    if (motif) return { ok: false, motif };
  }
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
 * personnelle.
 *
 * ÉCHÉANCE (P-b) : à `delaiMs`, la tentative est close en `failed`
 * (`delai_depasse`) TOUT DE SUITE, même si la localisation, le bundle ou
 * `selectComposition` n'ont pas rendu la main, et le rendu reçoit l'ordre
 * d'annulation. `renderMedia` rejette alors par course : l'arrêt réel de
 * Chromium / ffmpeg continue quelques secondes. La place n'est libérée qu'en
 * `finally`, quand la promesse du travail a rendu la main — conservateur :
 * mieux vaut un 429 qu'un second Chromium. Un travail qui se termine après
 * l'échéance ne téléverse ni ne confirme rien.
 *
 * FENÊTRE CONNUE (P2), sans correctif possible sans état durable : entre la
 * relecture `reserved` et la fin du téléversement, une confirmation
 * concurrente (navigateur, `/confirm`) ou une annulation peut survenir.
 * L'objet est alors écrasé après confirmation, ou laissé orphelin après
 * annulation — jamais de débit indu : la confirmation reste la RPC
 * idempotente (`where etat = 'reserved'` + index unique de transaction).
 */
export async function executerRenduServeur(input: {
  userId: string;
  rendu: LigneRendu;
  spec: SpecRendu;
  place: PlaceRenduServeur;
  delaiMs?: number;
}): Promise<IssueRenduServeur> {
  const travail = executer(input);
  travaux.delete(input.rendu.id);
  travaux.set(input.rendu.id, travail);
  while (travaux.size > TRAVAUX_CONSERVES) travaux.delete(travaux.keys().next().value as string);
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
  // Le fichier que Remotion écrit (`worker.ts`) : connu d'avance, pour être
  // effacé même si le rendu jette à mi-chemin.
  let fichier: string | null = path.join(os.tmpdir(), `studiio-render-${jobId}.mp4`);
  let televerse = false;
  let phase: 'rendu' | 'televersement' | 'confirmation' = 'rendu';

  // Une seule clôture par travail, quelle qu'en soit la cause.
  let cloture: Promise<IssueRenduServeur> | null = null;
  const echouer = (motif: string): Promise<IssueRenduServeur> => {
    if (!cloture) {
      cloture = (async () => {
        try {
          const { cloreRendu } = await import('@/lib/rendus/service');
          await cloreRendu(userId, jobId, 'failed', motif);
        } catch { /* reste reserved, relisible */ }
        console.warn(`[RenduServeur/A2.3] ${jobId} — failed : ${motif}`);
        return { issue: 'echec', motif } as IssueRenduServeur;
      })();
    }
    return cloture;
  };

  let delaiDepasse = false;
  const minuterie = setTimeout(() => {
    delaiDepasse = true;
    signal.annuler();
    void echouer('delai_depasse');
  }, input.delaiMs ?? DELAI_RENDU_SERVEUR_MS);
  const surDelai = () => echouer('delai_depasse');

  try {
    // ── P1 : la ligne a-t-elle changé entre la réponse 202 et ici ? ───
    const { lireRendu } = await import('@/lib/rendus/service');
    const { rendu: auDepart } = await lireRendu(userId, jobId);
    if (delaiDepasse) return await surDelai();
    if (!auDepart || auDepart.etat !== 'reserved') {
      console.warn(`[RenduServeur/A2.3] ${jobId} — plus reserved au départ, aucun rendu`);
      return { issue: 'abandonne', motif: 'etat_change' };
    }

    // ── SSRF : le moteur ne lit QUE notre stockage ────────────────────
    const { localiserEntreesRendu } = await import('@/lib/securite/medias-externes');
    let design: SpecRendu;
    try {
      design = await localiserEntreesRendu(spec) as SpecRendu;
    } catch {
      return await (delaiDepasse ? surDelai() : echouer('localisation_refusee'));
    }
    if (delaiDepasse) return await surDelai();

    const { renderCreerSimple } = await import('@/lib/render/creerSimple');
    try {
      const { outputPath } = await renderCreerSimple({
        jobId, userId, design, cancelSignal: signal.cancelSignal,
      });
      fichier = outputPath;
    } catch {
      return await (delaiDepasse ? surDelai() : echouer('rendu_echoue'));
    }
    if (delaiDepasse) return await surDelai();

    // ── L'état a-t-il changé pendant le rendu (annulé, clos) ? ────────
    const { rendu: relu } = await lireRendu(userId, jobId);
    if (delaiDepasse) return await surDelai();
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
      return await (delaiDepasse ? surDelai() : echouer('televersement_echoue'));
    }
    if (delaiDepasse) return await surDelai();

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
    return await (delaiDepasse ? surDelai() : echouer(motif));
  } catch (e: unknown) {
    const nom = e instanceof Error ? e.name : 'inconnu';
    if (phase === 'confirmation') {
      // La confirmation a pu aboutir en base avant la coupure : AUCUN
      // réessai automatique, aucune clôture. La ligne reste relisible
      // (GET) et `/confirm` répond `dejaConfirme` si elle a abouti.
      console.warn(`[RenduServeur/A2.3] ${jobId} — confirmation interrompue (${nom}), aucun réessai`);
      return { issue: 'laisse_ouvert', motif: 'confirmation_interrompue' };
    }
    return await (delaiDepasse ? surDelai() : echouer(`${phase}_interrompu`));
  } finally {
    clearTimeout(minuterie);
    // Une clôture partie à l'échéance est attendue avant de rendre la place.
    if (cloture) await (cloture as Promise<IssueRenduServeur>).catch(() => undefined);
    // `uploadToStorage` efface le fichier une fois en ligne ; sinon, on le fait.
    if (fichier && !televerse) await fsp.unlink(fichier).catch(() => undefined);
    place.liberer();
  }
}
