/**
 * CONTRAT — FOURNISSEUR D'AVATAR (Mon jumeau, EN_VALIDATION — pas LOCKED).
 * HeyGen principal, D-ID legacy ; fournisseur invisible ; admin à 0 crédit
 * Studiio mais coût externe mesuré ; jamais d'appel payant sans crédit ;
 * jamais un débit injustifié. Ne pas modifier pour faire passer la CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const etat = vi.hoisted(() => ({
  credits: 1000,
  emailAdmin: false,
  appelsPayants: [] as string[],
  credites: [] as Array<[string, number, string]>,
  debites: [] as Array<[string, number]>,
  ligne: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/db/supabase', () => {
  const requete = (table: string) => {
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: async () => ({ data: [], error: null }),
      insert: () => q,
      single: async () => {
        if (table === 'users') return { data: { email: etat.emailAdmin ? 'contact.artboost@gmail.com' : 'client@exemple.fr' }, error: null };
        if (table === 'avatar_generations') return { data: etat.ligne ? { ...etat.ligne } : { id: 'gen-1' }, error: null };
        return { data: null, error: null };
      },
      update: (p: Record<string, unknown>) => { patch = p; if (etat.ligne) Object.assign(etat.ligne, p); return q; },
      then: (r: (v: unknown) => void) => r({ data: patch && patch.credits_refunded ? [{ id: 'gen-1' }] : [], error: null }),
    };
    return q;
  };
  return {
    supabase: {},
    supabaseAdmin: {
      from: requete,
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${p}` } }) }) },
    },
  };
});
vi.mock('@/lib/credits/system', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserCredits: async () => (etat.emailAdmin ? 999_999_999 : etat.credits),
  deductCredits: async (u: string, n: number) => { if (!etat.emailAdmin) etat.debites.push([u, n]); return true; },
  addCredits: async (u: string, n: number, t: string) => { etat.credites.push([u, n, t]); },
}));
vi.mock('@/lib/avatar/jumeau', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resoudreJumeauDuCompte: async () => ({
    ok: true,
    jumeau: { avatar: { id: 'av-1', version: 1, nom: 'A', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v-1', nom: 'bassi' }, prononciations: 0 },
    prive: { providerAvatarId: 'hg-avatar', fournisseurAvatar: 'heygen', providerVoiceId: 'el-voice', prononciations: [] },
  }),
}));
vi.mock('@/lib/voice/synthese', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  synthetiserAvecVoix: async () => { etat.appelsPayants.push('voix'); return { ok: true, audio: Buffer.from('mp3'), contentType: 'audio/mpeg' }; },
}));
vi.mock('@/lib/avatar/heygen', async (orig) => {
  const o = await orig<Record<string, unknown>>();
  const HeyGenError = o.HeyGenError as new (m: string, s: number, c: string) => Error;
  return {
    ...o,
    uploadAsset: async () => { etat.appelsPayants.push('asset'); return { assetId: 'as-1' }; },
    generateAvatarVideoFromAudio: async () => { etat.appelsPayants.push('video'); throw new HeyGenError('HeyGen : quota exceeded (https://api.heygen.com/v3/videos)', 402, 'quota'); },
    getVideoStatus: async () => ({ status: 'failed', failureMessage: 'HeyGen failure_code=MOVIO_ERR avatar not found' }),
  };
});

import { genererVideoJumeau } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { moteurJumeauDisponiblePour } from '@/lib/avatar/jumeau';
import { libelleFournisseurAvatar } from '@/lib/creer/jumeau';
import { MESSAGES_AVATAR, MESSAGES_CREATION, fournisseurPrincipal, trahitUnFournisseur } from '@/lib/avatar/fournisseurs';
import { calculerCoutGeneration } from '@/lib/avatar/couts';
import { didVideoAvatarDisponible } from '@/lib/providers/did/client';
import { VOICE_GROUP_LABELS, mapElevenLabsVoice } from '@/lib/types/voice';
import { VOICE_CONSENT_TEXT } from '@/lib/voice/store';
import { CONSENTEMENT_ENROLEMENT } from '@/lib/avatar/contrat';
import { avertissementsMontage } from '@/lib/autopilot/produire';

const ENV = { JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'k', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  etat.credits = 1000; etat.emailAdmin = false; etat.appelsPayants = []; etat.credites = []; etat.debites = []; etat.ligne = null;
});

describe('AVATAR — fournisseur principal et legacy', () => {
  it('HeyGen est le fournisseur principal ; D-ID n’est jamais appelé sans décision explicite', () => {
    expect(fournisseurPrincipal({} as NodeJS.ProcessEnv)).toBe('heygen');
    expect(didVideoAvatarDisponible({ DID_VIDEO_AVATAR_ACTIVE: '1', DID_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(moteurJumeauDisponiblePour('did', { DID_VIDEO_AVATAR_ACTIVE: '1', DID_API_KEY: 'k', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).disponible).toBe(false);
  });
});

describe('AVATAR — fournisseur invisible pour l’utilisateur', () => {
  it('aucun message utilisateur ne nomme un fournisseur, une variable ou une URL fournisseur', () => {
    const messages = [
      ...Object.values(MESSAGES_AVATAR), ...Object.values(MESSAGES_CREATION),
      ...(['heygen', 'did', 'inconnu'] as const).flatMap((f) => [{}, ENV].map((e) => moteurJumeauDisponiblePour(f, e as NodeJS.ProcessEnv).message ?? '')),
      ...(['heygen', 'did', 'inconnu', undefined] as const).map((f) => libelleFournisseurAvatar(f)),
    ];
    for (const m of messages) expect(trahitUnFournisseur(m), m).toBe(false);
  });
  it('sélecteur de voix, consentements et avertissements Autopilote : aucun fournisseur nommé', () => {
    const voix = mapElevenLabsVoice({ voice_id: 'abc12345678', name: 'Rachel', category: 'premade' });
    const textes = [
      ...Object.values(VOICE_GROUP_LABELS), voix?.name ?? '',
      VOICE_CONSENT_TEXT, ...Object.values(CONSENTEMENT_ENROLEMENT.textes),
      ...avertissementsMontage({ musiqueIntrouvable: true, audioSilencieux: true, voixRepliEdge: true, montageSimple: true }),
      ...avertissementsMontage({ musiqueIntrouvable: false, audioSilencieux: false, voixRepliEdge: true, montageSimple: false, voixPersonnelle: true }),
    ];
    for (const t of textes) expect(trahitUnFournisseur(t), t).toBe(false);
  });
  it('échec fournisseur au lancement → message Studiio, jamais l’erreur brute', async () => {
    const r = await genererVideoJumeau({ userId: 'u1', textes: ['Bonjour'] }, { env: ENV });
    expect(r.ok).toBe(false);
    expect(etat.appelsPayants).toContain('video'); // le refus vient bien du fournisseur
    const message = r.ok ? '' : r.message;
    expect(trahitUnFournisseur(message)).toBe(false);
    expect(message).not.toMatch(/quota|https?:/i);
  });
  it('échec fournisseur au suivi → message Studiio, jamais l’erreur brute', async () => {
    etat.ligne = { id: 'gen-1', user_id: 'u1', status: 'processing', provider: 'heygen', provider_video_id: 'v', video_url: null, error_message: null, credits_charged: 40, credits_refunded: false, created_at: new Date().toISOString(), script: 'Bonjour' };
    const r = await avancerStatutGeneration('u1', 'gen-1');
    expect(r.status).toBe('failed');
    const message = (r as { error: string }).error;
    expect(trahitUnFournisseur(message)).toBe(false);
    expect(message).not.toMatch(/MOVIO|not found/);
  });
});

describe('AVATAR — facturation Studiio', () => {
  it('sans crédit Studiio : AUCUN appel fournisseur payant, aucun débit', async () => {
    etat.credits = 0;
    const r = await genererVideoJumeau({ userId: 'u1', textes: ['Bonjour'] }, { env: ENV });
    expect(r.ok ? '' : r.motif).toBe('credits_insuffisants');
    expect(etat.appelsPayants).toEqual([]);
    expect(etat.debites).toEqual([]);
  });
  it('échec fournisseur après lancement → crédits rendus (aucun débit injustifié)', async () => {
    etat.ligne = { id: 'gen-1', user_id: 'u1', status: 'processing', provider: 'heygen', provider_video_id: 'v', video_url: null, error_message: null, credits_charged: 40, credits_refunded: false, created_at: new Date().toISOString(), script: 'Bonjour' };
    await avancerStatutGeneration('u1', 'gen-1');
    expect(etat.credites).toEqual([['u1', 40, 'refund']]);
  });
  it('admin : 0 crédit Studiio, coût fournisseur MESURÉ, marge = −coût', () => {
    const env = { AVATAR_COUT_EUR_PAR_SECONDE: '0.05', VOIX_COUT_EUR_PAR_CARACTERE: '0.0002', STUDIIO_VALEUR_CREDIT_EUR: '0.1' } as unknown as NodeJS.ProcessEnv;
    const c = calculerCoutGeneration({ provider: 'heygen', admin: true, secondes: 20, caracteres: 300, creditsDebites: 40 }, env);
    expect(c.studiioCredits).toBe(0);
    expect(c.providerCostEur).toBeCloseTo(1.06, 4);
    expect(c.marginEur).toBeCloseTo(-1.06, 4);
  });
  it('utilisateur : prix Studiio − coût fournisseur ; tarif inconnu = non mesuré (jamais 0 inventé)', () => {
    const env = { AVATAR_COUT_EUR_PAR_SECONDE: '0.05', VOIX_COUT_EUR_PAR_CARACTERE: '0.0002', STUDIIO_VALEUR_CREDIT_EUR: '0.1' } as unknown as NodeJS.ProcessEnv;
    const c = calculerCoutGeneration({ provider: 'heygen', admin: false, secondes: 20, caracteres: 300, creditsDebites: 40 }, env);
    expect(c.studiioCredits).toBe(40);
    expect(c.marginEur).toBeCloseTo(4 - 1.06, 4);
    expect(calculerCoutGeneration({ provider: 'heygen', admin: true, secondes: 20, caracteres: 300, creditsDebites: 0 }, {} as NodeJS.ProcessEnv).providerCostEur).toBeNull();
  });
});

describe('AVATAR — même moteur pour Créer et Autopilote', () => {
  it('l’Autopilote passe par la porte unique genererVideoJumeau', () => {
    const a = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/jumeau-async.ts'), 'utf-8');
    expect(a).toContain('genererVideoJumeau(');
    const c = readFileSync(resolve(process.cwd(), 'src/app/api/creer/jumeau/generer/route.ts'), 'utf-8');
    expect(c).toContain('genererVideoJumeau(');
  });
});
