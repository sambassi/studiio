// @vitest-environment node
/**
 * M2-b — Analyse visuelle et transcription des rushes PERSONNELS.
 *
 * ⚠️ AUCUN APPEL RÉEL. Tous les fournisseurs sont SIMULÉS (transports
 * injectés) ; un espion sur `fetch` prouve qu'aucun octet ne part vers
 * api.anthropic.com ni api.groq.com. MinIO est doublé en mémoire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lancerAnalyseIA, lireFicheV2, configAnalyseIA, cibleRushPersonnel, enregistrerConsentementIA,
  coutVisionUsd, coutTranscriptionUsd, jetonsImage, dimensionsJpeg, estimerJetonsEntree,
  TARIFS_VISION, TARIFS_TRANSCRIPTION, SOURCE_TARIFS, JETONS_ENTREE_MAX_RUSH, AUDIO_MAX_SECONDES, REESSAI_ECHEC_MS,
  _reinitialiserAnalyseIA, type DependancesAnalyseIA,
} from '@/lib/creer/analyse-ia-rush';
import { ABSENT, cleFicheContenu, cleConsentementIA, ficheContenuServeur, type StockageFiches } from '@/lib/creer/fiche-contenu-serveur';
import { registreAccorde, VERSION_CONSENTEMENT_IA } from '@/lib/creer/consentement-ia';
import { INVITE_OBSERVATIONS_RUSH } from '@/lib/autopilot/analyse/visuel-invite';
import { prendrePlaceExtraction } from '@/lib/autopilot/analyse/capacite';
import { prefixesStockageDuCompte } from '@/lib/rgpd/suppression-donnees';
import { cibleLisibleParCompte, cleDansNamespaceAnalyse } from '@/lib/storage/acces-objet';
import type { AnalyseRushQualite } from '@/lib/creer/nettete-hd';

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ADMIN = 'contact.artboost@gmail.com';
const PUB = '/storage/v1/object/public';
const RUSH_A = `${PUB}/media/${A}/library/converted_1791985445290.mp4`;
const CLE_A = `${A}/library/converted_1791985445290.mp4`;
const RUSH_B = `${PUB}/media/${B}/library/converted_1792081208949.mp4`;
const STOCK_A = `${PUB}/media/${A}/library/stock-pexels-video-8955360.mp4`;
const TAILLE = 18_000_000;

const ENV_ON = {
  STUDIIO_VISION_RUSH_ENABLED: 'true', STUDIIO_VISION_RUSH_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'sk-test',
  STUDIIO_TRANSCRIPTION_RUSH_ENABLED: 'true', STUDIIO_TRANSCRIPTION_RUSH_MODEL: 'whisper-large-v3-turbo', GROQ_API_KEY: 'gsk-test',
};

/** Un JPEG minimal VALIDE pour nos gardes (FFD8FF … SOF0 l×h … FFD9), ≥ 512 octets. */
function jpeg(largeur = 640, hauteur = 1138, remplissage = 1200): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, hauteur >> 8, hauteur & 0xff, largeur >> 8, largeur & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(remplissage, 0x55), Buffer.from([0xff, 0xd9])]);
}

function memoire(objets: Record<string, { taille?: number; json?: unknown }> = {}) {
  const store = new Map(Object.entries(objets));
  const appels = { taille: 0, lire: [] as string[], ecrire: [] as string[] };
  const s: StockageFiches = {
    async taille(b, c) { appels.taille++; const o = store.get(`${b}/${c}`); return o?.taille ?? ABSENT; },
    async lireJson(b, c) { appels.lire.push(`${b}/${c}`); const o = store.get(`${b}/${c}`); return o && 'json' in o ? JSON.parse(JSON.stringify(o.json)) : ABSENT; },
    async ecrireJson(b, c, v) { appels.ecrire.push(`${b}/${c}`); store.set(`${b}/${c}`, { json: JSON.parse(JSON.stringify(v)) }); },
  };
  return { s, store, appels };
}

/** Compte A, rush A présent, consentement A valide. */
function monde(extra: Record<string, { taille?: number; json?: unknown }> = {}) {
  return memoire({
    [`media/${CLE_A}`]: { taille: TAILLE },
    [`media/${B}/library/converted_1792081208949.mp4`]: { taille: TAILLE },
    [`media/${cleConsentementIA(A)}`]: { json: registreAccorde('fr') },
    ...extra,
  });
}

