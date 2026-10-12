/**
 * FACTURATION FOURNISSEURS — crédits UTILISATEUR ≠ solde de STUDIIO.
 *
 * Bug réel (2026-10-12) : le compte API HeyGen était vide (« Insufficient
 * credit. This operation requires 'api' credits. ») ; l'utilisateur l'a
 * découvert à la génération, en échec. Ces tests exécutent le VRAI moteur
 * (`genererVideoJumeau`), le VRAI suivi (`avancerStatutGeneration`) et le VRAI
 * module de santé (`sante.ts`), sur une base en mémoire. Les fournisseurs sont
 * des doublures : aucun appel réel, aucun paiement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fausseBase as base } from './helpers/fausse-base';

const { etat, REFUS_HEYGEN } = vi.hoisted(() => ({ REFUS_HEYGEN: "Insufficient credit. This operation requires 'api' credits.", etat: {
  credits: new Map<string, number>(),
  syntheses: 0,
  uploads: 0,
  lancements: 0,
  /** Réponses successives de HeyGen au lancement : 'ok' ou 'solde'. */
  reponsesLancement: [] as Array<'ok' | 'solde'>,
  /** Statut renvoyé par le suivi HeyGen. */
  statutDistant: { status: 'processing' } as { status: string; videoUrl?: string; failureMessage?: string },
  /** Soldes successifs renvoyés par `GET /v3/users/me`. */
  soldes: [] as number[],
  lecturesSolde: 0,
  alertes: [] as Array<{ service: string; severity: string; message: string; details?: string }>,
  emails: [] as Array<{ subject: string; html: string }>,
  remboursements: [] as Array<[string, number]>,
} }));

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/service-alerts', () => ({
  reportServiceAlert: async (service: string, severity: string, message: string, details?: string) => {
    etat.alertes.push({ service, severity, message, details });
  },
  getAllAlerts: async () => etat.alertes,
}));
vi.mock('@/lib/email/resend', () => ({
  sendEmailSilent: (m: { subject: string; html: string }) => { etat.emails.push(m); },
}));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async (u: string) => etat.credits.get(u) ?? 0,
  deductCredits: async (u: string, n: number, _raison: string, reference: string) => {
    const base = (await import('./helpers/fausse-base')).fausseBase;
    const deja = base.table('credit_transactions').some((t) => t.user_id === u && t.reference_id === reference);
    if (deja) return { dejaDebite: true };
    if ((etat.credits.get(u) ?? 0) < n) throw new Error('Insufficient credits');
    etat.credits.set(u, (etat.credits.get(u) ?? 0) - n);
    base.table('credit_transactions').push({ user_id: u, reference_id: reference, amount: -n });
    return { dejaDebite: false };
  },
  addCredits: async (u: string, n: number) => {
    etat.remboursements.push([u, n]);
    etat.credits.set(u, (etat.credits.get(u) ?? 0) + n);
  },
}));
vi.mock('@/lib/tarifs/serveur', () => ({ prixDe: async () => 40 }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => false, exempteDeCredits: () => false }));
vi.mock('@/lib/avatar/couts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  compteAdmin: async () => false,
  enregistrerCoutGeneration: async () => {},
}));
vi.mock('@/lib/voice/synthese', () => ({
  cleElevenLabs: () => 'cle',
  synthetiserAvecVoix: async () => { etat.syntheses += 1; return { ok: true, audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' }; },
}));
vi.mock('@/lib/avatar/jumeau', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  moteurJumeauDisponiblePour: () => ({ disponible: true, message: null }),
  resoudreJumeauDuCompte: async (userId: string) => ({
    ok: true,
    jumeau: { avatar: { id: `avatar-${userId}`, version: 3 }, voix: { id: `voix-${userId}` } },
    prive: {
      providerAvatarId: 'look-1', avatarVersionId: null, fournisseurAvatar: 'heygen', typeAvatar: 'photo',
      consentementJumeau: null, providerVoiceId: 'voix-el', prononciations: [],
    },
  }),
}));
vi.mock('@/lib/avatar/heygen', async (orig) => {
  const vrai = await orig<typeof import('@/lib/avatar/heygen')>();
  return {
    ...vrai,
    moteursSupportesDuLook: async () => null,
    uploadAsset: async () => { etat.uploads += 1; return { assetId: `asset-${etat.uploads}` }; },
    generateAvatarVideoFromAudio: async () => {
      etat.lancements += 1;
      const r = etat.reponsesLancement.shift() ?? 'ok';
      // Le VRAI classement d'un refus HeyGen (402 + corps réel de production).
      if (r === 'solde') throw vrai.mapHeyGenFailure(402, { error: { message: REFUS_HEYGEN } });
      return { videoId: `vid-${etat.lancements}`, status: 'pending' };
    },
    getVideoStatus: async () => ({ ...etat.statutDistant }),
    downloadVideo: async () => Buffer.from('mp4'),
  };
});

