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

/** Comptes de test — des UUID, comme en base (le stockage les valide). */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

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
  /** D-ID : réponses successives à la création de scène, soldes `GET /credits`, statut distant. */
  reponsesDid: [] as Array<'ok' | 'solde'>,
  scenesDid: 0,
  soldesDid: [] as number[],
  sceneDistante: { status: 'processing' } as { status: string; videoUrl?: string; failureMessage?: string },
} }));

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/service-alerts', () => ({
  reportServiceAlert: async (service: string, severity: string, message: string, details?: string) => {
    etat.alertes.push({ service, severity, message, details });
  },
  // Alerte UNIQUE par type : la doublure enregistre chaque signalement, et
  // dit « créée » au premier (l'email ne part qu'à l'ouverture).
  signalerAlerteCle: async (a: { service: string; cle: string; severity: string; message: string; details?: string }) => {
    const deja = etat.alertes.some((x) => x.service === a.service && (x as { cle?: string }).cle === a.cle);
    etat.alertes.push({ service: a.service, severity: a.severity, message: a.message, details: a.details, cle: a.cle } as never);
    return deja ? 'mise_a_jour' : 'creee';
  },
  resoudreAlerteCle: async () => false,
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
const exemptionGardeFou = vi.hoisted(() => ({ admin: false }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => exemptionGardeFou.admin, exempteDeCredits: () => exemptionGardeFou.admin }));
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
      providerAvatarId: 'look-1', avatarVersionId: null, fournisseurAvatar: userId === '33333333-3333-4333-8333-333333333333' ? 'did' : 'heygen', typeAvatar: 'photo',
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

vi.mock('@/lib/providers/did/client', async (orig) => {
  const vrai = await orig<typeof import('@/lib/providers/did/client')>();
  return {
    ...vrai,
    creerSceneAudio: async () => {
      etat.scenesDid += 1;
      // Le VRAI code normalisé d'un 402 D-ID (`erreurNormalisee`).
      if ((etat.reponsesDid.shift() ?? 'ok') === 'solde') throw new vrai.DidError('Crédits D-ID insuffisants côté fournisseur.', 402, 'did_insufficient_credits');
      return { id: `scene-${etat.scenesDid}` };
    },
    lireScene: async () => ({ ...etat.sceneDistante }),
  };
});

// Lecture du solde HeyGen (`GET /v3/users/me`) : la seule requête réseau du module.
vi.stubGlobal('fetch', async (url: string) => {
  if (String(url).includes('api.d-id.com/credits')) {
    etat.lecturesSolde += 1;
    const restant = etat.soldesDid.length > 1 ? etat.soldesDid.shift()! : etat.soldesDid[0] ?? 0;
    return new Response(JSON.stringify({ remaining: restant, total: 100 }), { status: 200 });
  }
  if (!String(url).includes('api.heygen.com/v3/users/me')) throw new Error(`réseau interdit en test : ${url}`);
  etat.lecturesSolde += 1;
  const solde = etat.soldes.length > 1 ? etat.soldes.shift()! : etat.soldes[0] ?? 0;
  return new Response(JSON.stringify({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: solde, auto_reload: { enabled: true, threshold_usd: 10, amount_usd: 30 } } } }), { status: 200 });
});
process.env.HEYGEN_API_KEY = 'cle-test';
process.env.DID_API_KEY = 'cle-did-test';
// Les scénarios D-ID supposent le flux legacy ACTIF (sinon D-ID n'est pas surveillé).
process.env.AVATAR_DID_LEGACY_ACTIF = '1';
delete process.env.ELEVENLABS_API_KEY;
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'secret-de-test-0123456789';

import { genererVideoJumeau, reprendreGenerationEnAttente } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { MESSAGES_AVATAR, trahitUnFournisseur } from '@/lib/avatar/fournisseurs';
import { MESSAGE_ATTENTE_FOURNISSEUR, ATTENTE_MAX_MS, lireMarqueurAttente } from '@/lib/avatar/attente-fournisseur';
import { _reinitialiserSante, lireEtats } from '@/lib/fournisseurs/sante';

const demande = (userId = U1) => ({ userId, textes: ['Bonjour, voici ma vidéo.'], aspectRatio: '9:16', cadrage: 'remplir' as const });
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
    reponsesDid: [], scenesDid: 0, soldesDid: [], sceneDistante: { status: 'processing' },
  });
  etat.credits = new Map([[U1, 100], [U2, 100], [U3, 100]]);
});