/** Mesures M1 simulées : lumière, netteté et son choisis. */
function qualite(o: { luminosite?: number; audio?: number; nettete?: number } = {}): AnalyseRushQualite {
  return {
    url: RUSH_A, duree: 30,
    echantillons: Array.from({ length: 20 }, (_, i) => ({
      t: i * 1.5, mouvement: 0.05, luminosite: o.luminosite ?? 0.5, nettete: o.nettete ?? 0.2, audio: o.audio ?? 0.2,
      empreinte: [0.1, 0.9],
    })),
  } as AnalyseRushQualite;
}

/** Réponse Anthropic simulée (corps Messages API). */
function reponseAnthropic(objet: unknown, usage = { input_tokens: 6200, output_tokens: 180 }) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof objet === 'string' ? objet : JSON.stringify(objet) }], usage }) };
}

const VISION_DANSE = {
  objets: [{ id: 'music', libre: 'enceinte portable', confiance: 'moyenne' }],
  lieu: { id: 'studio', libre: 'studio de danse', confiance: 'elevee' },
  action: { id: 'dance', libre: 'chorégraphie en groupe', confiance: 'elevee' },
  personnes: { valeur: 'plusieurs', confiance: 'elevee' },
  categories: [{ id: 'dance', confiance: 'elevee' }],
};
const VISION_CUISINE = {
  objets: [{ id: null, libre: 'planche à découper', confiance: 'moyenne' }, { id: null, libre: 'casserole', confiance: 'moyenne' }],
  lieu: { id: 'home', libre: 'cuisine', confiance: 'moyenne' },
  action: { id: 'cooking', libre: 'découpe de légumes', confiance: 'moyenne' },
  personnes: { valeur: 'une', confiance: 'moyenne' },
  categories: [{ id: 'cooking', confiance: 'moyenne' }, { id: 'healthy-food', confiance: 'faible' }],
};
const VISION_SALLE = {
  objets: [{ id: null, libre: 'haltères', confiance: 'moyenne' }],
  lieu: { id: 'gym', libre: null, confiance: 'moyenne' },
  action: { id: 'strength-training', libre: 'soulevé de poids', confiance: 'moyenne' },
  personnes: { valeur: 'une', confiance: 'moyenne' },
  categories: [{ id: 'strength-training', confiance: 'moyenne' }, { id: 'gym', confiance: 'moyenne' }],
};
const VISION_HORS_SUJET = {
  objets: [{ id: null, libre: 'ballon', confiance: 'moyenne' }],
  lieu: { id: null, libre: 'terrain de football', confiance: 'moyenne' },
  action: { id: null, libre: 'match de football', confiance: 'moyenne' },
  personnes: { valeur: 'plusieurs', confiance: 'moyenne' },
  categories: [],
};

function groq(texte: string, langue = 'french') {
  return JSON.stringify({ text: texte, language: langue, segments: [{ start: 0, end: 3, text: texte }], words: [] });
}

/** Dépendances simulées, avec compteurs d'appels fournisseur. */
function deps(o: {
  stockage?: StockageFiches; env?: Record<string, string>; vision?: () => Promise<unknown>; parole?: string | (() => Promise<{ ok: true; reponse: string } | { ok: false; motif: string }>);
  sonde?: { dureeSecondes: number | null; video: boolean; audio: boolean } | null; images?: Buffer[]; qualite?: AnalyseRushQualite | null;
  existante?: { presente: boolean; langue: unknown; texte: string } | null; maintenant?: Date;
} = {}) {
  const compte = { vision: 0, transcription: 0, corps: [] as string[], dureeMax: [] as number[] };
  const d: DependancesAnalyseIA = {
    env: o.env ?? ENV_ON,
    stockage: o.stockage,
    transportVision: async (url, init) => {
      compte.vision++;
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      compte.corps.push(String(init.body));
      return (o.vision ? await o.vision() : reponseAnthropic(VISION_DANSE)) as never;
    },
    sonder: async () => (o.sonde === undefined ? { dureeSecondes: 30, video: true, audio: true } : o.sonde),
    extraireImages: async (_c, positions) => (o.images ?? positions.map(() => jpeg())).map((octets, i) => ({ seconde: positions[i] ?? i, octets })),
    mesurerQualite: async () => (o.qualite === undefined ? qualite() : o.qualite),
    transcrire: async (_c, _m, _k, dureeMax) => {
      compte.transcription++;
      compte.dureeMax.push(dureeMax);
      if (typeof o.parole === 'function') return o.parole();
      return { ok: true, reponse: groq(o.parole ?? '') };
    },
    transcriptionExistante: async () => o.existante ?? null,
    maintenant: () => o.maintenant ?? new Date('2026-10-16T10:00:00Z'),
  };
  return { d, compte };
}