// Lecture du solde HeyGen (`GET /v3/users/me`) : la seule requête réseau du module.
vi.stubGlobal('fetch', async (url: string) => {
  if (!String(url).includes('api.heygen.com/v3/users/me')) throw new Error(`réseau interdit en test : ${url}`);
  etat.lecturesSolde += 1;
  const solde = etat.soldes.length > 1 ? etat.soldes.shift()! : etat.soldes[0] ?? 0;
  return new Response(JSON.stringify({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: solde, auto_reload: { enabled: true, threshold_usd: 10, amount_usd: 30 } } } }), { status: 200 });
});
process.env.HEYGEN_API_KEY = 'cle-test';

import { genererVideoJumeau, reprendreGenerationEnAttente } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { MESSAGES_AVATAR, trahitUnFournisseur } from '@/lib/avatar/fournisseurs';
import { MESSAGE_ATTENTE_FOURNISSEUR, ATTENTE_MAX_MS, lireMarqueurAttente } from '@/lib/avatar/attente-fournisseur';
import { _reinitialiserSante, lireEtats } from '@/lib/fournisseurs/sante';

const demande = (userId = 'u1') => ({ userId, textes: ['Bonjour, voici ma vidéo.'], aspectRatio: '9:16', cadrage: 'remplir' as const });
const generation = (id: string) => base.table('avatar_generations').find((g) => g.id === id)!;
const debits = (u: string) => base.table('credit_transactions').filter((t) => t.user_id === u);
const bloquerHeyGen = async () => {
  base.table('app_settings').push({ key: 'provider_health_state', value: { heygen: { statut: 'bloque', solde: 0, bloqueDepuis: new Date().toISOString() } } });
};

beforeEach(() => {
  base.vider();
  _reinitialiserSante();
  Object.assign(etat, {
    syntheses: 0, uploads: 0, lancements: 0, reponsesLancement: [], soldes: [], lecturesSolde: 0,
    statutDistant: { status: 'processing' }, alertes: [], emails: [], remboursements: [],
  });
  etat.credits = new Map([['u1', 100], ['u2', 100]]);
});

describe('1. abonnement actif, fournisseur OK → génération lancée', () => {
  it('une vidéo, un débit, aucune lecture de solde (le chemin normal ne paie aucune latence)', async () => {
    const r = await genererVideoJumeau(demande());
    expect(r).toMatchObject({ ok: true, status: 'pending' });
    expect((r as { enAttenteFournisseur?: boolean }).enAttenteFournisseur).toBeUndefined();
    expect(etat.lancements).toBe(1);
    expect(debits('u1')).toHaveLength(1);
    expect(etat.lecturesSolde).toBe(0);
  });
});