describe('1. abonnement actif, fournisseur OK → génération lancée', () => {
  it('une vidéo, un débit, aucune lecture de solde (le chemin normal ne paie aucune latence)', async () => {
    const r = await genererVideoJumeau(demande());
    expect(r).toMatchObject({ ok: true, status: 'pending' });
    expect((r as { enAttenteFournisseur?: boolean }).enAttenteFournisseur).toBeUndefined();
    expect(etat.lancements).toBe(1);
    expect(debits(U1)).toHaveLength(1);
    expect(etat.lecturesSolde).toBe(0);
  });
});

describe('2. quota utilisateur épuisé → aucun appel fournisseur', () => {
  it('ni voix, ni audio, ni vidéo ; message quota + CTA abonnement', async () => {
    etat.credits.set(U1, 0);
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
    expect(debits(U1)).toHaveLength(1);
    expect(etat.credits.get(U1)).toBe(60);
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
    const suivi = await avancerStatutGeneration(U1, id);
    expect(suivi).toMatchObject({ status: 'processing', enAttenteFournisseur: true });
    expect(etat.lancements).toBe(1);
    expect(MESSAGE_ATTENTE_FOURNISSEUR).toContain('Aucun crédit Studiio ne sera perdu');

    // Au-delà du délai : abandon, remboursé une seule fois.
    g.created_at = new Date(Date.now() - ATTENTE_MAX_MS - 60_000).toISOString();
    const fin = await avancerStatutGeneration(U1, id);
    expect(fin.status).toBe('failed');
    expect(trahitUnFournisseur((fin as { error: string }).error)).toBe(false);
    await avancerStatutGeneration(U1, id);
    expect(etat.remboursements).toEqual([[U1, 40]]);
    expect(etat.credits.get(U1)).toBe(100);
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
      avancerStatutGeneration(U1, id),
    ]);
    expect(etat.lancements).toBe(2); // 1 refusé + 1 seule reprise
    // Les deux reprises directes : une seule a pris la main.
    expect(issues.slice(0, 2).filter((i) => i === 'relancee').length).toBeLessThanOrEqual(1);
    expect(debits(U1)).toHaveLength(1);
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
    const [a, b] = await Promise.all([genererVideoJumeau(demande(U1)), genererVideoJumeau(demande(U2))]);
    expect(etat.lecturesSolde).toBe(1);
    expect(a).toMatchObject({ ok: true, enAttenteFournisseur: true });
    expect(b).toMatchObject({ ok: true, enAttenteFournisseur: true });
    // Bloqué AVANT débit : rien n'est pris aux utilisateurs.
    expect(debits(U1)).toHaveLength(0);
    expect(debits(U2)).toHaveLength(0);
    expect(etat.syntheses + etat.lancements).toBe(0);
  });
});