let fetchEspion: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
  _reinitialiserAnalyseIA();
  fetchEspion = vi.fn(async () => { throw new Error('fetch interdit dans ce test'); });
  vi.stubGlobal('fetch', fetchEspion);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function analyser(url: string, d: DependancesAnalyseIA, uid = A, email: string | null = ADMIN) {
  const r = await lancerAnalyseIA(url, uid, email, d);
  const fiche = r.tache ? await r.tache : r.fiche ?? null;
  return { ...r, fiche };
}

// ─────────────────────────────────────────────────────────────────────────
describe('interrupteurs, configuration, admin, consentement — AUCUN envoi', () => {
  it('OFF par défaut : rien lu, rien envoyé, aucun fetch', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, env: {} });
    const r = await analyser(RUSH_A, d);
    expect(r.statut).toBe('eteint');
    expect(compte.vision + compte.transcription).toBe(0);
    expect(m.appels.lire.length + m.appels.taille).toBe(0);
    expect(fetchEspion).not.toHaveBeenCalled();
  });
  it('valeur EXACTE "true" : "1", "TRUE", "oui" restent éteints', () => {
    for (const v of ['1', 'TRUE', 'oui', ' true', 'yes']) {
      const c = configAnalyseIA({ ...ENV_ON, STUDIIO_VISION_RUSH_ENABLED: v, STUDIIO_TRANSCRIPTION_RUSH_ENABLED: v });
      expect(c.vision.active || c.transcription.active, v).toBe(false);
    }
  });
  it('interrupteurs INDÉPENDANTS', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, env: { ...ENV_ON, STUDIIO_TRANSCRIPTION_RUSH_ENABLED: 'false' }, parole: 'bonjour' });
    const r = await analyser(RUSH_A, d);
    expect(r.statut).toBe('lance');
    expect(compte.vision).toBe(1);
    expect(compte.transcription).toBe(0);
    expect(r.fiche!.etapes.transcription).toMatchObject({ etat: 'a_faire', motif: 'eteint' });
  });
  it('modèle OBLIGATOIRE, sans défaut ; modèle hors table de tarifs → aucun appel', async () => {
    expect(configAnalyseIA({ STUDIIO_VISION_RUSH_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }).vision).toMatchObject({ prete: false, motif: 'modele_absent' });
    expect(configAnalyseIA({ STUDIIO_VISION_RUSH_ENABLED: 'true', STUDIIO_VISION_RUSH_MODEL: 'claude-haiku-5-5' }).vision).toMatchObject({ prete: false, motif: 'cle_absente' });
    expect(configAnalyseIA({ STUDIIO_VISION_RUSH_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', STUDIIO_VISION_RUSH_MODEL: 'claude-opus-5-5' }).vision).toMatchObject({ prete: false, motif: 'modele_sans_tarif' });
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, env: { STUDIIO_VISION_RUSH_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' } });
    expect((await analyser(RUSH_A, d)).statut).toBe('config_invalide');
    expect(compte.vision).toBe(0);
    // Le source ne code aucun modèle par défaut.
    const src = readFileSync(join(process.cwd(), 'src/lib/creer/analyse-ia-rush.ts'), 'utf8');
    expect(src).not.toMatch(/STUDIIO_VISION_RUSH_MODEL\s*\]?\s*(\?\?|\|\|)/);
    expect(src).not.toMatch(/STUDIIO_TRANSCRIPTION_RUSH_MODEL\s*\]?\s*(\?\?|\|\|)/);
  });
  it('compte NON admin → refus, rien lu', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s });
    const r = await analyser(RUSH_A, d, A, 'quelquun@example.com');
    expect(r.statut).toBe('non_admin');
    expect(compte.vision + compte.transcription).toBe(0);
    expect(m.appels.lire).toHaveLength(0);
  });
  it('consentement ABSENT, RÉVOQUÉ ou d’une AUTRE version → aucun envoi', async () => {
    for (const registre of [undefined, { ...registreAccorde('fr'), revoqueLe: '2026-10-15T00:00:00Z' }, { ...registreAccorde('fr'), version: VERSION_CONSENTEMENT_IA + 1 }, { ...registreAccorde('fr'), fournisseurs: ['anthropic'] }, 'oui']) {
      const m = memoire({ [`media/${CLE_A}`]: { taille: TAILLE }, ...(registre === undefined ? {} : { [`media/${cleConsentementIA(A)}`]: { json: registre } }) });
      const { d, compte } = deps({ stockage: m.s });
      const r = await analyser(RUSH_A, d);
      expect(r.statut, JSON.stringify(registre)).toBe('sans_consentement');
      expect(compte.vision + compte.transcription).toBe(0);
    }
  });
  it('révocation : après DELETE, plus aucun envoi', async () => {
    const m = monde();
    await enregistrerConsentementIA(A, false, 'fr', m.s);
    const { d, compte } = deps({ stockage: m.s });
    expect((await analyser(RUSH_A, d)).statut).toBe('sans_consentement');
    expect(compte.vision).toBe(0);
  });
  it('BALAYAGE : défauts réels (aucun transport injecté) + OFF ou sans consentement → zéro fetch vers Anthropic / Groq', async () => {
    const m = memoire({ [`media/${CLE_A}`]: { taille: TAILLE } });
    for (const env of [{}, ENV_ON]) {
      const r = await lancerAnalyseIA(RUSH_A, A, ADMIN, { env, stockage: m.s });
      expect(['eteint', 'sans_consentement']).toContain(r.statut);
      expect(r.tache).toBeUndefined();
    }
    const vers = fetchEspion.mock.calls.map((c) => String(c[0]));
    expect(vers.filter((u) => /anthropic|groq/.test(u))).toEqual([]);
    expect(fetchEspion).not.toHaveBeenCalled();
  });
});

