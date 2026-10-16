/**
 * M2-b — ANALYSE VISUELLE ET TRANSCRIPTION DES RUSHES PERSONNELS (serveur).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUCUNE DEUXIÈME ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────
 * Tout ce qui parle à un fournisseur ou à ffmpeg est RÉUTILISÉ de l'Autopilote :
 *   - images : `extraireImageJpeg` + `positionsImages` (extraction.ts, la
 *     commande des vignettes M3, en mémoire ici : rien n'est écrit) ;
 *   - durée / pistes : `sonder` (extraction.ts) ;
 *   - vision : `appelerVisionAnthropic` (visuel-anthropic.ts) ;
 *   - son : `avecAudioFlac` (transcription-audio.ts, borné par `-t`) +
 *     `envoyerTranscriptionGroq` (transcription-groq.ts) +
 *     `lireReponseTranscription` (transcription-contrat.ts) ;
 *   - charge : `prendrePlaceExtraction` / `prendrePlaceTranscription`
 *     (capacite.ts : une analyse lourde à la fois) ;
 *   - qualité : M1 (`analyserRushServeurCache` + `evaluerQualiteRushs`) —
 *     image noire / floue / vide → pas d'appel vision ; énergie audio muette →
 *     pas d'appel transcription ;
 *   - fiche et cache : M2-a (`ficheContenuServeur`, même clé stable, `.v2.json`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUATRE VERROUS AVANT LE MOINDRE OCTET ENVOYÉ
 * ─────────────────────────────────────────────────────────────────────────
 *   1. interrupteurs `STUDIIO_VISION_RUSH_ENABLED` / `STUDIIO_TRANSCRIPTION_RUSH_ENABLED`
 *      (exactement "true", indépendants, OFF par défaut) + modèle obligatoire
 *      (`STUDIIO_VISION_RUSH_MODEL` / `STUDIIO_TRANSCRIPTION_RUSH_MODEL`, sans
 *      défaut) présent dans la table de tarifs documentée ;
 *   2. compte administrateur (`isAdmin`) ;
 *   3. consentement explicite VALIDE du compte (`consentement-ia.ts`) ;
 *   4. rush PERSONNEL du compte de la session (`classerUrlLecture`, préfixe
 *      `<userId>/`, ni stock, ni namespace privé, ni URL externe).
 *
 * NON BLOQUANT : appelé en tâche de fond par la route, jamais par la création
 * ou l'export ; chaque étape a son délai ; toute erreur laisse la fiche M2-a
 * intacte et les dimensions « inconnu ». AUCUN débit de crédits. AUCUN
 * journal portant une donnée personnelle (ni URL, ni clé, ni texte).
 */
import { isAdmin } from '@/lib/admin';
import { classerUrlLecture } from '@/lib/creer/analyse-rush-serveur';
import {
  ABSENT, BUCKET_FICHES, cleConsentementIA, cleFicheContenu, ficheContenuServeur, stockageFichesMinio,
  type StockageFiches,
} from '@/lib/creer/fiche-contenu-serveur';
import { paroleDepuisEnergie, type FicheContenuRush } from '@/lib/creer/fiche-contenu';
import {
  fusionnerFicheV2, ficheContenuV2Valide, lireReponseObservations, observationsParole, schemaObservations,
  langueParole, visionDeFiche,
  type EtapeAnalyse, type FicheContenuRushV2, type ParoleLue, type UsageTranscription, type UsageVision, type VisionLue,
} from '@/lib/creer/fiche-contenu-v2';
import { consentementValide, registreAccorde, registreRevoque, type LangueConsentement, type RegistreConsentement } from '@/lib/creer/consentement-ia';
import { INVITE_OBSERVATIONS_RUSH } from '@/lib/autopilot/analyse/visuel-invite';
import type { Transport } from '@/lib/autopilot/analyse/visuel-anthropic';
import type { TransportTranscription } from '@/lib/autopilot/analyse/transcription-groq';
import type { AnalyseRushQualite } from '@/lib/creer/nettete-hd';

// ─────────────────────────────────────────────────────────────────────────
// Tarifs — DOCUMENTÉS (source + date). Un modèle absent = AUCUN appel.
// ─────────────────────────────────────────────────────────────────────────

export const SOURCE_TARIFS = 'Anthropic : platform.claude.com/docs/en/about-claude/models/overview ; '
  + 'Groq : console.groq.com/docs/speech-to-text — relevés le 2026-10-16';

