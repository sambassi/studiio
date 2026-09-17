/**
 * MON JUMEAU DANS L'AUTOPILOTE — la voix posée est celle que le moteur sait dire.
 *
 * ⚠️ LE DÉFAUT : `JumeauAutopilote` enregistrait `jumeau.voix.id` — l'UUID
 * interne de `user_voices` — dans `autopilot_config.voiceId`, alors que le
 * moteur (`elevenLabsVoiceId`) attend `elevenlabs-<provider_voice_id>`, la
 * forme des voix de GET /api/voice/clone. Et `AutopilotPanel` calculait
 * `actif = voixClonees.some(v => v.id === config.voiceId)` : l'UUID n'y est
 * jamais, l'interrupteur retombait à OFF juste après avoir été enregistré.
 *
 * Ce que ces tests exigent, de bout en bout :
 *   - le navigateur retrouve la voix du compte par `accountVoiceId` (l'UUID
 *     que le contrat Jumeau désigne), JAMAIS par son nom, et pose
 *     `voiceId = elevenlabs-…` ;
 *   - l'interrupteur reste ON après l'enregistrement et après un rechargement,
 *     y compris pour une configuration héritée qui porte encore l'UUID ;
 *   - le serveur résout `voiceId` POUR CE COMPTE avant tout appel payant :
 *     une voix d'autrui ou inconnue → aucun appel ElevenLabs ;
 *   - rien de nouveau ne fuit : pas de `provider_voice_id` côté navigateur,
 *     et le moteur vidéo du jumeau reste hors de l'Autopilote.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { PreparedPost } from '@/lib/autopilot/engine';

// ── Doublures partagées ─────────────────────────────────────────────────────

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

/** Le compte, un autre compte, l'avatar validé, et les voix. */
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = '11111111-1111-4111-8111-000000000001';
/** `user_voices.id` de MA voix — ce que `JumeauPublic.voix.id` désigne. */
const VOIX_U = '44444444-4444-4444-8444-000000000001';
/** `user_voices.id` d'une voix d'AUTRUI. */
const VOIX_AUTRUI = '44444444-4444-4444-8444-000000000002';
/**
 * `provider_voice_id` nu de ma voix. ⚠️ Pas « abc » tout court : la forme
 * d'un identifiant ElevenLabs est contrôlée (`PROVIDER_VOICE_ID`, 8 à 64
 * caractères) et une voix « abc » serait `inutilisable` avant même d'être
 * cherchée.
 */