describe('isolation entre comptes et périmètre du rush', () => {
  it('A ne lance pas l’analyse du rush de B ; ni stock, ni URL externe, ni namespace privé', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s });
    for (const url of [RUSH_B, STOCK_A, 'https://ailleurs.example/video.mp4', `${PUB}/media/${A}/analyse/x/vignette-01.jpg`, `${PUB}/media/${A}/../${B}/library/x.mp4`]) {
      expect((await analyser(url, d)).statut, url).toBe('refuse');
    }
    expect(compte.vision + compte.transcription).toBe(0);
    expect(cibleRushPersonnel(RUSH_A, A)).toEqual({ bucket: 'media', cle: CLE_A });
    expect(cibleRushPersonnel(RUSH_A, B)).toBeNull();
  });
  it('A ne LIT pas l’analyse de B : la clé dérive de la session', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s });
    await analyser(RUSH_A, d);
    expect(await lireFicheV2(RUSH_A, A, m.s)).not.toBeNull();
    expect(await lireFicheV2(RUSH_A, B, m.s)).toBeNull();
    const cleV2 = cleFicheContenu(A, 'media', CLE_A, TAILLE, 2);
    expect(cibleLisibleParCompte('media', cleV2, B)).toBe(false);
    expect(cibleLisibleParCompte('media', cleV2, A)).toBe(false); // namespace privé : jamais servi
    expect(cleDansNamespaceAnalyse('media', cleV2)).toBe(true);
  });
});

