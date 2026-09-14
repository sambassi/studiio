/**
 * A_8g — LA VOIX DU JUMEAU EST LA VOIX DE LA PERSONNE, RELUE EN BASE, OU RIEN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTÈGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `userVoiceId` désigne une ligne de `user_voices` — la table A_6 qui, seule,
 * dit à qui appartient une voix clonée. La configuration du jumeau ne fait
 * pas autorité : la ligne est relue sous le compte, son consentement aussi.
 * Et quand quelque chose manque, il n'y a PAS d'autre voix : un motif.
 *
 * ⚠️ AUCUN FOURNISSEUR N'EST APPROCHÉ. `user_voices` n'a pas d'état « en
 * cours » : une ligne n'y existe qu'après un clonage réussi. Les fixtures
 * ci-dessous sont des lignes, jamais des appels.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX = 'eeeeeeee-5555-4555-8555-555555555555';
const VOIX_AUTRUI = 'ffffffff-6666-4666-8666-666666666666';

let tables: Record<string, Ligne[]> = {};

function requete(table: string) {
  const eq: [string, unknown][] = [];
  let tri: { c: string; asc: boolean } | null = null;
  const filtrees = () => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    if (tri) out.sort((a, b) => String(a[tri!.c]).localeCompare(String(b[tri!.c])) * (tri!.asc ? 1 : -1));
    return out;
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: () => api,
    order: (c: string, o?: { ascending?: boolean }) => { tri = { c, asc: o?.ascending !== false }; return api; },
    limit: () => api,
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

import { voixJumeauUtilisable } from '@/lib/avatar/voix-jumeau';
import { resoudreVoixJumeau, preparerJumeauDuCompte } from '@/lib/avatar/jumeau-serveur';
import { resoudreJumeauPourGeneration, type ConfigJumeauNumerique } from '@/lib/avatar/jumeau';

const VOIX_PRETE = {
  id: VOIX, user_id: UID, provider: 'elevenlabs', provider_voice_id: 'el_moi', name: 'Ma voix',
  lang: 'fr-CH', consent_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T10:00:00Z',
};
const AVATAR_VALIDE = {
  id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_v1',
  validated_at: '2026-09-10T12:00:00Z', version: 1, deleted_at: null, subject_type: 'self',
};
const CONFIG: ConfigJumeauNumerique = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX };
const BIBLIO = {
  voixOff: { script: 'Profite de 25 % à partir de 18h30, seulement 25 CHF chez Afroboost.' },
  prononciations: [{ display: 'Afroboost', spoken: 'Afro boost' }],
};

beforeEach(() => {
  tables = {
    user_voices: [VOIX_PRETE, { ...VOIX_PRETE, id: VOIX_AUTRUI, user_id: AUTRUI, provider_voice_id: 'el_autrui', name: 'X' }],
    user_avatars: [AVATAR_VALIDE],
  };
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La décision pure', () => {
  const decider = (voix: Ligne | null, userVoiceId: string | null = VOIX) =>
    voixJumeauUtilisable({ userId: UID, userVoiceId, voix });

  it('1.1 une voix du compte, avec fournisseur et consentement, est utilisable', () => {
    expect(decider(VOIX_PRETE)).toEqual({
      ok: true,
      voix: { userVoiceId: VOIX, providerVoiceId: 'el_moi', provider: 'elevenlabs', nom: 'Ma voix', langue: 'fr-CH' },
    });
  });

  it('1.2 ⚠️ LA VOIX D’AUTRUI EST REFUSÉE — même connue par son identifiant', () => {
    expect(decider({ ...VOIX_PRETE, user_id: AUTRUI })).toEqual({ ok: false, motif: 'voix_etrangere' });
  });

  it('1.3 ⚠️ SANS CONSENTEMENT, PAS DE VOIX', () => {
    expect(decider({ ...VOIX_PRETE, consent_at: null })).toEqual({ ok: false, motif: 'voix_absente' });
    expect(decider({ ...VOIX_PRETE, consent_at: '' })).toEqual({ ok: false, motif: 'voix_absente' });
  });

  it('1.4 sans identifiant fournisseur, la voix n’est pas prête', () => {
    expect(decider({ ...VOIX_PRETE, provider_voice_id: null })).toEqual({ ok: false, motif: 'voix_absente' });
  });

  it('1.5 ⚠️ AUCUN userVoiceId : AUCUNE VOIX — pas la première trouvée', () => {
    expect(decider(VOIX_PRETE, null)).toEqual({ ok: false, motif: 'voix_absente' });
  });

  it('1.6 une ligne qui n’est pas celle demandée ne compte pas', () => {
    expect(decider({ ...VOIX_PRETE, id: VOIX_AUTRUI })).toEqual({ ok: false, motif: 'voix_absente' });
  });

  it('1.7 la langue déclarée passe au vocabulaire A_8d ; inconnue → fr-FR', () => {
    const r = decider({ ...VOIX_PRETE, lang: 'FR' });
    expect(r.ok && r.voix.langue).toBe('fr-FR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La résolution serveur', () => {
  it('2.1 relit la ligne sous le compte et rend la voix complète', async () => {
    const r = await resoudreVoixJumeau(UID, VOIX);
    expect(r.ok && r.voix.nom).toBe('Ma voix');
  });

  it('2.2 ⚠️ CROSS-USER : l’identifiant de la voix d’autrui ne résout pas', async () => {
    expect(await resoudreVoixJumeau(UID, VOIX_AUTRUI)).toEqual({ ok: false, motif: 'voix_absente' });
  });

  it('2.3 sans identifiant : voix_absente, aucune lecture', async () => {
    expect(await resoudreVoixJumeau(UID, null)).toEqual({ ok: false, motif: 'voix_absente' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le portail Autopilote délègue à la même décision', () => {
  const portail = (voix: Ligne | null, config = CONFIG) =>
    resoudreJumeauPourGeneration({ config, userId: UID, avatar: AVATAR_VALIDE, voix });

  it('3.1 voix du compte : prêt, identité avec la référence Studiio', () => {
    expect(portail(VOIX_PRETE)).toEqual({ etat: 'pret', identite: { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX } });
  });

  it('3.2 voix d’autrui : bloqué voix_etrangere', () => {
    expect(portail({ ...VOIX_PRETE, user_id: AUTRUI })).toEqual({ etat: 'bloque', motif: 'voix_etrangere' });
  });

  it('3.3 sans consentement : bloqué', () => {
    expect(portail({ ...VOIX_PRETE, consent_at: null })).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La préparation complète du jumeau (ce que la chaîne Autopilote appelle)', () => {
  it('4.1 ⚠️ CLONE VALIDÉ + VOIX DU COMPTE + TEXTE : PRÊT, AVEC LE TEXTE PARLÉ', async () => {
    const r = await preparerJumeauDuCompte(UID, CONFIG, BIBLIO);
    expect(r.etat).toBe('pret');
    if (r.etat !== 'pret') return;
    expect(r.identite).toEqual({ avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX });
    expect(r.parole.voix.providerVoiceId).toBe('el_moi');
    expect(r.parole.displayScript).toBe(BIBLIO.voixOff.script);
    expect(r.parole.spokenScript).toBe(
      'Profite de vingt-cinq pour cent à partir de dix-huit heures trente, seulement vingt-cinq francs suisses chez Afro boost.',
    );
  });

  it('4.2 ⚠️ SOURCE PRÊTE : bloqué avant même la voix', async () => {
    tables.user_avatars = [{ ...AVATAR_VALIDE, status: 'source_ready', provider_avatar_id: null, validated_at: null }];
    expect(await preparerJumeauDuCompte(UID, CONFIG, BIBLIO)).toEqual({ etat: 'bloque', motif: 'avatar_non_entraine' });
  });

  it('4.3 ⚠️ ENTRAÎNÉ MAIS NON VALIDÉ : bloqué, même avec une voix prête', async () => {
    tables.user_avatars = [{ ...AVATAR_VALIDE, validated_at: null }];
    expect(await preparerJumeauDuCompte(UID, CONFIG, BIBLIO)).toEqual({ etat: 'bloque', motif: 'clone_non_valide' });
  });

  it('4.4 ⚠️ VALIDÉ SANS VOIX : motif nommé, jamais une autre voix', async () => {
    tables.user_voices = [];
    expect(await preparerJumeauDuCompte(UID, CONFIG, BIBLIO)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
    expect(await preparerJumeauDuCompte(UID, { ...CONFIG, userVoiceId: null }, BIBLIO)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('4.5 ⚠️ VOIX D’AUTRUI DANS LA CONFIGURATION : bloqué', async () => {
    expect(await preparerJumeauDuCompte(UID, { ...CONFIG, userVoiceId: VOIX_AUTRUI }, BIBLIO)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('4.6 voix sans consentement : bloqué', async () => {
    tables.user_voices = [{ ...VOIX_PRETE, consent_at: null }];
    expect(await preparerJumeauDuCompte(UID, CONFIG, BIBLIO)).toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('4.7 ⚠️ SANS TEXTE ÉCRIT PAR LA PERSONNE : script_absent, rien n’est composé à sa place', async () => {
    expect(await preparerJumeauDuCompte(UID, CONFIG, { voixOff: null, prononciations: [] })).toEqual({ etat: 'bloque', motif: 'script_absent' });
  });

  it('4.8 éteint : désactivé, aucune lecture de voix', async () => {
    expect(await preparerJumeauDuCompte(UID, { ...CONFIG, active: false }, BIBLIO)).toEqual({ etat: 'desactive' });
  });
});