const ABC = 'abc12345678';
const ZZZ = 'zzz98765432';
const ELEVEN_ABC = `elevenlabs-${ABC}`;
const ELEVEN_ZZZ = `elevenlabs-${ZZZ}`;

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ avatars: [] as Ligne[], voices: [] as Ligne[], settings: [] as Ligne[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_avatars' ? base.avatars : table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    let tri = false;
    let limite: number | undefined;
    const exec = () => {
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (tri) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (limite !== undefined) rows = rows.slice(0, limite);
      const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return exec(); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

// Le téléversement et la mesure de durée : hors sujet ici, et sans réseau.
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorage: async (args: { storagePath: string }) => `https://stockage.test/${args.storagePath}`,
}));
vi.mock('@remotion/media-parser', () => ({
  parseMedia: async () => ({ durationInSeconds: 3 }),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));

import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { buildAutopilotVoices } from '@/lib/autopilot/voice';
import { resoudreVoixParIdentifiant } from '@/lib/voice/profil';
import { moteurJumeauDisponible } from '@/lib/avatar/jumeau';
const { GET } = await import('@/app/api/creer/jumeau/route');

const avatar = (over: Ligne = {}): Ligne => ({
  id: AVATAR, user_id: USER, status: 'completed', provider_avatar_id: 'hg-1', provider_asset_id: 'as-1',
  source_object_key: `${USER}/avatar/source-1-${'a'.repeat(32)}.mp4`, source_url: null, subject_type: 'self', consent_version: 'x',
  consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-03T00:00:00Z', version: 2, deleted_at: null,
  created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'video', name: 'Bassi', training_error: null, ...over,
});
const voix = (id: string, userId: string, providerVoiceId: string, name = 'Ma voix'): Ligne => ({
  id, user_id: userId, provider: 'elevenlabs', provider_voice_id: providerVoiceId, name, lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});

// ── Le réseau, tout entier ──────────────────────────────────────────────────

/** Ce que l'écran a envoyé en PUT à /api/autopilot/config, dans l'ordre. */
let envois: AutopilotConfig[] = [];
let configServeur: AutopilotConfig = DEFAULT_CONFIG;
/** La réponse de GET /api/creer/jumeau (le contrat public, sans identifiant fournisseur). */
let jumeauServeur: unknown = null;
/** La réponse de GET /api/voice/clone. */
let voixDuCompte: Array<{ id: string; accountVoiceId: string; name: string; lang: string | null }> = [];
/** Les URL appelées chez ElevenLabs. */
let appelsElevenLabs: string[] = [];

const jumeauPret = (voixId: string) => ({
  pret: true, motif: null, message: null, moteurDisponible: false,
  messageMoteur: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.',
  jumeau: { avatar: { id: AVATAR, version: 2, nom: 'Bassi', valideLe: '2026-09-03T00:00:00Z' }, voix: { id: voixId, nom: 'Ma voix' }, prononciations: 0 },
});

beforeEach(() => {
  envois = [];
  configServeur = DEFAULT_CONFIG;
  appelsElevenLabs = [];
  jumeauServeur = jumeauPret(VOIX_U);
  // Deux voix du MÊME nom : la seule façon de retrouver la bonne est
  // `accountVoiceId`, jamais le nom.
  voixDuCompte = [
    { id: ELEVEN_ABC, accountVoiceId: VOIX_U, name: 'Ma voix', lang: 'fr' },
    { id: ELEVEN_ZZZ, accountVoiceId: 'autre', name: 'Ma voix', lang: 'fr' },
  ];
  base.avatars = [avatar()];
  base.voices = [voix(VOIX_U, USER, ABC), voix(VOIX_AUTRUI, AUTRUI, ZZZ)];
  base.settings = [];
  session.courante = { user: { id: USER } };
  window.localStorage.clear();

  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://api.elevenlabs.io/')) {
      appelsElevenLabs.push(u);
      return {
        ok: true, status: 200,
        arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]).buffer,
        text: async () => '',
      };
    }
    if (u.startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, configured: true, voices: voixDuCompte }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(recu);
        configServeur = recu;
        return { ok: true, json: async () => ({ success: true, brandingReady: true, config: recu }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, config: configServeur }) };
    }
    if (u.startsWith('/api/creer/jumeau')) {
      return { ok: true, json: async () => ({ success: jumeauServeur !== null, data: jumeauServeur }) };
    }
    if (u.startsWith('http')) throw new Error(`appel réseau interdit : ${u}`);
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Monte l'Autopilote et ouvre l'étape « Style » (la 3ᵉ), où vit Mon jumeau. */
async function ouvrirMonJumeau() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(document.querySelector('[data-autopilot-etape="2"]')).not.toBeNull());
  await waitFor(() => expect((document.querySelector('[data-autopilot-etape="2"]') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(document.querySelector('[data-autopilot-etape="2"]')!);
  await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote]')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="chargement"]')).toBeNull());
  return document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement;
}

const interrupteur = () => document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement;

// ── Le navigateur : la voix posée, l'interrupteur qui tient ────────────────

