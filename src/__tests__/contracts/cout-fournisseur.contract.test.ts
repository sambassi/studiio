// @vitest-environment node
/**
 * CONTRAT C-COST — aucun appel fournisseur PAYANT lancé à la main par un
 * compte admin (0 crédit Studiio) sans confirmation du coût : 428 + devis
 * AVANT toute écriture, tout débit, tout appel. Validé par #562
 * (`confirmation-cout.ts`), et la suggestion de prononciation n'appelle
 * jamais le modèle quand la règle locale est sûre.
 *
 * Tous les fournisseurs sont DOUBLÉS et comptés : aucun appel réseau réel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const etat = vi.hoisted(() => ({
  admin: true, ecritures: [] as string[], heygen: [] as string[], eleven: 0, anthropic: 0,
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'admin@test.fr' } }) }));
vi.mock('@/lib/admin', () => ({ isAdmin: () => true }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => etat.admin, exempteDeCredits: () => etat.admin }));
vi.mock('@/lib/avatar/versions', async (orig) => ({
  ...(await orig<typeof import('@/lib/avatar/versions')>()),
  listerIdentites: async () => ({ ok: true, identites: [] }),
}));
vi.mock('@/lib/db/supabase', () => {
  const api: Record<string, unknown> = {};
  const enregistrer = (op: string) => () => { etat.ecritures.push(op); return api; };
  Object.assign(api, {
    select: () => api, eq: () => api, is: () => api, order: () => api, limit: () => api, maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: { message: 'x' } }),
    insert: enregistrer('insert'), update: enregistrer('update'), upsert: enregistrer('upsert'), delete: enregistrer('delete'),
    then: (r: (v: unknown) => void) => r({ data: [], error: null }),
  });
  return {
    supabase: {},
    supabaseAdmin: {
      from: () => api,
      storage: { from: () => ({ upload: enregistrer('upload'), remove: enregistrer('remove'), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/${p}` } }) }) },
    },
  };
});
vi.mock('@/lib/avatar/heygen', async (orig) => ({
  ...(await orig<typeof import('@/lib/avatar/heygen')>()),
  uploadAsset: async () => { etat.heygen.push('assets'); return { assetId: 'a' }; },
  createAvatarFromAsset: async () => { etat.heygen.push('avatars'); return { avatarId: 'x' }; },
}));
// ── ElevenLabs (Audio complet) doublé ──
vi.mock('@/lib/voice/profil', async (orig) => ({
  ...(await orig<typeof import('@/lib/voice/profil')>()),
  resoudreVoixDuCompte: async () => ({ ok: true, providerVoiceId: 'pvid', prononciations: [] }),
}));
vi.mock('@/lib/voice/synthese', async (orig) => ({
  ...(await orig<typeof import('@/lib/voice/synthese')>()),
  synthetiserAvecVoix: async () => { etat.eleven += 1; return { ok: true, audio: Buffer.from('MP3'), contentType: 'audio/mpeg' }; },
}));
vi.mock('@/lib/voice/audio-complet-serveur', async (orig) => ({
  ...(await orig<typeof import('@/lib/voice/audio-complet-serveur')>()),
  objetAudioCompletExiste: async () => false,
  debitAudioCompletEnregistre: async () => false,
}));
vi.mock('@/lib/storage/upload', () => ({
  uploadBufferToStorage: async () => { etat.ecritures.push('upload'); return 'https://studiio.pro/audio.mp3'; },
  deleteFromStorage: async () => {}, uploadToStorage: async () => '', uploadFileToStorage: async () => '', getSignedUrl: async () => '',
}));
vi.mock('@/lib/tarifs/serveur', async (orig) => ({ ...(await orig<typeof import('@/lib/tarifs/serveur')>()), prixDe: async () => 1 }));

globalThis.fetch = vi.fn(async (url: unknown) => {
  if (String(url) === 'https://api.anthropic.com/v1/messages') {
    etat.anthropic += 1;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Afro-boust' }] }), { status: 200 });
  }
  throw new Error(`fetch inattendu ${String(url)}`);
}) as unknown as typeof fetch;

import { exigerConfirmationCout, confirmationValable, CODE_CONFIRMATION_COUT } from '@/lib/fournisseurs/confirmation-cout';
import { devisVideoHeygen } from '@/lib/fournisseurs/devis-fournisseur';

const { POST: CREER_AVATAR } = await import('@/app/api/avatar/create/route');
const { POST: SUGGERER } = await import('@/app/api/voice/prononciations/suggestion/route');
const { POST: AUDIO_COMPLET } = await import('@/app/api/voice/audio-complet/route');

const devis = devisVideoHeygen({ operation: 'video_avatar', moteurEnvoye: 'avatar_iii', avatarType: 'video', dureeSecondes: { min: 10, max: 10 } });
const json = (body: unknown) => new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  etat.admin = true; etat.ecritures.length = 0; etat.heygen.length = 0; etat.eleven = 0; etat.anthropic = 0;
  process.env.ANTHROPIC_API_KEY = 'cle-test';
  process.env.ELEVENLABS_API_KEY = 'cle-test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('C-COST — la garde (pure)', () => {
  it('admin sans confirmation → 428 + devis ; confirmé → passe ; non-admin → jamais bloqué (il paie en crédits)', async () => {
    const refus = exigerConfirmationCout({ admin: true, confirme: false, devis });
    expect(refus?.status).toBe(428);
    expect(await refus!.json()).toMatchObject({ code: CODE_CONFIRMATION_COUT, devis: { moteur: 'avatar_iii' } });
    expect(exigerConfirmationCout({ admin: true, confirme: true, devis })).toBeNull();
    expect(exigerConfirmationCout({ admin: false, confirme: false, devis })).toBeNull();
  });
  it('une confirmation donnée pour un AUTRE moteur ne vaut pas', () => {
    expect(confirmationValable(true, 'avatar_iv', devis)).toBe(false);
    expect(exigerConfirmationCout({ admin: true, confirme: true, moteurConfirme: 'avatar_iv', devis })?.status).toBe(428);
  });
});

describe('C-COST — routes', () => {
  it('HeyGen — création d’avatar par l’admin sans confirmation : 428, 0 écriture, 0 appel', async () => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(2048)], 'moi.mp4', { type: 'video/mp4' }));
    fd.append('consent', 'true'); fd.append('name', 'Mon avatar');
    const res = await CREER_AVATAR(new NextRequest('https://studiio.pro/api/avatar/create', { method: 'POST', body: fd }));
    expect(res.status).toBe(428);
    expect((await res.json()).code).toBe('confirmation_cout_fournisseur');
    expect(etat.ecritures).toEqual([]);
    expect(etat.heygen).toEqual([]);
  });

  it('suggestion de prononciation : règle locale sûre → 0 appel au modèle, même répété', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await SUGGERER(json({ affiche: '3-en-1 OS RENFORCÉS' }));
      expect((await res.json()).data).toMatchObject({ source: 'locale' });
    }
    expect(etat.anthropic).toBe(0);
  });

  // BUG RÉEL (écart au contrat, non corrigé ici) : « Générer l'audio complet »
  // (/api/voice/audio-complet) lancé par un compte ADMIN appelle ElevenLabs
  // (synthèse payante côté fournisseur) SANS garde 428 ni devis : la route
  // n'utilise pas `exigerConfirmationCout`. Vérifié en faisant tourner ce test
  // en `it` : statut 200, 1 synthèse ElevenLabs. `it.fails` jusqu'au correctif.
  it.fails('ElevenLabs — Audio complet par l’admin sans confirmation : 428, 0 synthèse', async () => {
    const res = await AUDIO_COMPLET(json({ texte: 'Bonjour, ceci est un test.' }));
    expect(res.status).toBe(428);
    expect(etat.eleven).toBe(0);
  });
});
