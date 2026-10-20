/**
 * Banc E2E isolé — fixture commune.
 *
 * ISOLATION (aucune exception) :
 *  - toute requête vers un hôte qui n'est pas localhost/127.0.0.1 est COUPÉE
 *    (`abort`) et comptée dans `externes` — attendu : 0 ;
 *  - toute route `/api/**` est servie par la table `ROUTES` ci-dessous ; une
 *    route absente de la table répond 501 et est journalisée (`nonSimulees`) ;
 *  - seules les routes listées dans `passerAuServeur` (par test) atteignent le
 *    vrai handler Next local — dont l'env est NEUTRALISÉ (.env.local factice) ;
 *  - les médias « fournisseurs » sont des extraits LOCAUX servis sous
 *    `/banc-medias/<fichier>` (Range pris en charge).
 *
 * Journal par test : `journal.json` (console, requêtes échouées, routes non
 * simulées, requêtes externes coupées, appels API) attaché au rapport.
 */
import { test as base, expect, type Page, type Route, type Request, type BrowserContext } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const PHASE: 'avant' | 'apres' = process.env.BANC_PHASE === 'apres' ? 'apres' : 'avant';
export const DOSSIER_BANC = __dirname;
export const DOSSIER_MEDIAS = path.join(__dirname, 'medias');
export const DOSSIER_RESULTATS = path.join(__dirname, 'resultats');
export const DOSSIER_CAPTURES = path.join(DOSSIER_RESULTATS, 'captures', PHASE);
/** Hôtes de production ou de fournisseurs payants : la moindre requête est un défaut du banc. */
export const HOTES_INTERDITS = /(pexels|unsplash|heygen|elevenlabs|openai|anthropic|supabase\.co|studiio\.pro|d-id|zernio|stripe|resend)/i;
export const USER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Une assertion du comportement CIBLE qui échoue sur main (0f098b7).
 * En phase `avant` elle est marquée `test.fail()` (rouge attendu, le test
 * passe si elle échoue) ; en phase `apres` elle doit réussir.
 */
export function attenduAvantCorrection(motif: string): void {
  test.info().annotations.push({ type: 'attendu-avant-correction', description: motif });
  test.fail(PHASE === 'avant', `ATTENDU AVANT CORRECTION — ${motif}`);
}

export const media = (fichier: string) => `/banc-medias/${fichier}`;
/**
 * Hôte HTTPS fictif (TLD réservé `.example`, jamais résolu) pour les médias
 * « fournisseurs » : le code exige une URL https publique (`urlUtilisable`).
 * Intercepté avant tout DNS et servi depuis e2e/banc/medias — pas compté externe.
 */
export const HOTE_MEDIAS = 'medias-banc.example';
export const mediaHttps = (fichier: string) => `https://${HOTE_MEDIAS}/banc-medias/${fichier}`;

// ───────────────────────────────────────────────────────────── données ──

export const VOIX_HEYGEN = [
  { voiceId: 'heygen-fr-1', id: 'heygen-fr-1', name: 'Léa (FR)', language: 'French', gender: 'female', provider: 'heygen' },
  { voiceId: 'heygen-fr-2', id: 'heygen-fr-2', name: 'Hugo (FR)', language: 'French', gender: 'male', provider: 'heygen' },
];
export const VOIX_ELEVEN = [
  { voiceId: 'eleven-fr-1', id: 'eleven-fr-1', name: 'Charlotte', language: 'fr', gender: 'female', provider: 'elevenlabs', category: 'premade' },
];