describe('rushes personnels types (fournisseurs simulés)', () => {
  it('danse : vision seule plafonnée à « moyenne » ; + parole concordante → « élevée »', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s, parole: '' , qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.version).toBe(2);
    expect(r.fiche!.categories.find((c) => c.id === 'dance')).toMatchObject({ confiance: 'moyenne', sources: ['vision'] });
    expect(r.fiche!.observations.lieu).toMatchObject({ id: 'studio', confiance: 'moyenne', source: 'vision' });
    expect(r.fiche!.observations.personnes).toEqual({ valeur: 'plusieurs', confiance: 'moyenne', source: 'vision' });
    expect(r.fiche!.inconnus).toEqual([]);

    const m2 = monde();
    const { d: d2 } = deps({ stockage: m2.s, parole: 'On reprend la chorégraphie, on danse tous ensemble !' });
    const r2 = await analyser(RUSH_A, d2);
    expect(r2.fiche!.categories.find((c) => c.id === 'dance')).toMatchObject({ confiance: 'elevee' });
    expect(r2.fiche!.parole).toBe('probable');
    expect(r2.fiche!.observations.langue).toBe('fr');
    expect(r2.fiche!.observations.parole?.sujets).toContain('dance');
  });
  it('cuisine et salle de sport : catégories de la taxonomie, libres filtrés', async () => {
    for (const [vision, attendu] of [[VISION_CUISINE, 'cooking'], [VISION_SALLE, 'strength-training']] as const) {
      const m = monde();
      const { d } = deps({ stockage: m.s, vision: async () => reponseAnthropic(vision), qualite: qualite({ audio: 0 }) });
      const r = await analyser(RUSH_A, d);
      expect(r.fiche!.categories.map((c) => c.id)).toContain(attendu);
      expect(r.fiche!.categories.every((c) => c.confiance !== 'elevee')).toBe(true);
      expect(r.fiche!.etapes.vision.etat).toBe('faite');
    }
  });
  it('hors sujet (football) : aucune catégorie inventée, jamais « hors sujet » déduit', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s, vision: async () => reponseAnthropic(VISION_HORS_SUJET), qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.categories).toEqual([]);
    expect(r.fiche!.observations.action).toMatchObject({ id: null, libre: 'match de football' });
    expect(JSON.stringify(r.fiche)).not.toMatch(/hors_sujet/);
  });
  it('une catégorie n’implique JAMAIS une action', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s, vision: async () => reponseAnthropic({ ...VISION_DANSE, action: null }), qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.categories.map((c) => c.id)).toContain('dance');
    expect(r.fiche!.inconnus).toContain('action');
  });
  it('confiance « faible » : écrite, mais la dimension reste inconnue ; personnes faible → « inconnu »', async () => {
    const m = monde();
    const faible = { objets: [], lieu: { id: 'beach', libre: null, confiance: 'faible' }, action: null, personnes: { valeur: 'une', confiance: 'faible' }, categories: [] };
    const { d } = deps({ stockage: m.s, vision: async () => reponseAnthropic(faible), qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
    expect(r.fiche!.observations.personnes?.valeur).toBe('inconnu');
  });
});

describe('fichiers invalides, qualité M1, parole', () => {
  it('fichier invalide / corrompu (sonde muette) → échec, AUCUN appel', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, sonde: null });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'echec', motif: 'fichier_illisible' });
    expect(compte.vision + compte.transcription).toBe(0);
  });
  it('images non JPEG ou tronquées → aucune_image, AUCUN appel', async () => {
    const m = monde();
    const tronquee = jpeg().subarray(0, 900);
    const { d, compte } = deps({ stockage: m.s, images: [Buffer.alloc(2000, 1), tronquee], qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'echec', motif: 'aucune_image' });
    expect(compte.vision).toBe(0);
  });
  it('M1 : image noire → pas d’appel vision', async () => {
    const m = monde();
    const noir = qualite({ luminosite: 0.01, audio: 0 });
    noir.echantillons.forEach((e) => { (e as { empreinte?: number[] }).empreinte = [0.01, 0.02]; });
    const { d, compte } = deps({ stockage: m.s, qualite: noir });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'sans_objet', motif: 'qualite_insuffisante' });
    expect(compte.vision).toBe(0);
  });
  it('sans parole (énergie muette) → pas d’appel transcription ; sans piste son → pas_de_son', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.transcription).toMatchObject({ etat: 'sans_objet', motif: 'silence' });
    expect(r.fiche!.parole).toBe('improbable');
    expect(compte.transcription).toBe(0);

    const m2 = monde();
    const { d: d2, compte: c2 } = deps({ stockage: m2.s, sonde: { dureeSecondes: 30, video: true, audio: false } });
    expect((await analyser(RUSH_A, d2)).fiche!.etapes.transcription.motif).toBe('pas_de_son');
    expect(c2.transcription).toBe(0);
  });
  it('transcription Autopilote du MÊME fichier réutilisée : aucun appel Groq', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, existante: { presente: true, langue: 'french', texte: 'aujourd’hui on cuisine un plat' } });
    const r = await analyser(RUSH_A, d);
    expect(compte.transcription).toBe(0);
    expect(r.fiche!.usage.transcription).toMatchObject({ reutilisee: true, coutEstimeUsd: 0 });
    expect(r.fiche!.observations.parole?.sujets).toContain('cooking');
  });
});