/**
 * Vision, en dollars par MILLION de jetons. `parametres` : ce que le modèle
 * accepte pour ne pas facturer de réflexion inutile (sortie bornée à
 * `JETONS_SORTIE_MAX_RUSH`) — vérifié dans la documentation des modèles :
 * Haiku 5.5 accepte `disabled` (effort ≤ high, défaut medium) ; Sonnet 5.5
 * refuse `disabled` (400) et coupe la réflexion par `between_tools` ;
 * Haiku 4.5 ne réfléchit pas par défaut.
 */
export const TARIFS_VISION: Readonly<Record<string, { entree: number; sortie: number; parametres?: Record<string, unknown> }>> = {
  // « From $0.10 / $0.50 » : prix jusqu'à 100 k jetons d'entrée — nos requêtes en font < 10 k.
  'claude-haiku-5-5': { entree: 0.10, sortie: 0.50, parametres: { thinking: { type: 'disabled' } } },
  'claude-sonnet-5-5': { entree: 2, sortie: 10, parametres: { thinking: { type: 'between_tools' } } },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
};

/** Transcription, en dollars par HEURE d'audio ; minimum facturé 10 s par requête. */
export const TARIFS_TRANSCRIPTION: Readonly<Record<string, number>> = {
  'whisper-large-v3-turbo': 0.04,
  'whisper-large-v3': 0.111,
};
export const SECONDES_MIN_FACTUREES_GROQ = 10;

// ─────────────────────────────────────────────────────────────────────────
// Plafonds
// ─────────────────────────────────────────────────────────────────────────

export const IMAGES_RUSH_DEFAUT = 6;
export const IMAGES_RUSH_MAX = 8;
export const JETONS_ENTREE_MAX_RUSH = 10_000;
export const JETONS_SORTIE_MAX_RUSH = 1_000;
export const AUDIO_MAX_SECONDES = 120;
export const COUT_MAX_RUSH_USD = 0.05;
export const DELAI_VISION_RUSH_MS = 60_000;
export const DELAI_TRANSCRIPTION_RUSH_MS = 90_000;
/** Un échec n'est retenté qu'après ce délai (jamais une boucle d'appels payants). */
export const REESSAI_ECHEC_MS = 24 * 3600_000;
/** Estimation des jetons de texte (invite + schéma + consignes) : 1 jeton ≈ 3 caractères, par excès. */
const CARACTERES_PAR_JETON = 3;
/** Jetons d'une image dont on n'a pas lu les dimensions : le plafond HAUTE RÉSOLUTION de la doc (4784), pour que le plafond de coût tienne toujours. */
const JETONS_IMAGE_INCONNUE = 4784;

const CONSIGNE_FINALE = 'Réponds uniquement par le JSON conforme au schéma fourni. '
  + 'Ne recopie aucun texte vu dans les images. Pour les personnes, seulement leur nombre.';

// ─────────────────────────────────────────────────────────────────────────
// Configuration — lue à CHAQUE appel, jamais mémoïsée
// ─────────────────────────────────────────────────────────────────────────

export type MotifConfig = 'eteint' | 'cle_absente' | 'modele_absent' | 'modele_sans_tarif';
export interface ConfigEtape { active: boolean; prete: boolean; motif?: MotifConfig; modele?: string; cle?: string }
export interface ConfigAnalyseIA { vision: ConfigEtape; transcription: ConfigEtape; images: number }