export function mediaStock(i: number, type: 'video' | 'photo', requete: string, format = '9:16') {
  const fichiers = type === 'video' ? ['stock-1.mp4', 'stock-2.mp4', 'rush-1.mp4', 'rush-2.mp4', 'rush-3.mp4'] : ['image-1.jpg', 'image-2.jpg'];
  const f = fichiers[i % fichiers.length];
  const [l, h] = format === '16:9' ? [1920, 1080] : format === '1:1' ? [1080, 1080] : [1080, 1920];
  return {
    id: `pexels:${type}:${9000 + i}`,
    provider: 'pexels',
    providerAssetId: String(9000 + i),
    type,
    largeur: l,
    hauteur: h,
    orientation: format === '16:9' ? 'landscape' : format === '1:1' ? 'square' : 'portrait',
    ...(type === 'video' ? { dureeSecondes: 4 } : {}),
    vignetteUrl: mediaHttps(type === 'video' ? (i % 2 ? 'image-2.jpg' : 'image-1.jpg') : f),
    apercuUrl: mediaHttps(f),
    fichierUrl: mediaHttps(f),
    sourceUrl: mediaHttps(`source-${i}`),
    auteur: `Auteur Banc ${i}`,
    auteurUrl: mediaHttps(`auteur-${i}`),
    description: `${requete} — ${type} de banc ${i}`,
    licence: 'Licence Pexels',
    attribution: `Auteur Banc ${i} sur Pexels`,
  };
}

/** Un avatar actif, validé, avec un VRAI rendu récent (extrait local). */
export const AVATAR = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 3,
};

export type Gestionnaire = (ctx: {
  route: Route; req: Request; url: URL; corps: unknown; etat: EtatBanc;
}) => Promise<ReponseSimulee | 'serveur'> | ReponseSimulee | 'serveur';
export interface ReponseSimulee { status?: number; json?: unknown; body?: Buffer | string; contentType?: string; headers?: Record<string, string> }

export interface EtatBanc {
  posts: Array<Record<string, unknown>>;
  /** Progression simulée de « Produire maintenant » (null = rien en cours). */
  production: { progression: Record<string, unknown> | null; resultat: Record<string, unknown> | null; jumeau: Record<string, unknown> | null };
  prononciations: Array<{ affiche: string; prononce: string }>;
  rendus: Array<{ jobId: string; octets: number; type: string; fichier: string | null }>;
  /** Fichier où écrire le blob PUT du prochain rendu (Créer). */
  fichierRendu: string | null;
  autopilotConfig: Record<string, unknown> | null;
}

const json = (d: unknown, status = 200): ReponseSimulee => ({ status, json: d });

/**
 * Table des routes simulées. Clé = `MÉTHODE chemin` ou `* chemin` ; un chemin
 * se terminant par `*` est un préfixe. La première correspondance gagne ; les
 * surcharges posées par un test (`banc.surcharger`) passent AVANT.
 */