describe('Mon jumeau dans l’Autopilote — la voix posée est celle du moteur', () => {
  it('⚠️ 1. l’activation retrouve la voix du compte par accountVoiceId (jamais par le nom) et enregistre voiceId = elevenlabs-…', async () => {
    const sw = await ouvrirMonJumeau();
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    await waitFor(() => expect(interrupteur().disabled).toBe(false));
    expect(sw.checked).toBe(false);
    await act(async () => { fireEvent.click(interrupteur()); });
    await waitFor(() => expect(envois.length).toBeGreaterThan(0));
    const dernier = envois[envois.length - 1];
    expect(dernier.voiceEnabled).toBe(true);
    expect(dernier.voiceId).toBe(ELEVEN_ABC);
    // Ni l'UUID interne (ce que le moteur ne sait pas dire), ni l'homonyme.
    expect(dernier.voiceId).not.toBe(VOIX_U);
    expect(dernier.voiceId).not.toBe(ELEVEN_ZZZ);
    expect(configServeur.voiceId).toBe(ELEVEN_ABC);
  });

  it('⚠️ 2. après l’enregistrement, l’interrupteur reste ON (il ne retombe plus)', async () => {
    await ouvrirMonJumeau();
    await waitFor(() => expect(interrupteur().disabled).toBe(false));
    await act(async () => { fireEvent.click(interrupteur()); });
    await waitFor(() => expect(configServeur.voiceEnabled).toBe(true));
    // La configuration relue par le panneau (réponse du PUT) redonne `actif`.
    await waitFor(() => expect(interrupteur().checked).toBe(true));
    expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull();
    // Et le sélecteur « Voix off clonée » montre la même voix : une seule vérité.
    const select = document.querySelector('[data-autopilot-voice-id]') as HTMLSelectElement | null;
    if (select) expect(select.value).toBe(ELEVEN_ABC);
  });

  it('⚠️ 3. après un rechargement (configuration serveur voiceId = elevenlabs-…), l’interrupteur est ON', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, voiceEnabled: true, voiceId: ELEVEN_ABC });
    await ouvrirMonJumeau();
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    await waitFor(() => expect(interrupteur().checked).toBe(true));
    expect(interrupteur().disabled).toBe(false);
    // Rien n'a été réécrit : c'est une LECTURE, pas une réparation silencieuse.
    expect(envois).toEqual([]);
  });

  it('⚠️ 4a. configuration héritée (voiceId = UUID interne du compte) : l’interrupteur est reconnu ON', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, voiceEnabled: true, voiceId: VOIX_U });
    await ouvrirMonJumeau();
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    await waitFor(() => expect(interrupteur().checked).toBe(true));
    expect(interrupteur().disabled).toBe(false);
  });

  it('⚠️ 12. sans correspondance de compte : aucun PUT, interrupteur inactif, message clair, lien « Gérer mon avatar »', async () => {
    // Le jumeau désigne une voix que /api/voice/clone ne connaît pas.
    jumeauServeur = jumeauPret('44444444-4444-4444-8444-00000000dead');
    await ouvrirMonJumeau();
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="chargement"]')).toBeNull());
    const sw = interrupteur();
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(true);
    // ⚠️ Pas de clic sur un contrôle désactivé : dans un vrai navigateur il ne
    // se passe rien, alors que jsdom + React déclenchent quand même `onChange`.
    // Si une implémentation le laissait actif, le clic ne doit rien enregistrer.
    if (!sw.disabled) await act(async () => { fireEvent.click(sw); });
    await new Promise((r) => setTimeout(r, 30));
    expect(envois).toEqual([]);
    expect(configServeur.voiceEnabled).toBe(false);
    expect(interrupteur().checked).toBe(false);
    // Le message : un état dédié, non vide — pas un faux « prêt ».
    expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).toBeNull();
    const message = document.querySelector('[data-jumeau-autopilote-etat="voix_non_reliee"]');
    expect(message).not.toBeNull();
    expect((message?.textContent || '').trim().length).toBeGreaterThan(10);
    expect((document.querySelector('[data-jumeau-autopilote-lien]') as HTMLAnchorElement).getAttribute('href')).toBe('/dashboard/avatar');
    expect(screen.getByText('Gérer mon avatar')).toBeTruthy();
  });
});

// ── Le serveur : la voix résolue POUR CE COMPTE avant tout appel payant ────

