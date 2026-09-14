/**
 * A_8h — « UTILISER MON CLONE » DANS « CRÉER » : LES MÊMES GARDES QU'AUTOPILOTE, SUR LE VRAI CODE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTÈGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le parcours manuel ne décide rien : il demande au serveur, qui relit
 * l'avatar VIVANT du compte (version d'aujourd'hui), sa validation, et la
 * voix choisie dans « Ma voix », puis passe le tout par `preparerJumeauDuCompte`
 * — la fonction d'Autopilote. Le navigateur n'envoie ni avatar ni voix :
 * ce qu'il glisserait dans la requête n'est jamais lu.
 *
 * Aucun fournisseur n'est approché : tables en mémoire, pipeline parlé pur.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const AVATAR_AUTRUI = 'dddddddd-4444-4444-8444-444444444444';
const VOIX_COACH = 'eeeeeeee-5555-4555-8555-555555555555';
const VOIX_STUDIO = 'ffffffff-6666-4666-8666-666666666666';
const VOIX_AUTRUI = '99999999-9999-4999-8999-999999999999';

let tables: Record<string, Ligne[]> = {};
let voixDuCompte: Ligne[] = [];

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const estNul: string[] = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;
  const filtrees = () => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    if (tri) out.sort((a, b) => String(a[tri!.c]).localeCompare(String(b[tri!.c])) * (tri!.asc ? 1 : -1));
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    order: (c: string, o?: { ascending?: boolean }) => { tri = { c, asc: o?.ascending !== false }; return api; },
    limit: (n: number) => { limite = n; return api; },
    maybeSingle: async () => ({ data: filtrees()[0] ?? null, error: null }),
    single: async () => ({ data: filtrees()[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r({ data: filtrees(), error: null }),
  };
  return api;
}
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));
let utilisateurConnecte: string | null = UID;
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async (userId: string) => voixDuCompte.filter((v) => v.user_id === userId),
}));

import { etatJumeauPourCreer, preparerJumeauPourCreer } from '@/lib/avatar/jumeau-serveur';
import { GET, POST } from '@/app/api/creer/jumeau/route';

const AVATAR_VALIDE: Ligne = {
  id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_v1',
  validated_at: '2026-09-10T12:00:00Z', version: 1, deleted_at: null, subject_type: 'self',
  created_at: '2026-09-09T10:00:00Z',
};
const voix = (id: string, name: string, user_id = UID): Ligne => ({
  id, user_id, provider: 'elevenlabs', provider_voice_id: `el_${name}`, name, lang: 'fr-CH',
  consent_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T10:00:00Z',
});

function socle(avatar: Partial<Ligne> | null = {}, jumeau: Ligne = { userVoiceId: VOIX_COACH }) {
  tables = {
    user_avatars: [
      ...(avatar === null ? [] : [{ ...AVATAR_VALIDE, ...avatar }]),
      { ...AVATAR_VALIDE, id: AVATAR_AUTRUI, user_id: AUTRUI },
    ],
    autopilot_config: [{
      user_id: UID,
      design_style: {
        jumeauNumerique: { active: false, avatarId: null, avatarVersion: null, ...jumeau },
        bibliothequeCreative: { prononciations: [{ display: 'Afroboost', spoken: 'Afro boost' }] },
      },
    }],
  };
  voixDuCompte = [voix(VOIX_STUDIO, 'Bassi studio'), voix(VOIX_COACH, 'Bassi coach'), voix(VOIX_AUTRUI, 'X', AUTRUI)];
}

beforeEach(() => { utilisateurConnecte = UID; socle(); });

const DISPLAY = 'Afroboost : 25 CHF à 18h30, -25 %.';
const poster = (corps: Record<string, unknown>) => POST({ json: async () => corps } as never);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. L’état du clone pour « Créer », par le portail', () => {
  it('1.1 ⚠️ AUCUN AVATAR : bloqué, avatar_absent', async () => {
    socle(null);
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'avatar_absent' });
  });

  it('1.2 ⚠️ SOURCE PRÊTE : bloqué avant la voix, aucun fournisseur', async () => {
    socle({ status: 'source_ready', provider_avatar_id: null, validated_at: null });
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'avatar_non_entraine' });
  });

  it('1.3 ⚠️ ENTRAÎNÉ, NON VALIDÉ : bloqué, même avec la voix prête', async () => {
    socle({ validated_at: null });
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'clone_non_valide' });
  });

  it('1.4 ⚠️ VALIDÉ SANS VOIX CHOISIE : bloqué voix_absente — jamais la première voix du compte', async () => {
    socle({}, { userVoiceId: null });
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('1.5 voix choisie mais disparue : bloqué', async () => {
    voixDuCompte = [voix(VOIX_STUDIO, 'Bassi studio')];
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('1.6 ⚠️ VALIDÉ + VOIX CHOISIE : prêt, et c’est « Bassi coach » — pas « Bassi studio »', async () => {
    expect(await etatJumeauPourCreer(UID)).toEqual({
      etat: 'pret',
      identite: { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX_COACH },
      voix: { userVoiceId: VOIX_COACH, nom: 'Bassi coach' },
    });
  });

  it('1.7 ⚠️ VERSION : le clone passé en v2 non validée n’est plus prêt, même si un brouillon l’était hier', async () => {
    socle({ version: 2, validated_at: null, provider_avatar_id: null, status: 'source_ready' });
    expect((await etatJumeauPourCreer(UID)).etat).toBe('bloque');
    // et la v2 validée avec sa propre voix : prêt sur la v2
    socle({ version: 2, provider_avatar_id: 'hg_v2' });
    const r = await etatJumeauPourCreer(UID);
    expect(r.etat === 'pret' && r.identite.avatarVersion).toBe(2);
  });

  it('1.8 un avatar supprimé ne compte pas', async () => {
    socle({ deleted_at: '2026-09-11T00:00:00Z' });
    expect(await etatJumeauPourCreer(UID)).toEqual({ etat: 'bloque', motif: 'avatar_absent' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le contrat : identité + texte parlé', () => {
  it('2.1 ⚠️ AFROBOOST / CHF / 18h30 / -25 % — sur le chemin manuel réel', async () => {
    const r = await preparerJumeauPourCreer(UID, DISPLAY);
    expect(r.etat).toBe('pret');
    if (r.etat !== 'pret') return;
    expect(r.identite).toEqual({ avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX_COACH });
    expect(r.parole.displayScript).toBe(DISPLAY);
    expect(r.parole.spokenScript).toBe(
      'Afro boost : vingt-cinq francs suisses à dix-huit heures trente, moins vingt-cinq pour cent.',
    );
    expect(r.parole.voix.nom).toBe('Bassi coach');
  });

  it('2.2 ⚠️ LE TEXTE AFFICHÉ RESSORT INTACT', async () => {
    const r = await preparerJumeauPourCreer(UID, DISPLAY);
    if (r.etat !== 'pret') throw new Error('attendu pret');
    expect(r.parole.displayScript).toContain('25 CHF');
    expect(r.parole.displayScript).toContain('18h30');
    expect(r.parole.displayScript).toContain('-25 %');
    expect(r.parole.displayScript).toContain('Afroboost');
  });

  it('2.3 sans texte : script_absent, rien n’est composé à la place', async () => {
    expect(await preparerJumeauPourCreer(UID, '')).toEqual({ etat: 'bloque', motif: 'script_absent' });
    expect(await preparerJumeauPourCreer(UID, undefined)).toEqual({ etat: 'bloque', motif: 'script_absent' });
  });

  it('2.4 les gardes précèdent le texte', async () => {
    socle({ validated_at: null });
    expect(await preparerJumeauPourCreer(UID, DISPLAY)).toEqual({ etat: 'bloque', motif: 'clone_non_valide' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La route /api/creer/jumeau', () => {
  it('3.1 GET prêt : identité, voix par sa référence Studiio et son nom, moteur indisponible', async () => {
    const j = await (await GET()).json();
    expect(j).toEqual({
      ok: true, etat: 'pret',
      identite: { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX_COACH },
      voix: { userVoiceId: VOIX_COACH, nom: 'Bassi coach' },
      moteur: 'indisponible',
    });
    expect(JSON.stringify(j)).not.toMatch(/hg_v1|el_/);
  });

  it('3.2 GET bloqué : motif et message lisibles', async () => {
    socle({ validated_at: null });
    const j = await (await GET()).json();
    expect(j.etat).toBe('bloque');
    expect(j.motif).toBe('clone_non_valide');
    expect(j.message).toContain('Validez d’abord votre clone');
  });

  it('3.3 ⚠️ POST : LE CONTRAT REVIENT NOMMÉ « jumeau_indisponible » — aucune vidéo ordinaire', async () => {
    const res = await poster({ displayScript: DISPLAY });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.moteur).toBe('indisponible');
    expect(j.motif).toBe('jumeau_indisponible');
    expect(j.parole.spokenScript).toContain('moins vingt-cinq pour cent');
    expect(j.parole.voix).toEqual({ userVoiceId: VOIX_COACH, nom: 'Bassi coach' });
    expect(JSON.stringify(j)).not.toMatch(/hg_v1|el_/);
  });

  it('3.4 ⚠️ TAMPERING : un avatarId / userVoiceId d’autrui dans le corps n’est jamais lu', async () => {
    socle({ validated_at: null });          // mon clone n'est pas validé
    const res = await poster({ displayScript: DISPLAY, avatarId: AVATAR_AUTRUI, userVoiceId: VOIX_AUTRUI });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('clone_non_valide');   // c'est MON clone qui est jugé
  });

  it('3.5 ⚠️ CROSS-USER : le compte sans clone ne peut pas emprunter celui d’autrui', async () => {
    socle(null);
    const res = await poster({ displayScript: DISPLAY, avatarId: AVATAR_AUTRUI, userVoiceId: VOIX_AUTRUI });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('avatar_absent');
  });

  it('3.6 POST sans texte : 409 script_absent', async () => {
    const res = await poster({ displayScript: '' });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('script_absent');
  });

  it('3.7 sans session : 401', async () => {
    utilisateurConnecte = null;
    expect((await GET()).status).toBe(401);
    expect((await poster({ displayScript: DISPLAY })).status).toBe(401);
  });
});