describe('2. quota utilisateur épuisé → aucun appel fournisseur', () => {
  it('ni voix, ni audio, ni vidéo ; message quota + CTA abonnement', async () => {
    etat.credits.set('u1', 0);
    const r = await genererVideoJumeau(demande());
    expect(r).toMatchObject({ ok: false, motif: 'credits_insuffisants', message: MESSAGES_AVATAR.quotaEpuise });
    expect(etat.syntheses + etat.uploads + etat.lancements + etat.lecturesSolde).toBe(0);
    expect(MESSAGES_AVATAR.quotaEpuise).toBe('Votre quota de génération est épuisé. Passez au plan supérieur ou rechargez pour continuer.');
  });
});

describe('3. solde HeyGen insuffisant au lancement → récupération → la génération reprend', () => {
  it('recharge automatique passée : UN nouvel essai, même audio, utilisateur débité une seule fois', async () => {
    etat.reponsesLancement = ['solde', 'ok'];
    etat.soldes = [60]; // l'auto-reload a remis le wallet à flot
    const r = await genererVideoJumeau(demande());
    expect(r).toMatchObject({ ok: true, status: 'pending' });
    expect((r as { enAttenteFournisseur?: boolean }).enAttenteFournisseur).toBeUndefined();
    expect(etat.lancements).toBe(2);
    expect(etat.syntheses).toBe(1); // la voix n'est pas refacturée
    expect(etat.uploads).toBe(1);
    expect(debits('u1')).toHaveLength(1);
    expect(etat.credits.get('u1')).toBe(60);
    expect(etat.remboursements).toEqual([]);
    expect(generation((r as { generationId: string }).generationId).provider_video_id).toBe('vid-2');
  });
});

describe('4. recharge impossible → en attente, admin alerté, crédits jamais perdus', () => {
  it('attente, puis abandon après le délai : remboursé UNE fois, message sans fournisseur', async () => {
    etat.reponsesLancement = ['solde'];
    etat.soldes = [0];
    const r = await genererVideoJumeau(demande());
    expect(r).toMatchObject({ ok: true, status: 'pending', enAttenteFournisseur: true });
    const id = (r as { generationId: string }).generationId;
    const g = generation(id);
    expect(g.status).toBe('pending');
    expect(g.provider_video_id ?? null).toBeNull();
    expect(lireMarqueurAttente(g.provider_error as string)).toMatchObject({ reprises: 0, cadrage: 'remplir' });

    // Admin : CRITICAL « bloqué » en bannière + email.
    expect(etat.alertes.some((a) => a.severity === 'critical' && a.message === 'HeyGen : fournisseur bloqué — génération mise en attente.')).toBe(true);
    expect(etat.emails.some((e) => e.subject.includes('HeyGen : fournisseur bloqué'))).toBe(true);

    // L'utilisateur, pendant l'attente : « en cours », message d'attente, rien de perdu.
    const suivi = await avancerStatutGeneration('u1', id);
    expect(suivi).toMatchObject({ status: 'processing', enAttenteFournisseur: true });
    expect(etat.lancements).toBe(1);
    expect(MESSAGE_ATTENTE_FOURNISSEUR).toContain('Aucun crédit Studiio ne sera perdu');

    // Au-delà du délai : abandon, remboursé une seule fois.
    g.created_at = new Date(Date.now() - ATTENTE_MAX_MS - 60_000).toISOString();
    const fin = await avancerStatutGeneration('u1', id);
    expect(fin.status).toBe('failed');
    expect(trahitUnFournisseur((fin as { error: string }).error)).toBe(false);
    await avancerStatutGeneration('u1', id);
    expect(etat.remboursements).toEqual([['u1', 40]]);
    expect(etat.credits.get('u1')).toBe(100);
  });
});