const POST_TITRE_SEUL: PreparedPost = {
  title: 'Sommeil réparateur',
  caption: '',
  scheduledDate: '2026-09-18',
  scheduledTime: '18:00',
  platforms: [],
  rushUrl: null,
  // Une seule séquence narrée (le titre) : exactement UN appel ElevenLabs
  // attendu quand la voix est correcte.
  content: { subtitle: '', tagLine: '', cards: [] } as unknown as PreparedPost['content'],
};

describe('Le serveur résout la voix pour ce compte avant de parler à ElevenLabs', () => {
  beforeEach(() => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'cle-de-test');
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'voixServeurDefaut');
  });

  it('⚠️ 4b. resoudreVoixParIdentifiant(userId, UUID interne du compte) → provider_voice_id de MA voix', async () => {
    const r = await resoudreVoixParIdentifiant(USER, VOIX_U);
    expect(r).toEqual({ providerVoiceId: ABC, userVoiceId: VOIX_U });
    // Et la forme préfixée, celle que le navigateur pose désormais.
    expect(await resoudreVoixParIdentifiant(USER, ELEVEN_ABC)).toEqual({ providerVoiceId: ABC, userVoiceId: VOIX_U });
  });

  it('⚠️ 5. UUID d’un autre utilisateur → résolution nulle → AUCUN appel ElevenLabs', async () => {
    expect(await resoudreVoixParIdentifiant(USER, VOIX_AUTRUI)).toBeNull();
    const out = await buildAutopilotVoices({ userId: USER, jobId: 'job-5', post: POST_TITRE_SEUL, voiceId: VOIX_AUTRUI });
    expect(out).toEqual({});
    expect(appelsElevenLabs).toEqual([]);
  });

  it('⚠️ 6. elevenlabs-<id> d’un autre utilisateur, ou inconnu → nul → AUCUN appel', async () => {
    expect(await resoudreVoixParIdentifiant(USER, ELEVEN_ZZZ)).toBeNull();
    expect(await resoudreVoixParIdentifiant(USER, 'elevenlabs-inconnu0000')).toBeNull();
    const out = await buildAutopilotVoices({ userId: USER, jobId: 'job-6', post: POST_TITRE_SEUL, voiceId: ELEVEN_ZZZ });
    expect(out).toEqual({});
    const inconnu = await buildAutopilotVoices({ userId: USER, jobId: 'job-6b', post: POST_TITRE_SEUL, voiceId: 'elevenlabs-inconnu0000' });
    expect(inconnu).toEqual({});
    expect(appelsElevenLabs).toEqual([]);
  });

  it('⚠️ 7. voix correcte → ElevenLabs reçoit /v1/text-to-speech/<id nu>, une fois', async () => {
    const out = await buildAutopilotVoices({ userId: USER, jobId: 'job-7', post: POST_TITRE_SEUL, voiceId: ELEVEN_ABC });
    expect(appelsElevenLabs).toHaveLength(1);
    expect(appelsElevenLabs[0]).toMatch(new RegExp(`^https://api\\.elevenlabs\\.io/v1/text-to-speech/${ABC}\\?`));
    // Jamais le préfixe dans l'URL : c'est un 404 chez le fournisseur.
    expect(appelsElevenLabs[0]).not.toContain('elevenlabs-');
    expect(out.titre?.url).toContain(`${USER}/autopilote-job-7-titre.mp3`);
    expect(out.titre?.seconds).toBe(3);

    // La configuration héritée (UUID) parle avec la MÊME voix.
    appelsElevenLabs = [];
    await buildAutopilotVoices({ userId: USER, jobId: 'job-7b', post: POST_TITRE_SEUL, voiceId: VOIX_U });
    expect(appelsElevenLabs).toHaveLength(1);
    expect(appelsElevenLabs[0]).toContain(`/v1/text-to-speech/${ABC}?`);
  });

  it('⚠️ 10. voiceId = null → repli inchangé : la voix du serveur (ELEVENLABS_VOICE_ID), jamais une voix personnelle', async () => {
    // Le repli actuel : sans `voiceId`, `elevenLabsVoiceId(null)` rend la voix
    // du serveur (`ELEVENLABS_VOICE_ID`, sinon le catalogue) et la narration
    // est produite avec elle. Aucune résolution de compte, aucune voix
    // clonée — ni la mienne ni celle d'un autre.
    const out = await buildAutopilotVoices({ userId: USER, jobId: 'job-10', post: POST_TITRE_SEUL, voiceId: null });
    expect(appelsElevenLabs).toHaveLength(1);
    expect(appelsElevenLabs[0]).toContain('/v1/text-to-speech/voixServeurDefaut?');
    expect(appelsElevenLabs[0]).not.toContain(ABC);
    expect(appelsElevenLabs[0]).not.toContain(ZZZ);
    expect(out.titre?.url).toContain('autopilote-job-10-titre.mp3');

    appelsElevenLabs = [];
    await buildAutopilotVoices({ userId: USER, jobId: 'job-10b', post: POST_TITRE_SEUL });
    expect(appelsElevenLabs).toHaveLength(1);
    expect(appelsElevenLabs[0]).toContain('/v1/text-to-speech/voixServeurDefaut?');
  });
});