describe('erreurs fournisseur : la fiche M2-a reste, rien n’est mis en cache comme succès', () => {
  const cas: Array<[string, () => Promise<unknown>, string]> = [
    ['timeout', async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); }, 'delai_depasse'],
    ['429', async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limit sk-ant-secret https://api' } }) }), 'fournisseur_http_429'],
    ['500', async () => ({ ok: false, status: 500, json: async () => ({}) }), 'fournisseur_http_500'],
    ['JSON invalide', async () => reponseAnthropic('{"objets": [ tronqué'), 'reponse_json_invalide'],
    ['hors schéma', async () => reponseAnthropic({ ...VISION_DANSE, decision: 'supprimer' }), 'reponse_hors_schema'],
  ];
  for (const [nom, vision, motif] of cas) {
    it(nom, async () => {
      const m = monde();
      const { d, compte } = deps({ stockage: m.s, vision, qualite: qualite({ audio: 0 }) });
      const r = await analyser(RUSH_A, d);
      expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'echec', motif });
      expect(r.fiche!.observations.objets).toEqual([]);
      expect(r.fiche!.inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
      expect(JSON.stringify(r.fiche)).not.toMatch(/sk-ant|https?:/);
      // Pas de nouvel appel dans les 24 h ; un nouvel essai après.
      const { d: d2, compte: c2 } = deps({ stockage: m.s, vision: async () => reponseAnthropic(VISION_DANSE), maintenant: new Date('2026-10-16T20:00:00Z') });
      expect((await analyser(RUSH_A, d2)).statut).toBe('en_cache');
      expect(c2.vision).toBe(0);
      const { d: d3, compte: c3 } = deps({ stockage: m.s, vision: async () => reponseAnthropic(VISION_DANSE), maintenant: new Date(Date.parse('2026-10-16T10:00:00Z') + REESSAI_ECHEC_MS + 1) });
      const r3 = await analyser(RUSH_A, d3);
      expect(c3.vision).toBe(1);
      expect(r3.fiche!.etapes.vision.etat).toBe('faite');
      expect(compte.vision).toBe(1);
    });
  }
  it('échec Groq (500) → transcription en échec, vision conservée, aucun 2e appel vision', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s, parole: async () => ({ ok: false, motif: 'fournisseur_http_500' }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes).toMatchObject({ vision: { etat: 'faite' }, transcription: { etat: 'echec', motif: 'fournisseur_http_500' } });
    const { d: d2, compte: c2 } = deps({ stockage: m.s, parole: 'on danse', maintenant: new Date(Date.parse('2026-10-16T10:00:00Z') + REESSAI_ECHEC_MS + 1) });
    const r2 = await analyser(RUSH_A, d2);
    expect(c2.vision).toBe(0);
    expect(c2.transcription).toBe(1);
    expect(r2.fiche!.categories.find((c) => c.id === 'dance')?.confiance).toBe('elevee');
  });
});