describe('5. reprise → un seul job fournisseur', () => {
  it('le navigateur et le cron reprennent en même temps : UNE vidéo, UN débit', async () => {
    etat.reponsesLancement = ['solde'];
    etat.soldes = [0];
    const r = await genererVideoJumeau(demande());
    const id = (r as { generationId: string }).generationId;
    expect(etat.lancements).toBe(1);

    // Le solde revient ; reprises concurrentes.
    etat.soldes = [80];
    etat.reponsesLancement = ['ok', 'ok'];
    const ligne = () => ({ ...generation(id) }) as unknown as Parameters<typeof reprendreGenerationEnAttente>[0];
    const issues = await Promise.all([
      reprendreGenerationEnAttente(ligne()),
      reprendreGenerationEnAttente(ligne()),
      avancerStatutGeneration('u1', id),
    ]);
    expect(etat.lancements).toBe(2); // 1 refusé + 1 seule reprise
    // Les deux reprises directes : une seule a pris la main.
    expect(issues.slice(0, 2).filter((i) => i === 'relancee').length).toBeLessThanOrEqual(1);
    expect(debits('u1')).toHaveLength(1);
    expect(generation(id).provider_video_id).toBe('vid-2');
    expect(etat.remboursements).toEqual([]);
  });

  it('une demande identique pendant l’attente reçoit la même génération (pas de doublon)', async () => {
    etat.reponsesLancement = ['solde'];
    etat.soldes = [0];
    const a = await genererVideoJumeau(demande());
    const b = await genererVideoJumeau(demande());
    expect(b).toMatchObject({ ok: true, dejaEnCours: true, generationId: (a as { generationId: string }).generationId });
    expect(base.table('avatar_generations')).toHaveLength(1);
  });
});

describe('6. deux utilisateurs simultanés → une seule vérification/récupération fournisseur', () => {
  it('fournisseur bloqué : deux demandes concurrentes = UNE lecture de solde', async () => {
    await bloquerHeyGen();
    etat.soldes = [0];
    const [a, b] = await Promise.all([genererVideoJumeau(demande('u1')), genererVideoJumeau(demande('u2'))]);
    expect(etat.lecturesSolde).toBe(1);
    expect(a).toMatchObject({ ok: true, enAttenteFournisseur: true });
    expect(b).toMatchObject({ ok: true, enAttenteFournisseur: true });
    // Bloqué AVANT débit : rien n'est pris aux utilisateurs.
    expect(debits('u1')).toHaveLength(0);
    expect(debits('u2')).toHaveLength(0);
    expect(etat.syntheses + etat.lancements).toBe(0);
  });
});

describe('7-8. « Insufficient credit » au suivi : utilisateur protégé, admin informé', () => {
  it('l’utilisateur ne lit jamais HeyGen ; l’admin voit la vraie cause', async () => {
    const r = await genererVideoJumeau(demande());
    const id = (r as { generationId: string }).generationId;
    etat.statutDistant = { status: 'failed', failureMessage: REFUS_HEYGEN };
    etat.soldes = [0];
    const suivi = await avancerStatutGeneration('u1', id);
    expect(suivi).toMatchObject({ status: 'processing', enAttenteFournisseur: true });
    expect(JSON.stringify(suivi)).not.toMatch(/heygen|api credits|insufficient/i);
    expect(etat.remboursements).toEqual([]); // débit gardé pour la reprise

    // Admin : cause brute sur la génération, dans l'état fournisseur, dans l'alerte.
    expect(String(generation(id).provider_error)).toContain(REFUS_HEYGEN);
    expect((await lireEtats()).heygen.derniereErreur).toContain(REFUS_HEYGEN);
    expect(etat.alertes.find((a) => a.severity === 'critical')?.details).toContain(REFUS_HEYGEN);

    for (const m of [MESSAGES_AVATAR.creditsFournisseur, MESSAGES_AVATAR.creditsFournisseurRembourse, MESSAGES_AVATAR.quotaEpuise, MESSAGE_ATTENTE_FOURNISSEUR]) {
      expect(trahitUnFournisseur(m)).toBe(false);
      expect(m).not.toMatch(/api credit|replicate|elevenlabs/i);
    }
  });
});