export const ROUTES: Array<[string, Gestionnaire]> = [
  ['GET /api/auth/session', () => json({ user: { id: USER_ID, email: 'dev@localhost', name: 'Développement local', plan: 'pro' }, expires: '2999-12-31T23:59:59.000Z' })],
  ['GET /api/auth/csrf', () => json({ csrfToken: 'banc' })],
  ['GET /api/auth/providers', () => json({})],
  ['POST /api/auth/_log', () => json({})],
  ['GET /api/credits/balance', () => json({ ok: true, politique: 'standard', balance: 480 })],
  ['GET /api/notifications', () => json({ success: true, ready: true, unread: 0, notifications: [] })],
  ['* /api/notifications', () => json({ success: true })],
  ['GET /api/tarifs', () => json({ success: true, prix: {}, exempte: false })],
  ['GET /api/creer/jumeau', () => json({
    success: true,
    data: {
      pret: true, motif: null, message: null,
      jumeau: { avatar: { id: AVATAR.id, version: AVATAR.version, nom: 'Mon avatar', valideLe: '2026-10-02T10:00:00.000Z', fournisseur: 'heygen' }, voix: { id: 'uv-1', nom: 'Ma voix banc' }, prononciations: 0 },
      moteurDisponible: true, messageMoteur: null,
    },
  })],
  // Source d'entraînement d'un avatar VIDÉO : une vidéo (distincte du rendu récent).
  ['GET /api/avatars/versions/*/source', () => ({ status: 200, body: fs.readFileSync(path.join(DOSSIER_MEDIAS, 'stock-2.mp4')), contentType: 'video/mp4' })],
  ['GET /api/avatar/source', () => ({ status: 200, body: fs.readFileSync(path.join(DOSSIER_MEDIAS, 'vignette-avatar.jpg')), contentType: 'image/jpeg' })],
  // ── Voix de synthèse : un MP3 local (aucun fournisseur) ──
  ['POST /api/tts/*', () => ({ status: 200, body: fs.readFileSync(path.join(DOSSIER_MEDIAS, 'voix.mp3')), contentType: 'audio/mpeg' })],
  // ── Dépôts signés : PUT vers /banc-upload/<nom>, relu sous /banc-medias/upload-<nom> ──
  ['POST /api/upload/signed-url', ({ corps }) => {
    const brut = String((corps as { filename?: string })?.filename ?? `fichier-${Date.now()}`);
    const nom = brut.replace(/[^A-Za-z0-9._-]+/g, '_');
    return json({ success: true, signedUrl: `/banc-upload/${nom}`, publicUrl: `http://localhost:3100/banc-medias/upload-${nom}`, path: nom });
  }],
  ['GET /api/render/tarifs', () => json({ ok: true, politique: 'standard', tarifs: { reel: 10, tv: 15 } })],
  ['GET /api/creer/montage-config', () => json({ passages: false })],
  ['GET /api/creer/apercu-config', () => json({ apercuPlan: false })],
  ['GET /api/public/settings', () => json({ agentMontageEnabled: false, demoVideoVisible: false })],
  ['GET /api/user/preferences', () => json({ success: true, preferences: null })],
  ['* /api/user/preferences', () => json({ success: true })],
  ['GET /api/user/profile', () => json({ success: true, user: { id: USER_ID, email: 'dev@localhost', name: 'Développement local', plan: 'pro', credits: 480 } })],
  ['GET /api/social/status', () => json({
    success: true,
    platforms: Object.fromEntries(['instagram', 'tiktok', 'facebook', 'youtube'].map((p) => [p, { available: true, connected: false, username: null, source: null, oauthAvailable: false }])),
    channels: { email: { available: false }, whatsapp: { available: false }, 'afroboost.com': { available: false } },
  })],
  ['GET /api/social/zernio/accounts', () => json({ success: true, autorise: false, comptes: [] })],
  ['GET /api/tts/heygen', () => json({ voices: VOIX_HEYGEN, configured: true })],
  ['GET /api/tts/elevenlabs', () => json({ voices: VOIX_ELEVEN, configured: true })],
  ['GET /api/tts/edge', () => json({ voices: [] })],
  ['GET /api/voice/clone', () => json({ success: true, voices: [] })],
  ['GET /api/autopilot/config', ({ etat }) => json({
    success: true, ready: true, brandingReady: true, styleReady: true, postersReady: true, publishTimeReady: true,
    startDateReady: true, briefReady: true, jumeauReady: true, config: etat.autopilotConfig,
  })],
  ['PUT /api/autopilot/config', ({ etat, corps }) => {
    if (corps && typeof corps === 'object') etat.autopilotConfig = { ...etat.autopilotConfig, ...(corps as Record<string, unknown>) };
    return json({ success: true, brandingReady: true, config: etat.autopilotConfig });
  }],
  ['GET /api/autopilot/sessions', () => json({ success: true, sessions: [] })],
  ['GET /api/avatars', () => json({
    success: true,
    data: {
      avatars: [{
        id: AVATAR.id, nom: 'Mon avatar', parDefaut: true, type: 'video', utilisable: true,
        versionActive: { id: 'v3', version: AVATAR.version, etat: 'active', message: null, type: 'video', creeLe: '2026-10-01T10:00:00.000Z', valideeLe: '2026-10-02T10:00:00.000Z', activeeLe: '2026-10-02T10:00:00.000Z', source: true, originalConserve: false },
        candidate: null, historique: [],
      }],
      capacite: { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 },
      qualites: [],
    },
  })],
  ['GET /api/avatar/apercu', () => json({
    success: true,
    data: {
      avatarId: AVATAR.id, version: AVATAR.version, etat: 'valide',
      apercu: { statut: 'pret', generationId: 'gen-apercu', url: media('avatar.mp4') },
      renduRecent: { generationId: 'gen-recent', url: media('avatar.mp4'), version: AVATAR.version, creeLe: '2026-10-19T09:00:00.000Z' },
    },
  })],
  ['GET /api/avatar/create', () => json({
    success: true,
    data: {
      avatar: {
        id: AVATAR.id, version: AVATAR.version, etat: 'valide', status: 'ready', avatar_type: 'video', name: 'Mon avatar',
        provider: 'heygen', provider_avatar_id: 'banc-avatar', thumbnail_url: media('vignette-avatar.jpg'), preview_url: media('avatar.mp4'),
      },
      voices: VOIX_HEYGEN, defaultVoiceId: VOIX_HEYGEN[0].voiceId,
      didVideoActif: false, jumeauVideoActif: true, nomProfil: 'Banc', orientationAvatar: 'portrait',
    },
  })],
  ['GET /api/avatar/consentement', () => json({ success: true, data: { consenti: true } })],
  ['GET /api/voice/profil', ({ etat }) => json({
    success: true,
    data: {
      voix: [
        { id: 'uv-1', nom: 'Ma voix banc', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-10-01T10:00:00.000Z', utilisable: true },
        { id: 'uv-2', nom: 'Ma voix studio', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-10-05T10:00:00.000Z', utilisable: true },
      ],
      choix: 'uv-1',
      voixResolue: { id: 'uv-1', nom: 'Ma voix banc', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-10-01T10:00:00.000Z', utilisable: true },
      motifVoix: null, messageVoix: null,
      prononciations: etat.prononciations, prononciationsIdentiques: [], ecouteDisponible: true,
    },
  })],
  ['PUT /api/voice/profil/prononciations', ({ etat, corps }) => {
    const liste = (corps as { prononciations?: Array<{ affiche: string; prononce: string }> })?.prononciations ?? [];
    etat.prononciations = liste;
    return json({ success: true, data: { prononciations: liste, prononciationsIdentiques: [] } });
  }],
  ['PUT /api/voice/profil/voix', () => json({ success: true })],
  ['POST /api/voice/prononciations/ecoute', () => ({ status: 200, body: fs.readFileSync(path.join(DOSSIER_MEDIAS, 'voix.mp3')), contentType: 'audio/mpeg' })],
  ['POST /api/voice/ecoute', ({ corps }) => ({
    status: 200, body: fs.readFileSync(path.join(DOSSIER_MEDIAS, 'voix.mp3')), contentType: 'audio/mpeg',
    headers: { 'X-Studiio-Spoken': encodeURIComponent(String((corps as { texte?: string })?.texte ?? '')) },
  })],
  ['GET /api/autopilot/produire-maintenant/progression', ({ etat }) => json({ success: true, ...etat.production })],
  ['GET /api/autopilot/produire-maintenant', ({ etat }) => json({
    success: true, politique: 'standard', cout: 10, detail: { rendu: 10, avatar: 0, affiche: 0 }, solde: 480,
    enCours: !!etat.production.progression,
  })],
  ['POST /api/autopilot/produire-maintenant', ({ etat }) => {
    etat.production = { progression: { pourcent: 0, etape: 'analyse', libelle: 'Analyse des rushes…', majA: Date.now(), avancement: null }, resultat: null, jumeau: null };
    return json({ success: true, enCours: true, jobId: 'job-autopilote-banc', scheduledDate: aujourdhui(), scheduledTime: '18:00', timezone: 'Europe/Paris', title: 'Motivation' }, 202);
  }],
  ['GET /api/posts', ({ etat }) => json({ success: true, posts: etat.posts })],
  ['POST /api/posts', ({ etat, corps }) => {
    const c = (corps ?? {}) as Record<string, unknown>;
    const post = { id: `post-banc-${etat.posts.length + 1}`, user_id: USER_ID, created_at: new Date().toISOString(), status: 'draft', platforms: [], ...c };
    etat.posts.push(post);
    return json({ success: true, post });
  }],
  ['GET /api/stock/recherche', ({ url }) => {
    const requete = url.searchParams.get('requete') || '';
    const type = url.searchParams.get('type') === 'video' ? 'video' : 'photo';
    const format = url.searchParams.get('format') || '9:16';
    const medias = Array.from({ length: 8 }, (_, i) => mediaStock(i, type, requete, format));
    return json({ success: true, medias, echecs: [], requete });
  }],
  ['GET /api/pexels', ({ url }) => {
    const q = url.searchParams.get('query') || url.searchParams.get('q') || 'banc';
    return json({ success: true, photos: [0, 1, 2, 3].map((i) => ({ id: 7000 + i, url: mediaHttps(`image-${(i % 2) + 1}.jpg?v=${i}`), medium: mediaHttps(`image-${(i % 2) + 1}.jpg?v=${i}`), small: mediaHttps(`image-${(i % 2) + 1}.jpg?v=${i}`), photographer: `Auteur Banc ${i}`, source: 'pexels', alt: q })) });
  }],
  ['GET /api/media/list', () => json({ success: true, items: [], medias: [] })],
  ['GET /api/videos', () => json({ success: true, videos: [] })],
  ['GET /api/billing/summary', () => json({ success: true })],
  ['GET /api/pricing', () => json({ success: true })],
  // ── Rendu Créer (compositeur navigateur) ──
  ['POST /api/render/jobs', ({ etat }) => {
    const jobId = `job-creer-${etat.rendus.length + 1}`;
    return json({ ok: true, jobId, uploadUrl: `/api/render/jobs/${jobId}/upload`, uploadMode: 'relais', publicUrl: media(`rendu-${jobId}.webm`), cout: 10 });
  }],
  ['POST /api/render/jobs/*/upload', ({ url }) => json({ ok: true, uploadUrl: url.pathname })],
  ['PUT /api/render/jobs/*/upload', ({ req, etat, url }) => {
    const corps = req.postDataBuffer() ?? Buffer.alloc(0);
    const jobId = url.pathname.split('/')[4];
    let fichier: string | null = null;
    if (etat.fichierRendu) {
      fs.mkdirSync(path.dirname(etat.fichierRendu), { recursive: true });
      fs.writeFileSync(etat.fichierRendu, corps);
      fichier = etat.fichierRendu;
    }
    etat.rendus.push({ jobId, octets: corps.length, type: req.headers()['content-type'] ?? '', fichier });
    return json({ ok: true });
  }],
  ['POST /api/render/jobs/*/confirm', () => json({ ok: true, etat: 'confirmed', debite: 10 })],
  ['POST /api/render/jobs/*/cancel', () => json({ ok: true })],
];

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

export function configAutopilotParDefaut(): Record<string, unknown> {
  return {
    enabled: false, mode: 'review', cadence: 'weekly', countPerCycle: 1, platforms: [], creditFloor: 50,
    rushUrls: [], topics: [], lastRunAt: null, lastRushUrl: null, runHour: 8, runTimezone: 'Europe/Paris',
    publishTime: '18:00', startDate: null, voiceEnabled: false, jumeauAvatar: false, jumeauAvatarId: null,
    cardGradientStart: '#7C3AED', cardGradientEnd: '#EC4899', titleColor: '#FFFFFF', cardsShowPoster: false,
    musicUrl: null, voiceId: null, keepRushAudio: false, musicVolume: 0.3, voiceVolume: 1, rushVolume: 0.5,
    designStyle: {}, posterUrls: [], posterMode: 'auto', brief: {},
  };
}

// ───────────────────────────────────────────────────── service des médias ──

/** Dépôts reçus pendant le test (PUT /banc-upload/<nom>), relus sous /banc-medias/upload-<nom>. */
const DEPOTS = new Map<string, { corps: Buffer; type: string }>();

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };

async function servirMedia(route: Route, url: URL): Promise<void> {
  const nom = decodeURIComponent(url.pathname.replace(/^\/banc-medias\//, ''));
  const depot = nom.startsWith('upload-') ? DEPOTS.get(nom.slice('upload-'.length)) : undefined;
  if (depot) {
    await route.fulfill({ status: 200, body: depot.corps, contentType: depot.type, headers: { 'Content-Length': String(depot.corps.length), 'Accept-Ranges': 'bytes' } });
    return;
  }
  const chemin = path.join(DOSSIER_MEDIAS, path.basename(nom));
  if (!fs.existsSync(chemin)) {
    // Un « média fournisseur » sans fichier local (page source, auteur…) : une image neutre.
    const repli = path.join(DOSSIER_MEDIAS, 'image-1.jpg');
    await route.fulfill({ status: 200, body: fs.readFileSync(repli), contentType: 'image/jpeg' });
    return;
  }
  const donnees = fs.readFileSync(chemin);
  const type = TYPES[path.extname(chemin)] ?? 'application/octet-stream';
  const range = route.request().headers()['range'];
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const debut = m[1] ? parseInt(m[1], 10) : 0;
    const fin = m[2] ? Math.min(parseInt(m[2], 10), donnees.length - 1) : donnees.length - 1;
    await route.fulfill({
      status: 206, body: donnees.subarray(debut, fin + 1), contentType: type,
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${debut}-${fin}/${donnees.length}`, 'Access-Control-Allow-Origin': '*' },
    });
    return;
  }
  await route.fulfill({ status: 200, body: donnees, contentType: type, headers: { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' } });
}

// ─────────────────────────────────────────────────────────────── fixture ──

export interface Banc {
  etat: EtatBanc;
  /** Toute requête hors localhost (coupée). */
  externes: string[];
  /** Sous-ensemble vers la prod ou un fournisseur — DOIT rester vide. */
  externesInterdits: string[];
  nonSimulees: string[];
  appels: Array<{ methode: string; chemin: string; status: number; quand: number }>;
  consoleErreurs: string[];
  requetesEchouees: string[];
  /** Pose un gestionnaire prioritaire (ex. progression qui évolue). */
  surcharger: (cle: string, g: Gestionnaire) => void;
  /** Laisse cette route atteindre le VRAI handler local (env neutralisé). */
  passerAuServeur: (cle: string) => void;
  /** Capture nommée `<scenario>-<projet>.png` dans resultats/captures/<phase>/. */
  capture: (page: Page, nom: string, opts?: { fullPage?: boolean; locator?: import('playwright/test').Locator }) => Promise<string>;
}

function correspond(cle: string, methode: string, chemin: string): boolean {
  const [m, motif] = cle.split(' ');
  if (m !== '*' && m !== methode) return false;
  if (motif.includes('*')) {
    const re = new RegExp('^' + motif.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
    if (re.test(chemin)) return true;
    return motif.endsWith('*') && chemin.startsWith(motif.slice(0, -1));
  }
  return chemin === motif;
}

async function installer(context: BrowserContext, banc: Banc, surcharges: Array<[string, Gestionnaire]>, serveur: string[]) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url: URL;
    try { url = new URL(req.url()); } catch { await route.continue(); return; }
    if (url.protocol === 'data:' || url.protocol === 'blob:') { await route.continue(); return; }
    if (url.hostname === HOTE_MEDIAS) { await servirMedia(route, url); return; }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!local) {
      banc.externes.push(`${req.method()} ${url.origin}${url.pathname}`);
      if (HOTES_INTERDITS.test(url.hostname)) banc.externesInterdits.push(`${req.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.startsWith('/banc-medias/')) { await servirMedia(route, url); return; }
    if (url.pathname.startsWith('/banc-upload/')) {
      DEPOTS.set(decodeURIComponent(url.pathname.slice('/banc-upload/'.length)), { corps: req.postDataBuffer() ?? Buffer.alloc(0), type: req.headers()['content-type'] ?? 'application/octet-stream' });
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }

    const methode = req.method();
    const chemin = url.pathname;
    if (serveur.some((c) => correspond(c, methode, chemin))) {
      banc.appels.push({ methode, chemin, status: -1, quand: Date.now() });
      await route.continue();
      return;
    }
    let corps: unknown = null;
    try { corps = req.postDataJSON(); } catch { corps = null; }
    const g = [...surcharges, ...ROUTES].find(([cle]) => correspond(cle, methode, chemin));
    if (!g) {
      banc.nonSimulees.push(`${methode} ${chemin}${url.search}`);
      banc.appels.push({ methode, chemin, status: 501, quand: Date.now() });
      await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ success: false, ok: false, error: `banc: route non simulée ${methode} ${chemin}` }) });
      return;
    }
    const r = await g[1]({ route, req, url, corps, etat: banc.etat });
    if (r === 'serveur') { banc.appels.push({ methode, chemin, status: -1, quand: Date.now() }); await route.continue(); return; }
    const status = r.status ?? 200;
    banc.appels.push({ methode, chemin, status, quand: Date.now() });
    if (r.json !== undefined) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(r.json), headers: r.headers });
    } else {
      await route.fulfill({ status, body: r.body ?? '', contentType: r.contentType ?? 'application/octet-stream', headers: r.headers });
    }
  });
}