describe('cache durable MinIO', () => {
  it('même clé stable que M2-a (`.v2.json`), sous le préfixe purgé par la suppression RGPD', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s });
    await analyser(RUSH_A, d);
    const cleV2 = cleFicheContenu(A, 'media', CLE_A, TAILLE, 2);
    expect(cleV2).toBe(cleFicheContenu(A, 'media', CLE_A, TAILLE).replace(/\.v1\.json$/, '.v2.json'));
    expect(m.appels.ecrire).toContain(`media/${cleV2}`);
    const prefixes = prefixesStockageDuCompte(A);
    for (const cle of [cleV2, cleConsentementIA(A)]) {
      expect(prefixes.some((p) => p.bucket === 'media' && cle.startsWith(p.prefixe)), cle).toBe(true);
    }
  });
  it('2e ouverture : relue, AUCUN appel ; autre taille (fichier remplacé) → nouvel appel', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s });
    await analyser(RUSH_A, d);
    expect(compte).toMatchObject({ vision: 1, transcription: 1 });
    const r2 = await analyser(RUSH_A, d);
    expect(r2.statut).toBe('en_cache');
    expect(compte).toMatchObject({ vision: 1, transcription: 1 });
    m.store.set(`media/${CLE_A}`, { taille: TAILLE + 1 });
    await analyser(RUSH_A, d);
    expect(compte).toMatchObject({ vision: 2, transcription: 2 });
  });
  it('la fiche v1 reste lue et INCHANGÉE par la présence d’une v2', async () => {
    const m = monde();
    const avant = await ficheContenuServeur(RUSH_A, A, { stockage: m.s });
    const { d } = deps({ stockage: m.s });
    await analyser(RUSH_A, d);
    const apres = await ficheContenuServeur(RUSH_A, A, { stockage: m.s });
    expect(apres!.fiche).toEqual(avant!.fiche);
    expect(apres!.fiche.version).toBe(1);
  });
  it('fiche v2 corrompue en cache → ignorée (jamais servie), recalculée', async () => {
    const cleV2 = cleFicheContenu(A, 'media', CLE_A, TAILLE, 2);
    const m = monde({ [`media/${cleV2}`]: { json: { version: 2, categories: [{ id: 'inventee', confiance: 'elevee', sources: ['vision'] }] } } });
    expect(await lireFicheV2(RUSH_A, A, m.s)).toBeNull();
    const { d, compte } = deps({ stockage: m.s });
    expect((await analyser(RUSH_A, d)).statut).toBe('lance');
    expect(compte.vision).toBe(1);
  });
  it('jamais deux appels pour le même rush : 2e demande pendant la 1re → déjà en cours', async () => {
    const m = monde();
    let liberer!: () => void;
    const attente = new Promise<void>((r) => { liberer = r; });
    const { d, compte } = deps({ stockage: m.s, vision: async () => { await attente; return reponseAnthropic(VISION_DANSE); } });
    const r1 = await lancerAnalyseIA(RUSH_A, A, ADMIN, d);
    const r2 = await lancerAnalyseIA(RUSH_A, A, ADMIN, d);
    expect(r1.statut).toBe('lance');
    expect(['deja_en_cours', 'occupe']).toContain(r2.statut);
    liberer();
    await r1.tache;
    expect(compte.vision).toBe(1);
  });
  it('une analyse lourde à la fois (capacite.ts) : place prise → occupé, rien d’envoyé', async () => {
    const place = prendrePlaceExtraction()!;
    try {
      const m = monde();
      const { d, compte } = deps({ stockage: m.s });
      expect((await analyser(RUSH_A, d)).statut).toBe('occupe');
      expect(compte.vision).toBe(0);
    } finally { place.liberer(); }
  });
});

describe('plafonds et coût mesuré', () => {
  it('tarifs documentés (source + date) ; coût calculé sur l’usage RENVOYÉ', async () => {
    expect(SOURCE_TARIFS).toMatch(/2026-10-16/);
    expect(TARIFS_VISION['claude-haiku-5-5']).toMatchObject({ entree: 0.10, sortie: 0.50 });
    expect(TARIFS_TRANSCRIPTION['whisper-large-v3-turbo']).toBe(0.04);
    const m = monde();
    const { d } = deps({ stockage: m.s, vision: async () => reponseAnthropic(VISION_DANSE, { input_tokens: 7000, output_tokens: 200 }), parole: 'on danse' });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.usage.vision).toMatchObject({ modele: 'claude-haiku-5-5', images: 6, jetonsEntree: 7000, jetonsSortie: 200, coutEstimeUsd: coutVisionUsd('claude-haiku-5-5', 7000, 200) });
    expect(coutVisionUsd('claude-haiku-5-5', 7000, 200)).toBeCloseTo(0.0008, 6);
    expect(r.fiche!.usage.transcription).toMatchObject({ modele: 'whisper-large-v3-turbo', secondesAudio: 30, secondesFacturees: 30 });
    expect(coutTranscriptionUsd('whisper-large-v3-turbo', 3)).toEqual({ facturees: 10, cout: coutTranscriptionUsd('whisper-large-v3-turbo', 10).cout });
  });
  it('jetons d’image selon la doc (⌈l/28⌉×⌈h/28⌉) ; 6 images portrait 640 px < 10 k', () => {
    expect(dimensionsJpeg(jpeg(640, 1138))).toEqual({ largeur: 640, hauteur: 1138 });
    expect(jetonsImage(jpeg(640, 1138))).toBe(23 * 41);
    expect(estimerJetonsEntree(Array.from({ length: 6 }, () => jpeg()))).toBeLessThan(JETONS_ENTREE_MAX_RUSH);
  });
  it('dépassement PRÉVISIBLE des jetons → aucun appel', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, images: Array.from({ length: 6 }, () => jpeg(2000, 2000)), qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'sans_objet', motif: 'plafond_depasse' });
    expect(compte.vision).toBe(0);
  });
  it('durée audio bornée à 120 s (rush de 10 min)', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, sonde: { dureeSecondes: 600, video: true, audio: true }, parole: 'on cuisine' });
    const r = await analyser(RUSH_A, d);
    expect(compte.dureeMax).toEqual([AUDIO_MAX_SECONDES]);
    expect(r.fiche!.usage.transcription).toMatchObject({ secondesAudio: 120, secondesFacturees: 120 });
  });
  it('requête vision : images + invite constante, AUCUN texte du rush, réflexion coupée, sortie bornée', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, qualite: qualite({ audio: 0 }) });
    await analyser(RUSH_A, d);
    const corps = JSON.parse(compte.corps[0]);
    expect(corps.model).toBe('claude-haiku-5-5');
    expect(corps.system).toBe(INVITE_OBSERVATIONS_RUSH);
    expect(corps.max_tokens).toBe(1000);
    expect(corps.thinking).toEqual({ type: 'disabled' });
    expect(corps.output_config.format.type).toBe('json_schema');
    expect(corps.messages[0].content.filter((b: { type: string }) => b.type === 'image')).toHaveLength(6);
    expect(compte.corps[0]).not.toContain('converted_');
    expect(compte.corps[0]).not.toContain(A);
    expect(compte.corps[0]).not.toContain(ADMIN);
  });
  it('aucun débit de crédits, aucun journal console dans les modules M2-b', () => {
    for (const f of ['src/lib/creer/analyse-ia-rush.ts', 'src/lib/creer/fiche-contenu-v2.ts', 'src/lib/creer/consentement-ia.ts', 'src/app/api/creer/fiches-contenu/approfondir/route.ts', 'src/app/api/creer/consentement-ia/route.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(/@\/lib\/credits|stripe|deduct|debit/i);
      expect(src, f).not.toMatch(/console\.(log|warn|error|info)/);
    }
  });
});