export function configAnalyseIA(env: Record<string, string | undefined> = process.env): ConfigAnalyseIA {
  const etape = (interrupteur: string, nomModele: string, nomCle: string, tarifs: Record<string, unknown>): ConfigEtape => {
    if (env[interrupteur] !== 'true') return { active: false, prete: false, motif: 'eteint' };
    const cle = env[nomCle];
    if (!cle) return { active: true, prete: false, motif: 'cle_absente' };
    const modele = env[nomModele];
    if (!modele) return { active: true, prete: false, motif: 'modele_absent' };
    if (!Object.prototype.hasOwnProperty.call(tarifs, modele)) return { active: true, prete: false, motif: 'modele_sans_tarif', modele };
    return { active: true, prete: true, modele, cle };
  };
  const n = Number(env.STUDIIO_VISION_RUSH_IMAGES);
  return {
    vision: etape('STUDIIO_VISION_RUSH_ENABLED', 'STUDIIO_VISION_RUSH_MODEL', 'ANTHROPIC_API_KEY', TARIFS_VISION),
    transcription: etape('STUDIIO_TRANSCRIPTION_RUSH_ENABLED', 'STUDIIO_TRANSCRIPTION_RUSH_MODEL', 'GROQ_API_KEY', TARIFS_TRANSCRIPTION),
    images: Number.isInteger(n) && n >= 1 ? Math.min(IMAGES_RUSH_MAX, n) : IMAGES_RUSH_DEFAUT,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Coûts
// ─────────────────────────────────────────────────────────────────────────

const arrondi6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function coutVisionUsd(modele: string, jetonsEntree: number, jetonsSortie: number): number | null {
  const t = TARIFS_VISION[modele];
  return t ? arrondi6((jetonsEntree * t.entree + jetonsSortie * t.sortie) / 1e6) : null;
}

export function coutTranscriptionUsd(modele: string, secondes: number): { facturees: number; cout: number | null } {
  const facturees = Math.max(SECONDES_MIN_FACTUREES_GROQ, Math.ceil(Math.max(0, secondes)));
  const t = TARIFS_TRANSCRIPTION[modele];
  return { facturees, cout: t === undefined ? null : arrondi6((facturees / 3600) * t) };
}

/** Dimensions d'un JPEG (marqueur SOF), ou `null`. */
export function dimensionsJpeg(o: Buffer): { largeur: number; hauteur: number } | null {
  if (o.length < 4 || o[0] !== 0xff || o[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < o.length) {
    if (o[i] !== 0xff) { i++; continue; }
    const m = o[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const longueur = o.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { hauteur: o.readUInt16BE(i + 5), largeur: o.readUInt16BE(i + 7) };
    }
    i += 2 + longueur;
  }
  return null;
}

/** Jetons d'une image d'après la documentation Anthropic : ⌈l/28⌉ × ⌈h/28⌉. */
export function jetonsImage(o: Buffer): number {
  const d = dimensionsJpeg(o);
  return d ? Math.ceil(d.largeur / 28) * Math.ceil(d.hauteur / 28) : JETONS_IMAGE_INCONNUE;
}

/** Estimation PAR EXCÈS des jetons d'entrée d'un appel vision (avant tout envoi). */
export function estimerJetonsEntree(images: readonly Buffer[]): number {
  const texte = INVITE_OBSERVATIONS_RUSH.length + JSON.stringify(schemaObservations()).length + CONSIGNE_FINALE.length + images.length * 30;
  return images.reduce((s, o) => s + jetonsImage(o), 0) + Math.ceil(texte / CARACTERES_PAR_JETON);
}

// ─────────────────────────────────────────────────────────────────────────
// Dépendances (toutes injectables : les tests n'ouvrent jamais une socket)
// ─────────────────────────────────────────────────────────────────────────

export interface SondeRush { dureeSecondes: number | null; video: boolean; audio: boolean }
export interface CibleRush { userId: string; bucket: string; cle: string; taille: number }

export interface DependancesAnalyseIA {
  env?: Record<string, string | undefined>;
  stockage?: StockageFiches;
  transportVision?: Transport;
  transportTranscription?: TransportTranscription;
  /** Durée et pistes du rush (défaut : URL interne signée + `sonder`). */
  sonder?: (c: CibleRush) => Promise<SondeRush | null>;
  /** Les JPEG aux instants donnés (défaut : `extraireImageJpeg`), en mémoire. */
  extraireImages?: (c: CibleRush, positions: readonly number[]) => Promise<Array<{ seconde: number; octets: Buffer }>>;
  /** Mesures M1 (défaut : `analyserRushServeurCache`). */
  mesurerQualite?: (url: string, duree: number, userId: string) => Promise<AnalyseRushQualite | null>;
  /** Le son, transcrit (défaut : `avecAudioFlac` + Groq). Rend le texte BRUT du fournisseur. */
  transcrire?: (c: CibleRush, modele: string, cle: string, dureeMax: number, transport?: TransportTranscription) => Promise<{ ok: true; reponse: string } | { ok: false; motif: string }>;
  /** Une transcription Autopilote du MÊME fichier (même bucket/clé/taille), ou `null`. */
  transcriptionExistante?: (c: CibleRush) => Promise<ParoleLue | null>;
  maintenant?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Consentement — registre privé du compte
// ─────────────────────────────────────────────────────────────────────────

const uidSur = (u: unknown): u is string => typeof u === 'string' && /^[\w-]{1,64}$/.test(u);

export async function lireConsentementIA(userId: string, stockage: StockageFiches = stockageFichesMinio()): Promise<RegistreConsentement | null> {
  if (!uidSur(userId)) return null;
  try {
    const r = await stockage.lireJson(BUCKET_FICHES, cleConsentementIA(userId));
    return r === ABSENT ? null : (r as RegistreConsentement);
  } catch {
    return null; // panne = pas de consentement lisible = AUCUN envoi
  }
}

export async function consentementIAValide(userId: string, stockage?: StockageFiches): Promise<boolean> {
  return consentementValide(await lireConsentementIA(userId, stockage));
}

export async function enregistrerConsentementIA(
  userId: string, accorde: boolean, langue: LangueConsentement, stockage: StockageFiches = stockageFichesMinio(), maintenant = new Date(),
): Promise<RegistreConsentement> {
  if (!uidSur(userId)) throw new Error('compte_invalide');
  const precedent = accorde ? null : await lireConsentementIA(userId, stockage);
  const registre = accorde ? registreAccorde(langue, maintenant) : registreRevoque(precedent, maintenant);
  await stockage.ecrireJson(BUCKET_FICHES, cleConsentementIA(userId), registre);
  return registre;
}

// ─────────────────────────────────────────────────────────────────────────
// Défauts réels (ffmpeg, MinIO, Groq, base) — chargés à la demande
// ─────────────────────────────────────────────────────────────────────────

async function urlInterne(c: CibleRush): Promise<string | null> {
  const { signeurInterne } = await import('@/lib/storage/minio-client');
  const { BORNE_MINIO, TTL_URL_SECONDES } = await import('@/lib/autopilot/analyse/extraction');
  const signeur = signeurInterne(BORNE_MINIO);
  if (!signeur) return null;
  try {
    const u = await signeur.presignedGetObject(c.bucket, c.cle, TTL_URL_SECONDES);
    return typeof u === 'string' && /^https?:\/\//.test(u) ? u : null;
  } catch { return null; }
}

const sonderDefaut: NonNullable<DependancesAnalyseIA['sonder']> = async (c) => {
  const url = await urlInterne(c);
  if (!url) return null;
  const { sonder } = await import('@/lib/autopilot/analyse/extraction');
  const s = await sonder(url);
  if (!s.ok) return null;
  return { dureeSecondes: s.dureeSecondes, video: !!s.technique.codecVideo, audio: !!s.technique.codecAudio };
};

const extraireImagesDefaut: NonNullable<DependancesAnalyseIA['extraireImages']> = async (c, positions) => {
  const url = await urlInterne(c);
  if (!url) return [];
  const { extraireImageJpeg } = await import('@/lib/autopilot/analyse/extraction');
  const out: Array<{ seconde: number; octets: Buffer }> = [];
  for (const seconde of positions) {
    const r = await extraireImageJpeg(url, seconde);
    if (!r.timeout && !r.introuvable && r.code === 0 && r.stdout.length > 0) out.push({ seconde, octets: r.stdout });
  }
  return out;
};

const mesurerQualiteDefaut: NonNullable<DependancesAnalyseIA['mesurerQualite']> = async (url, duree, userId) => {
  const { analyserRushServeurCache } = await import('@/lib/creer/analyse-rush-serveur');
  return analyserRushServeurCache(url, duree, userId) as Promise<AnalyseRushQualite | null>;
};

const transcrireDefaut: NonNullable<DependancesAnalyseIA['transcrire']> = async (c, modele, cle, dureeMax, transport) => {
  const { avecAudioFlac } = await import('@/lib/autopilot/analyse/transcription-audio');
  const { envoyerTranscriptionGroq } = await import('@/lib/autopilot/analyse/transcription-groq');
  const r = await avecAudioFlac({ bucket: c.bucket, cleObjet: c.cle, userId: c.userId, dureeMaxSecondes: dureeMax }, async (f) => {
    try {
      return { ok: true as const, reponse: (await envoyerTranscriptionGroq({ cle, modele, chemin: f.chemin, delaiMs: DELAI_TRANSCRIPTION_RUSH_MS, transport })).reponse };
    } catch (e) {
      return { ok: false as const, motif: motifErreur(e) };
    }
  });
  if (!r.ok) return { ok: false, motif: r.motif };
  return r.valeur;
};

const transcriptionExistanteDefaut: NonNullable<DependancesAnalyseIA['transcriptionExistante']> = async (c) => {
  try {
    const { supabaseAdmin } = await import('@/lib/db/supabase');
    const { data: rush } = await supabaseAdmin.from('rushes').select('id')
      .eq('user_id', c.userId).eq('bucket', c.bucket).eq('cle_objet', c.cle).eq('taille_octets', c.taille)
      .limit(1).maybeSingle();
    const id = (rush as { id?: string } | null)?.id;
    if (!id) return null;
    const { data } = await supabaseAdmin.from('rush_transcriptions').select('presente, langue, texte')
      .eq('rush_id', id).eq('user_id', c.userId).eq('etat', 'reussie')
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const t = data as { presente?: unknown; langue?: unknown; texte?: unknown } | null;
    if (!t || typeof t.presente !== 'boolean' || typeof t.texte !== 'string') return null;
    return { presente: t.presente, langue: t.langue, texte: t.texte };
  } catch {
    return null;
  }
};

/** Un motif journalisable : un littéral à nous, jamais le message d'un tiers. */
function motifErreur(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (/^fournisseur_http_\d{3}$/.test(m)) return m;
  if ((e as { name?: string })?.name === 'AbortError' || /abort/i.test(m)) return 'delai_depasse';
  return 'fournisseur_en_erreur';
}

function avecDelai<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('delai'), { name: 'AbortError' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Garde du rush
// ─────────────────────────────────────────────────────────────────────────

const NOM_STOCK = /^stock-(pexels|unsplash)-/i;

/** Le rush PERSONNEL de ce compte, ou `null` (refus : rien n'est lu). Pure. */
export function cibleRushPersonnel(url: unknown, userId: unknown): { bucket: string; cle: string } | null {
  if (!uidSur(userId) || typeof url !== 'string' || url.length > 2048) return null;
  const c = classerUrlLecture(url, userId);
  if (c.genre !== 'stockage') return null; // externe ou refus : jamais envoyé
  if (!c.cle.startsWith(`${userId}/`) || c.cle.includes('..')) return null;
  const nom = c.cle.split('/').pop() ?? '';
  if (NOM_STOCK.test(nom)) return null; // un média stock a déjà ses sources à 0 €
  if (!/\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(nom)) return null;
  return { bucket: c.bucket, cle: c.cle };
}

// ─────────────────────────────────────────────────────────────────────────
// Lancement
// ─────────────────────────────────────────────────────────────────────────

export type StatutLancement =
  | 'eteint' | 'config_invalide' | 'non_admin' | 'sans_consentement' | 'refuse'
  | 'en_cache' | 'deja_en_cours' | 'occupe' | 'lance';

export interface Lancement {
  statut: StatutLancement;
  fiche?: FicheContenuRushV2 | null;
  /** La tâche de fond (les tests l'attendent ; la route ne l'attend jamais). */
  tache?: Promise<FicheContenuRushV2 | null>;
}

const enCours = new Set<string>();

const aFaire = (cfg: ConfigEtape, etape: EtapeAnalyse | undefined, maintenant: Date) => {
  if (!cfg.prete) return false;
  if (!etape || etape.etat === 'a_faire') return true;
  if (etape.etat === 'echec') return !etape.le || maintenant.getTime() - Date.parse(etape.le) >= REESSAI_ECHEC_MS;
  return false;
};

/**
 * Vérifie TOUT avant de prendre une place, puis lance l'analyse en tâche de
 * fond. Ordre : interrupteurs → admin → rush du compte → consentement →
 * cache → doublon → capacité. Aucun refus ne lit ni n'envoie le rush.
 */
export async function lancerAnalyseIA(
  url: string, userId: string, email: string | null | undefined, d: DependancesAnalyseIA = {},
): Promise<Lancement> {
  const cfg = configAnalyseIA(d.env ?? process.env);
  if (!cfg.vision.active && !cfg.transcription.active) return { statut: 'eteint' };
  if (!cfg.vision.prete && !cfg.transcription.prete) return { statut: 'config_invalide' };
  if (!isAdmin(email)) return { statut: 'non_admin' };
  const cible = cibleRushPersonnel(url, userId);
  if (!cible) return { statut: 'refuse' };
  let stockage: StockageFiches;
  try { stockage = d.stockage ?? stockageFichesMinio(); } catch { return { statut: 'occupe' }; }
  if (!(await consentementIAValide(userId, stockage))) return { statut: 'sans_consentement' };

  let taille: number;
  try {
    const t = await stockage.taille(cible.bucket, cible.cle);
    if (t === ABSENT || !(t > 0)) return { statut: 'refuse' };
    taille = t;
  } catch { return { statut: 'occupe' }; }
  const cleV2 = cleFicheContenu(userId, cible.bucket, cible.cle, taille, 2);
  const maintenant = (d.maintenant ?? (() => new Date()))();

  const precedente = await lireV2(stockage, cleV2);
  if (precedente && !aFaire(cfg.vision, precedente.etapes.vision, maintenant) && !aFaire(cfg.transcription, precedente.etapes.transcription, maintenant)) {
    return { statut: 'en_cache', fiche: precedente };
  }
  if (enCours.has(cleV2)) return { statut: 'deja_en_cours' };

  const { prendrePlaceExtraction } = await import('@/lib/autopilot/analyse/capacite');
  const place = prendrePlaceExtraction();
  if (!place) return { statut: 'occupe' };
  enCours.add(cleV2);
  const tache = executer(url, { userId, ...cible, taille }, cleV2, precedente, cfg, stockage, d, maintenant)
    .catch(() => null)
    .finally(() => { place.liberer(); enCours.delete(cleV2); });
  return { statut: 'lance', tache };
}

async function lireV2(stockage: StockageFiches, cle: string): Promise<FicheContenuRushV2 | null> {
  try {
    const r = await stockage.lireJson(BUCKET_FICHES, cle);
    return r !== ABSENT && ficheContenuV2Valide(r) ? r : null;
  } catch { return null; }
}

/** La fiche v2 en cache (lecture seule, AUCUN appel), au nom de la session. */
export async function lireFicheV2(url: string, userId: string, stockage: StockageFiches = stockageFichesMinio()): Promise<FicheContenuRushV2 | null> {
  const cible = cibleRushPersonnel(url, userId);
  if (!cible) return null;
  try {
    const t = await stockage.taille(cible.bucket, cible.cle);
    if (t === ABSENT) return null;
    return await lireV2(stockage, cleFicheContenu(userId, cible.bucket, cible.cle, t, 2));
  } catch { return null; }
}

const QUALITE_BLOQUANTE = new Set(['trop_sombre', 'flou', 'quasi_vide']);

async function executer(
  url: string, c: CibleRush, cleV2: string, precedente: FicheContenuRushV2 | null,
  cfg: ConfigAnalyseIA, stockage: StockageFiches, d: DependancesAnalyseIA, maintenant: Date,
): Promise<FicheContenuRushV2 | null> {
  const le = maintenant.toISOString();
  // ⚠️ Le consentement est RELU juste avant chaque envoi : une révocation
  // pendant l'analyse arrête tout ce qui n'est pas encore parti.
  const consentementToujours = () => consentementIAValide(c.userId, stockage);
  // ── Socle M2-a (cache v1 ou calcul, sans IA) ─────────────────────────
  const v1: FicheContenuRush | null = (await ficheContenuServeur(url, c.userId, { stockage }).catch(() => null))?.fiche ?? null;
  if (!v1) return null;

  let etapeVision: EtapeAnalyse = precedente?.etapes.vision ?? { etat: 'a_faire', motif: cfg.vision.motif };
  let etapeTranscription: EtapeAnalyse = precedente?.etapes.transcription ?? { etat: 'a_faire', motif: cfg.transcription.motif };
  let vision: VisionLue | null = precedente ? visionDeFiche(precedente) : null;
  let parole = precedente?.etapes.transcription.etat === 'faite' ? precedente.observations.parole : null;
  let langue = precedente?.observations.langue ?? 'inconnu';
  let paroleEcoutee = precedente?.etapes.transcription.etat === 'faite';
  const usage: FicheContenuRushV2['usage'] = { ...(precedente?.usage ?? {}), tarifs: SOURCE_TARIFS };

  const faireVision = aFaire(cfg.vision, precedente?.etapes.vision, maintenant);
  const faireTranscription = aFaire(cfg.transcription, precedente?.etapes.transcription, maintenant);
  if (!cfg.vision.prete && !precedente) etapeVision = { etat: 'a_faire', motif: cfg.vision.motif };
  if (!cfg.transcription.prete && !precedente) etapeTranscription = { etat: 'a_faire', motif: cfg.transcription.motif };

  // ── Le fichier : durée, pistes ──────────────────────────────────────
  const sonde = await (d.sonder ?? sonderDefaut)(c).catch(() => null);
  if (!sonde || !(sonde.dureeSecondes && sonde.dureeSecondes > 0)) {
    if (faireVision) etapeVision = { etat: 'echec', motif: 'fichier_illisible', le };
    if (faireTranscription) etapeTranscription = { etat: 'echec', motif: 'fichier_illisible', le };
  } else {
    const duree = sonde.dureeSecondes;
    // ── M1 : qualité (image noire / floue / vide) et énergie audio ─────
    let qualite: AnalyseRushQualite | null = null;
    if (faireVision || faireTranscription) {
      qualite = await (d.mesurerQualite ?? mesurerQualiteDefaut)(url, duree, c.userId).catch(() => null);
    }

    if (faireVision) {
      const r = await etapeVisionRush(c, duree, sonde, qualite, cfg, d, le, consentementToujours);
      etapeVision = r.etape;
      if (r.vision) vision = r.vision;
      if (r.usage) usage.vision = r.usage;
    }
    if (faireTranscription) {
      const r = await etapeTranscriptionRush(c, duree, sonde, qualite, cfg, d, le, consentementToujours);
      etapeTranscription = r.etape;
      if (r.etape.etat === 'faite' || r.etape.etat === 'sans_objet') {
        paroleEcoutee = r.etape.etat === 'faite' || r.etape.motif === 'silence' || r.etape.motif === 'pas_de_son';
        parole = r.parole ?? null;
        langue = r.langue ?? 'inconnu';
      }
      if (r.usage) usage.transcription = r.usage;
    }
  }

  const fiche = fusionnerFicheV2({
    v1, vision: etapeVision.etat === 'faite' ? vision : null, parole, langue, paroleEcoutee,
    etapes: { vision: etapeVision, transcription: etapeTranscription }, usage,
  });
  if (!ficheContenuV2Valide(fiche)) return null; // jamais une fiche hors forme dans le cache
  try { await stockage.ecrireJson(BUCKET_FICHES, cleV2, fiche); } catch { /* jamais bloquant */ }
  return fiche;
}

async function etapeVisionRush(
  c: CibleRush, duree: number, sonde: SondeRush, qualite: AnalyseRushQualite | null,
  cfg: ConfigAnalyseIA, d: DependancesAnalyseIA, le: string, consentementToujours: () => Promise<boolean>,
): Promise<{ etape: EtapeAnalyse; vision?: VisionLue; usage?: UsageVision }> {
  if (!sonde.video) return { etape: { etat: 'sans_objet', motif: 'pas_de_video', le } };
  if (qualite) {
    const { evaluerQualiteRushs } = await import('@/lib/creer/qualite-rushs');
    const q = evaluerQualiteRushs([qualite]).rushs[0];
    if (q && q.verdict === 'inutilisable' && q.motifs.some((m) => m.gravite === 'fort' && QUALITE_BLOQUANTE.has(m.code))) {
      return { etape: { etat: 'sans_objet', motif: 'qualite_insuffisante', le } };
    }
  }
  const { positionsImages } = await import('@/lib/autopilot/analyse/extraction');
  const { jpegEnTete, jpegComplet, TAILLE_MAX_IMAGE, TAILLE_MIN_IMAGE } = await import('@/lib/autopilot/analyse/visuel');
  const positions = positionsImages(duree, cfg.images);
  const brutes = await (d.extraireImages ?? extraireImagesDefaut)(c, positions).catch(() => []);
  const images = brutes
    .filter((i) => i.octets.length >= TAILLE_MIN_IMAGE && i.octets.length <= TAILLE_MAX_IMAGE && jpegEnTete(i.octets) && jpegComplet(i.octets))
    .slice(0, cfg.images);
  if (images.length === 0) return { etape: { etat: 'echec', motif: 'aucune_image', le } };

  const modele = cfg.vision.modele!;
  const tarif = TARIFS_VISION[modele];
  const estimation = estimerJetonsEntree(images.map((i) => i.octets));
  const coutPrevu = coutVisionUsd(modele, estimation, JETONS_SORTIE_MAX_RUSH);
  if (estimation > JETONS_ENTREE_MAX_RUSH || coutPrevu === null || coutPrevu > COUT_MAX_RUSH_USD) {
    return { etape: { etat: 'sans_objet', motif: 'plafond_depasse', le } };
  }

  if (!(await consentementToujours())) return { etape: { etat: 'a_faire', motif: 'consentement_retire', le } };
  const { appelerVisionAnthropic } = await import('@/lib/autopilot/analyse/visuel-anthropic');
  let sortie;
  try {
    sortie = await avecDelai(appelerVisionAnthropic({
      cle: cfg.vision.cle!, modele, transport: d.transportVision,
      systeme: INVITE_OBSERVATIONS_RUSH,
      images: images.map((i) => ({ seconde: i.seconde, mimeType: 'image/jpeg' as const, data: i.octets })),
      consigneFinale: CONSIGNE_FINALE,
      schema: schemaObservations(),
      jetonsSortieMax: JETONS_SORTIE_MAX_RUSH,
      delaiMs: DELAI_VISION_RUSH_MS,
      parametres: tarif.parametres,
    }), DELAI_VISION_RUSH_MS + 1000);
  } catch (e) {
    return { etape: { etat: 'echec', motif: motifErreur(e), le } };
  }
  const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const jetonsEntree = nombre(sortie.usage?.inputTokens);
  const jetonsSortie = nombre(sortie.usage?.outputTokens);
  const usage: UsageVision = {
    modele,
    images: images.length,
    jetonsEntree,
    jetonsSortie,
    // Si le transport ne dit rien de l'usage, on compte le pire cas prévu.
    coutEstimeUsd: coutVisionUsd(modele, jetonsEntree ?? estimation, jetonsSortie ?? JETONS_SORTIE_MAX_RUSH),
    ...((jetonsEntree ?? 0) > JETONS_ENTREE_MAX_RUSH || (jetonsSortie ?? 0) > JETONS_SORTIE_MAX_RUSH ? { depassement: true as const } : {}),
  };
  const lu = lireReponseObservations(sortie.reponse);
  // L'appel est PAYÉ même si la réponse est inutilisable : l'usage est gardé,
  // l'étape est un ÉCHEC (réessai après 24 h), jamais un succès.
  if (!lu.ok) return { etape: { etat: 'echec', motif: `reponse_${lu.motif}`, le }, usage };
  return { etape: { etat: 'faite', le }, vision: lu.valeur, usage };
}

async function etapeTranscriptionRush(
  c: CibleRush, duree: number, sonde: SondeRush, qualite: AnalyseRushQualite | null,
  cfg: ConfigAnalyseIA, d: DependancesAnalyseIA, le: string, consentementToujours: () => Promise<boolean>,
): Promise<{ etape: EtapeAnalyse; parole?: FicheContenuRushV2['observations']['parole']; langue?: FicheContenuRushV2['observations']['langue']; usage?: UsageTranscription }> {
  if (!sonde.audio) return { etape: { etat: 'sans_objet', motif: 'pas_de_son', le } };
  if (qualite && paroleDepuisEnergie(qualite.echantillons.map((e) => e.audio)) === 'improbable') {
    return { etape: { etat: 'sans_objet', motif: 'silence', le } };
  }
  const modele = cfg.transcription.modele!;

  const retire = { etape: { etat: 'a_faire' as const, motif: 'consentement_retire', le } };
  if (!(await consentementToujours())) return retire;
  // Même fichier déjà transcrit par l'Autopilote : relu, AUCUN appel.
  const existante = await (d.transcriptionExistante ?? transcriptionExistanteDefaut)(c).catch(() => null);
  if (existante) {
    return {
      etape: { etat: 'faite', motif: 'reutilisee', le },
      parole: observationsParole(existante), langue: langueParole(existante.langue),
      usage: { modele, secondesAudio: 0, secondesFacturees: 0, coutEstimeUsd: 0, reutilisee: true },
    };
  }

  const secondes = Math.min(duree, AUDIO_MAX_SECONDES);
  const { facturees, cout } = coutTranscriptionUsd(modele, secondes);
  if (cout === null || cout > COUT_MAX_RUSH_USD) return { etape: { etat: 'sans_objet', motif: 'plafond_depasse', le } };

  const { prendrePlaceTranscription } = await import('@/lib/autopilot/analyse/capacite');
  const place = prendrePlaceTranscription();
  if (!place) return { etape: { etat: 'a_faire', motif: 'capacite', le } };
  if (!(await consentementToujours())) { place.liberer(); return retire; }
  let r: Awaited<ReturnType<NonNullable<DependancesAnalyseIA['transcrire']>>>;
  try {
    r = await avecDelai((d.transcrire ?? transcrireDefaut)(c, modele, cfg.transcription.cle!, AUDIO_MAX_SECONDES, d.transportTranscription),
      DELAI_TRANSCRIPTION_RUSH_MS + 130_000);
  } catch (e) {
    return { etape: { etat: 'echec', motif: motifErreur(e), le } };
  } finally {
    place.liberer();
  }
  if (!r.ok) {
    const motif = /^[a-z_0-9]{1,50}$/.test(r.motif) ? r.motif : 'fournisseur_en_erreur';
    return { etape: { etat: 'echec', motif, le } };
  }
  const usage: UsageTranscription = { modele, secondesAudio: Math.round(secondes * 1000) / 1000, secondesFacturees: facturees, coutEstimeUsd: cout };
  const { lireReponseTranscription } = await import('@/lib/autopilot/analyse/transcription-contrat');
  const lu = lireReponseTranscription(r.reponse, secondes);
  if (!lu.ok) return { etape: { etat: 'echec', motif: 'reponse_invalide', le }, usage };
  const t = lu.transcription;
  return {
    etape: { etat: 'faite', le },
    parole: observationsParole({ presente: t.presente, langue: t.langue, texte: t.texte, segments: t.segments }),
    langue: t.presente ? langueParole(t.langue) : 'inconnu',
    usage,
  };
}

/** Pour les tests : vide les travaux en cours de ce processus. */
export function _reinitialiserAnalyseIA(): void {
  enCours.clear();
}