export const test = base.extend<{ banc: Banc }>({
  banc: [async ({ context, page }, use, testInfo) => {
    const surcharges: Array<[string, Gestionnaire]> = [];
    const serveur: string[] = [];
    const banc: Banc = {
      etat: { posts: [], production: { progression: null, resultat: null, jumeau: null }, prononciations: [], rendus: [], fichierRendu: null, autopilotConfig: configAutopilotParDefaut() },
      externes: [], externesInterdits: [], nonSimulees: [], appels: [], consoleErreurs: [], requetesEchouees: [],
      surcharger: (cle, g) => { surcharges.unshift([cle, g]); },
      passerAuServeur: (cle) => { serveur.push(cle); },
      capture: async (p, nom, opts) => {
        fs.mkdirSync(DOSSIER_CAPTURES, { recursive: true });
        const fichier = path.join(DOSSIER_CAPTURES, `${nom}-${testInfo.project.name}.png`);
        if (opts?.locator) await opts.locator.screenshot({ path: fichier });
        else await p.screenshot({ path: fichier, fullPage: opts?.fullPage ?? false });
        await testInfo.attach(nom, { path: fichier, contentType: 'image/png' });
        return fichier;
      },
    };
    await installer(context, banc, surcharges, serveur);
    page.on('console', (m) => { if (m.type() === 'error') banc.consoleErreurs.push(m.text().slice(0, 500)); });
    page.on('pageerror', (e) => banc.consoleErreurs.push(`pageerror: ${e.message.slice(0, 500)}`));
    page.on('requestfailed', (r) => banc.requetesEchouees.push(`${r.method()} ${r.url().slice(0, 200)} — ${r.failure()?.errorText ?? ''}`));
    // Le choix de parcours et les bandeaux d'accueil ne doivent pas dépendre d'une session précédente.
    await page.addInitScript(() => { try { window.localStorage.setItem('studiio:banc', '1'); } catch { /* */ } });
    // Hasard REPRODUCTIBLE : mêmes textes générés à chaque passage (avant/après comparables).
    await page.addInitScript(() => {
      let a = 0x5eed1234;
      Math.random = () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });

    await use(banc);

    const journal = {
      phase: PHASE, test: testInfo.titlePath.join(' › '), projet: testInfo.project.name, statut: testInfo.status,
      externesInterdits: banc.externesInterdits, externes: banc.externes, nonSimulees: [...new Set(banc.nonSimulees)], consoleErreurs: banc.consoleErreurs,
      requetesEchouees: banc.requetesEchouees, rendus: banc.etat.rendus, posts: banc.etat.posts.map((p) => ({ id: p.id, title: p.title, status: p.status, format: p.format })),
      appels: banc.appels,
    };
    const f = testInfo.outputPath('journal.json');
    fs.writeFileSync(f, JSON.stringify(journal, null, 2));
    await testInfo.attach('journal', { path: f, contentType: 'application/json' });
    // Agrégat global des requêtes externes (vérifié dans le rapport final).
    fs.mkdirSync(DOSSIER_RESULTATS, { recursive: true });
    fs.appendFileSync(path.join(DOSSIER_RESULTATS, `externes-${PHASE}.log`), `${testInfo.project.name} | ${testInfo.title} | interdits=${banc.externesInterdits.length} | autres=${banc.externes.length - banc.externesInterdits.length}${banc.externes.length ? ' | ' + [...new Set(banc.externes)].join(' ; ') : ''}\n`);
    // Prod / fournisseurs : zéro tolérance. Les autres hôtes (Google Fonts…) sont coupés et seulement journalisés.
    expect.soft(banc.externesInterdits, 'aucune requête vers la prod ou un fournisseur').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** Pose le parcours (`studiio:creer:parcours`) avant le premier rendu. */
export async function choisirParcours(page: Page, parcours: 'assistant' | 'autopilote' | null): Promise<void> {
  await page.addInitScript((p) => {
    try {
      if (p) window.localStorage.setItem('studiio:creer:parcours', p);
      else window.localStorage.removeItem('studiio:creer:parcours');
    } catch { /* */ }
  }, parcours);
}