describe('QA — révocation et plafond image', () => {
  it('révocation ENTRE la vision et la transcription → 0 appel transcription', async () => {
    const m = monde();
    const { d, compte } = deps({
      stockage: m.s, parole: 'on danse',
      vision: async () => { await enregistrerConsentementIA(A, false, 'fr', m.s); return reponseAnthropic(VISION_DANSE); },
    });
    const r = await analyser(RUSH_A, d);
    expect(compte.vision).toBe(1);
    expect(compte.transcription).toBe(0);
    expect(r.fiche!.etapes.transcription).toMatchObject({ etat: 'a_faire', motif: 'consentement_retire' });
  });
  it('révocation après le lancement, avant la vision → 0 appel', async () => {
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, parole: 'on danse' });
    const mesurer = d.mesurerQualite!;
    d.mesurerQualite = async (...a) => { await enregistrerConsentementIA(A, false, 'fr', m.s); return mesurer(...a); };
    const r = await analyser(RUSH_A, d);
    expect(compte.vision + compte.transcription).toBe(0);
    expect(r.fiche!.etapes.vision.motif).toBe('consentement_retire');
  });
  it('dimensions illisibles : plafond haute résolution (4784 jetons) compté → 3 images suffisent à bloquer', async () => {
    const illisible = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]), Buffer.alloc(1000, 0x11), Buffer.from([0xff, 0xd9])]);
    expect(dimensionsJpeg(illisible)).toBeNull();
    expect(jetonsImage(illisible)).toBe(4784);
    const m = monde();
    const { d, compte } = deps({ stockage: m.s, images: [illisible, illisible, illisible], qualite: qualite({ audio: 0 }) });
    const r = await analyser(RUSH_A, d);
    expect(r.fiche!.etapes.vision).toMatchObject({ etat: 'sans_objet', motif: 'plafond_depasse' });
    expect(compte.vision).toBe(0);
  });
  it('balayage : aucun texte entendu dans la fiche écrite au cache', async () => {
    const m = monde();
    const { d } = deps({ stockage: m.s, parole: 'Marie Curie est venue au 12 rue de la Paix, elle a 30 ans, on danse' });
    await analyser(RUSH_A, d);
    const json = JSON.stringify(m.store.get(`media/${cleFicheContenu(A, 'media', CLE_A, TAILLE, 2)}`)).toLowerCase();
    for (const mot of ['marie', 'curie', 'rue', 'paix', '30 ans', 'venue']) expect(json, mot).not.toContain(mot);
    expect(json).toContain('"dance"');
  });
});