describe('7-8. « Insufficient credit » au suivi : utilisateur protégé, admin informé', () => {
  it('l’utilisateur ne lit jamais HeyGen ; l’admin voit la vraie cause', async () => {
    const r = await genererVideoJumeau(demande());
    const id = (r as { generationId: string }).generationId;
    etat.statutDistant = { status: 'failed', failureMessage: REFUS_HEYGEN };
    etat.soldes = [0];
    const suivi = await avancerStatutGeneration(U1, id);
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

describe('D-ID (legacy) : la même règle financière que HeyGen', () => {
  it('fournisseur OK : scène lancée, audio déposé, un débit', async () => {
    const r = await genererVideoJumeau(demande(U3));
    expect(r).toMatchObject({ ok: true, status: 'processing' });
    expect(etat.scenesDid).toBe(1);
    expect(debits(U3)).toHaveLength(1);
    expect([...base.objets].some((k) => k.includes(`${U3}/`))).toBe(true);
  });

  it('402 au lancement, solde revenu : UN nouvel essai, un seul débit', async () => {
    etat.reponsesDid = ['solde', 'ok'];
    etat.soldesDid = [50];
    const r = await genererVideoJumeau(demande(U3));
    expect(r).toMatchObject({ ok: true, status: 'processing' });
    expect(etat.scenesDid).toBe(2);
    expect(debits(U3)).toHaveLength(1);
    expect(etat.remboursements).toEqual([]);
  });

  it('402 au lancement, solde toujours vide : EN ATTENTE, débit gardé, puis UNE reprise', async () => {
    etat.reponsesDid = ['solde'];
    etat.soldesDid = [0];
    const r = await genererVideoJumeau(demande(U3));
    expect(r).toMatchObject({ ok: true, enAttenteFournisseur: true });
    const id = (r as { generationId: string }).generationId;
    expect(generation(id)).toMatchObject({ status: 'pending' });
    expect(etat.alertes.some((a) => a.service === 'did' && a.severity === 'critical')).toBe(true);
    expect(etat.credits.get(U3)).toBe(60);

    etat.soldesDid = [50];
    etat.reponsesDid = ['ok', 'ok'];
    const ligne = () => ({ ...generation(id) }) as unknown as Parameters<typeof reprendreGenerationEnAttente>[0];
    await Promise.all([reprendreGenerationEnAttente(ligne()), reprendreGenerationEnAttente(ligne()), avancerStatutGeneration(U3, id)]);
    expect(etat.scenesDid).toBe(2); // 1 refusée + 1 seule reprise
    expect(debits(U3)).toHaveLength(1);
    expect(generation(id)).toMatchObject({ status: 'processing', provider_video_id: 'scene-2' });
    expect(etat.remboursements).toEqual([]);
  });

  it('refus « solde » AU SUIVI : attente ; la reprise retire l’audio resté puis redépose sans collision', async () => {
    const r = await genererVideoJumeau(demande(U3));
    const id = (r as { generationId: string }).generationId;
    etat.sceneDistante = { status: 'failed', failureMessage: 'did_insufficient_credits' };
    etat.soldesDid = [0];
    const suivi = await avancerStatutGeneration(U3, id);
    expect(suivi).toMatchObject({ status: 'processing', enAttenteFournisseur: true });
    expect(JSON.stringify(suivi)).not.toMatch(/d-id|did_|insufficient/i);

    etat.soldesDid = [40];
    const issue = await reprendreGenerationEnAttente({ ...generation(id) } as unknown as Parameters<typeof reprendreGenerationEnAttente>[0]);
    expect(issue).toBe('relancee');
    expect(etat.scenesDid).toBe(2);
    expect(debits(U3)).toHaveLength(1);
  });

  it('attente trop longue : abandon, remboursé UNE fois, audio privé retiré', async () => {
    etat.reponsesDid = ['solde'];
    etat.soldesDid = [0];
    const r = await genererVideoJumeau(demande(U3));
    const id = (r as { generationId: string }).generationId;
    generation(id).created_at = new Date(Date.now() - ATTENTE_MAX_MS - 1).toISOString();
    await avancerStatutGeneration(U3, id);
    await avancerStatutGeneration(U3, id);
    expect(generation(id).status).toBe('failed');
    expect(etat.remboursements).toEqual([[U3, 40]]);
    expect([...base.objets].some((k) => k.includes(id))).toBe(false);
  });
});

describe('cron /api/cron/providers-health', () => {
  const appel = async (auth: string | null) => {
    const { GET } = await import('@/app/api/cron/providers-health/route');
    const req = new Request('https://studiio.pro/api/cron/providers-health', { headers: auth ? { authorization: auth } : {} });
    return GET(req as unknown as Parameters<typeof GET>[0]);
  };
  const enAttente = async (userId: string, reponses: Array<'solde'>) => {
    if (userId === U3) { etat.reponsesDid = [...reponses]; etat.soldesDid = [0]; } else { etat.reponsesLancement = [...reponses]; etat.soldes = [0]; }
    const r = await genererVideoJumeau(demande(userId));
    expect(r).toMatchObject({ ok: true, enAttenteFournisseur: true });
    return (r as { generationId: string }).generationId;
  };

  it('authentification : sans secret, mauvais jeton ou secret non configuré → 401, rien ne bouge', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    expect((await appel(null)).status).toBe(401);
    expect((await appel('Bearer faux')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await appel('Bearer undefined')).status).toBe(401);
    expect(etat.lecturesSolde).toBe(0);
  });

  it('reprise des attentes HeyGen ET D-ID, deux passages SIMULTANÉS : une vidéo chacune, un débit, aucun remboursement', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    const h = await enAttente(U1, ['solde']);
    const d = await enAttente(U3, ['solde']);
    etat.soldes = [90];
    etat.soldesDid = [90];
    const lancementsAvant = etat.lancements;
    const scenesAvant = etat.scenesDid;
    const [a, b] = await Promise.all([appel('Bearer secret-cron'), appel('Bearer secret-cron')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(etat.lancements - lancementsAvant).toBe(1);
    expect(etat.scenesDid - scenesAvant).toBe(1);
    expect(generation(h).provider_video_id).toBeTruthy();
    expect(generation(d).provider_video_id).toBeTruthy();
    expect(debits(U1)).toHaveLength(1);
    expect(debits(U3)).toHaveLength(1);
    expect(etat.remboursements).toEqual([]);

    // Idempotence : un troisième passage ne relance rien.
    await appel('Bearer secret-cron');
    expect(etat.lancements - lancementsAvant).toBe(1);
    expect(etat.scenesDid - scenesAvant).toBe(1);
  });

  it('fournisseur toujours vide : le cron ne relance rien et ne débite rien de plus', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    const id = await enAttente(U1, ['solde']);
    const avant = etat.lancements;
    const r = await (await appel('Bearer secret-cron')).json();
    expect(r.reprises[id]).toBe('toujours_en_attente');
    expect(etat.lancements).toBe(avant);
    expect(debits(U1)).toHaveLength(1);
    expect(generation(id).status).toBe('pending');
  });

  it('attente expirée, cron ET navigateur en même temps : abandon, remboursé UNE seule fois', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    const id = await enAttente(U1, ['solde']);
    generation(id).created_at = new Date(Date.now() - ATTENTE_MAX_MS - 1).toISOString();
    await Promise.all([appel('Bearer secret-cron'), appel('Bearer secret-cron'), avancerStatutGeneration(U1, id)]);
    expect(generation(id).status).toBe('failed');
    expect(etat.remboursements).toEqual([[U1, 40]]);
    expect(etat.credits.get(U1)).toBe(100);
  });

  it('soldes : deux passages simultanés → UNE lecture par fournisseur (bail)', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    etat.soldes = [100];
    etat.soldesDid = [100];
    await Promise.all([appel('Bearer secret-cron'), appel('Bearer secret-cron')]);
    expect(etat.lecturesSolde).toBe(2); // HeyGen 1 + D-ID 1 (ElevenLabs sans clé ; Replicate non mesurable)
  });
});

describe('D-ID non utilisé (flux legacy coupé) : ni lu, ni alerté', () => {
  it('le cron ne lit pas son solde et dit « inactif »', async () => {
    process.env.CRON_SECRET = 'secret-cron';
    delete process.env.AVATAR_DID_LEGACY_ACTIF;
    try {
      etat.soldes = [100];
      etat.soldesDid = [0];
      const { GET } = await import('@/app/api/cron/providers-health/route');
      const r = await (await GET(new Request('https://studiio.pro/api/cron/providers-health', { headers: { authorization: 'Bearer secret-cron' } }) as never)).json();
      expect(r.soldes.did).toBe('inactif');
      expect(etat.lecturesSolde).toBe(1); // HeyGen seulement
      expect(etat.alertes.filter((a) => a.service === 'did')).toHaveLength(0);
    } finally {
      process.env.AVATAR_DID_LEGACY_ACTIF = '1';
    }
  });
});

describe('Garde-fou mise en production — reprise d’une génération admin sur un moteur fermé', () => {
  it('⚠️ génération en attente portant avatar_iv, compte admin, avatar_iv non autorisé → reprise refusée : abandonnée, AUCUN second lancement', async () => {
    delete process.env.AVATAR_MOTEURS_AUTORISES;
    etat.reponsesLancement = ['solde'];
    etat.soldes = [0];
    const r = await genererVideoJumeau(demande());
    const id = (r as { generationId: string }).generationId;
    expect(etat.lancements).toBe(1);
    generation(id).engine = 'avatar_iv'; // ligne réservée avant le garde-fou
    exemptionGardeFou.admin = true;
    try {
      etat.soldes = [80];
      etat.reponsesLancement = ['ok'];
      const issue = await reprendreGenerationEnAttente({ ...generation(id) } as unknown as Parameters<typeof reprendreGenerationEnAttente>[0]);
      expect(issue).toBe('abandonnee');
      expect(etat.lancements).toBe(1);
      expect(generation(id).status).toBe('failed');
    } finally {
      exemptionGardeFou.admin = false;
    }
  });
});