// ── Rien de nouveau ne fuit, rien de nouveau n'est branché ─────────────────

describe('Aucun identifiant fournisseur ne sort ; le moteur vidéo reste hors de l’Autopilote', () => {
  it('⚠️ 8. GET /api/creer/jumeau : voix.id = UUID du compte, et AUCUN provider_voice_id / providerVoiceId', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { pret: boolean; jumeau: { voix: { id: string; nom: string } } } };
    expect(json.success).toBe(true);
    expect(json.data.pret).toBe(true);
    expect(json.data.jumeau.voix).toEqual({ id: VOIX_U, nom: 'Ma voix' });
    const brut = JSON.stringify(json);
    expect(brut).not.toMatch(/provider_voice_id|providerVoiceId|provider/i);
    expect(brut).not.toContain(ABC);
    expect(brut).not.toContain('hg-1');
  });

  it('⚠️ 9. JumeauPublic (source) ne porte pas providerVoiceId', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/avatar/jumeau.ts'), 'utf8');
    const debut = src.indexOf('export interface JumeauPublic');
    expect(debut).toBeGreaterThan(-1);
    // Le bloc entier : la fermeture de l'interface est la première `}` en début de ligne.
    const bloc = src.slice(debut, src.indexOf('\n}', debut) + 2);
    expect(bloc).not.toContain('providerVoiceId');
    expect(bloc).not.toContain('provider');
    expect(bloc).toContain('voix: { id: string; nom: string }');
    // Le privé existe, séparément, et c'est LUI qui porte l'identifiant.
    expect(src).toMatch(/export interface JumeauPrive \{[^}]*providerVoiceId: string/);
  });

  it('⚠️ 11. JUMEAU_MOTEUR_ACTIVE absent → moteur indisponible ; l’Autopilote et son cron ne touchent pas au moteur jumeau', () => {
    const sansDrapeau = { HEYGEN_API_KEY: 'h', ELEVENLABS_API_KEY: 'e' } as unknown as NodeJS.ProcessEnv;
    expect(moteurJumeauDisponible(sansDrapeau)).toBe(false);
    const sauvegarde = process.env.JUMEAU_MOTEUR_ACTIVE;
    delete process.env.JUMEAU_MOTEUR_ACTIVE;
    try {
      expect(moteurJumeauDisponible()).toBe(false);
    } finally {
      if (sauvegarde !== undefined) process.env.JUMEAU_MOTEUR_ACTIVE = sauvegarde;
    }

    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(nom)) fichiers.push(chemin);
      }
    };
    parcourir(resolve(process.cwd(), 'src/lib/autopilot'));
    parcourir(resolve(process.cwd(), 'src/app/api/cron/autopilot'));
    expect(fichiers.length).toBeGreaterThan(5);
    for (const f of fichiers) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('moteur-jumeau');
      expect(src, f).not.toContain('genererEtAttendreVideoJumeau');
    }
  });
});
