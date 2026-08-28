/**
 * Les routes de la tentative de rendu : rien n'est livré sans preuve.
 *
 * La faille que ces tests ferment : le montage est composé DANS le navigateur
 * et téléversé directement dans MinIO. Le serveur ne voyait qu'une
 * autorisation d'écriture, une URL et un nombre — tous fournis par le client.
 * Un `curl` pouvait enchaîner les trois et se faire livrer sans rien produire.
 *
 * Ces tests APPELLENT les routes. Grepper ne suffirait pas : la vérification
 * pourrait être présente, importée, et placée APRÈS la confirmation.
 *
 * L'atomicité de la transition et du débit est prouvée ailleurs, sur un vrai
 * PostgreSQL (`tests-pg/rendus.pg.test.ts`). Ici, on prouve que le serveur
 * refuse de confirmer sans avoir VU l'objet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CHAMPS_INTERDITS_RENDU, OPERATIONS, BUCKET_RENDUS } from '@/lib/rendus/service';
import { TAILLE_MINIMALE, TYPES_AUTORISES } from '@/lib/storage/verifier-objet';

// Le client MinIO refuse de se construire sans secret : sans cette variable,
// TOUTES les vérifications retomberaient sur « stockage injoignable » et les
// tests passeraient à côté de ce qu'ils prétendent vérifier.
process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'secret-de-test';

const authMock = vi.fn();

/** Ce que le serveur a réellement écrit ou demandé. */
const inserts: Array<{ table: string; valeurs: Record<string, unknown> }> = [];
const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
let tarif: { credits: number } | null = { credits: 10 };
let rendu: Record<string, unknown> | null = null;
let reponseRpc: unknown = null;

/** Ce que `statObject` répondra — c'est LA preuve. */
let objet: { size: number; metaData: Record<string, string> } | null = null;
let objetLeve: Error | null = null;
const statAppels: Array<{ bucket: string; cle: string }> = [];

vi.mock('@/lib/storage/minio-client', () => ({
  /**
   * Aucun endpoint public configure : la cible d'envoi est le relais
   * same-origin. C'est le cas par defaut, et celui de la production au
   * moment ou Chrome a bloque l'envoi.
   */
  signeurPublic: () => null,
  clientMinio: () => ({
    async statObject(bucket: string, cle: string) {
      statAppels.push({ bucket, cle });
      if (objetLeve) throw objetLeve;
      if (!objet) throw new Error('NoSuchKey: object does not exist');
      return objet;
    },
  }),
}));

function makeQuery(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    insert: (valeurs: Record<string, unknown>) => { inserts.push({ table, valeurs }); return api; },
    update: () => api,
    maybeSingle: async () => ({
      data: table === 'tarifs_rendu' ? tarif : rendu,
      error: null,
    }),
    single: async () => {
      const dernier = inserts.at(-1)?.valeurs ?? {};
      return {
        data: {
          id: dernier.id, bucket: dernier.bucket, cle_objet: dernier.cle_objet,
          cout: dernier.cout, format: dernier.format, operation: dernier.operation,
        },
        error: null,
      };
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return { data: reponseRpc, error: null };
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async (p: string) => ({
          data: { signedUrl: `https://minio.test/put/${p}`, token: '' }, error: null,
        }),
      }),
    },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { POST: CREER } = await import('@/app/api/render/jobs/route');
const { POST: CONFIRMER } = await import('@/app/api/render/jobs/[id]/confirm/route');
const { POST: ANNULER } = await import('@/app/api/render/jobs/[id]/cancel/route');

const creer = async (body: unknown) => {
  const res = await CREER({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};
const confirmer = async (id = 'job-1') => {
  const res = await CONFIRMER({} as never, { params: { id } } as never);
  return { status: res.status, body: await res.json() };
};
const annuler = async (id = 'job-1') => {
  const res = await ANNULER({ json: async () => ({ motif: 'test' }) } as never, { params: { id } } as never);
  return { status: res.status, body: await res.json() };
};

const OBJET_VALIDE = { size: 120_000, metaData: { 'content-type': 'video/webm' } };

beforeEach(() => {
  inserts.length = 0;
  rpcAppels.length = 0;
  statAppels.length = 0;
  tarif = { credits: 10 };
  rendu = { id: 'job-1', user_id: 'moi', operation: 'apercu', format: 'reel', cout: 10, bucket: 'media', cle_objet: 'moi/rendus/job-1.webm', etat: 'reserved' };
  objet = OBJET_VALIDE;
  objetLeve = null;
  reponseRpc = [{ ok: true, etat: 'confirmed', solde: 90, deja_confirme: false, motif: null }];
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
});

describe('1 & 3. Le serveur crée la tentative et attribue la clé', () => {
  it('rend un identifiant et une cible de téléversement', async () => {
    const r = await creer({ operation: 'apercu', format: 'reel' });
    expect(r.status).toBe(200);
    expect(r.body.jobId).toBeTruthy();
    // Sans endpoint public, la cible est le relais de l'application : une
    // URL RELATIVE, donc chiffrée par l'origine de la page. Elle signait
    // auparavant sur `http://studiio-minio:9000`, que Chrome bloquait.
    expect(r.body.uploadUrl).toBe(`/api/render/jobs/${r.body.jobId}/upload`);
    expect(r.body.uploadMode).toBe('relais');
    expect(JSON.stringify(r.body)).not.toContain('studiio-minio');
  });

  it('la clé est dérivée du serveur et reste dans le périmètre de l utilisateur', async () => {
    await creer({ operation: 'apercu', format: 'reel' });
    const v = inserts.find((i) => i.table === 'rendus')!.valeurs;
    expect(String(v.cle_objet)).toMatch(/^moi\/rendus\/[0-9a-f-]{36}\.webm$/);
    expect(v.bucket).toBe(BUCKET_RENDUS);
  });

  it('2. le coût vient du tarif serveur, l utilisateur de la session', async () => {
    tarif = { credits: 15 };
    await creer({ operation: 'bureau', format: 'tv' });
    const v = inserts.find((i) => i.table === 'rendus')!.valeurs;
    expect(v.cout).toBe(15);
    expect(v.user_id).toBe('moi');
    expect(v.etat).toBeUndefined(); // le défaut SQL décide
  });

  it('réserver ne débite rien', async () => {
    await creer({ operation: 'apercu', format: 'reel' });
    expect(rpcAppels).toEqual([]);
    expect(inserts.some((i) => i.table === 'credit_transactions')).toBe(false);
  });

  CHAMPS_INTERDITS_RENDU.forEach((champ) => {
    it(`14. refuse « ${champ} » depuis le client`, async () => {
      const r = await creer({ operation: 'apercu', format: 'reel', [champ]: 'x' });
      expect(r.status).toBe(422);
      expect(inserts).toEqual([]);
    });
  });

  it('refuse une opération hors liste', async () => {
    expect((await creer({ operation: 'gratuit', format: 'reel' })).status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it('refuse un format hors liste', async () => {
    expect((await creer({ operation: 'apercu', format: 'carre' })).status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it('les cinq opérations facturées sont déclarées', () => {
    expect([...OPERATIONS]).toEqual(
      ['apercu', 'bureau', 'calendrier', 'avance-brouillon', 'avance-bureau'],
    );
  });

  it('401 sans session, sans rien écrire', async () => {
    authMock.mockResolvedValue(null);
    expect((await creer({ operation: 'apercu', format: 'reel' })).status).toBe(401);
    expect(inserts).toEqual([]);
  });
});

describe('6. La preuve : le serveur regarde l objet lui-même', () => {
  it('interroge LA clé de la tentative, pas une URL du client', async () => {
    await confirmer();
    expect(statAppels).toEqual([{ bucket: 'media', cle: 'moi/rendus/job-1.webm' }]);
  });

  it('confirme et débite quand l objet est là', async () => {
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(rpcAppels[0].nom).toBe('confirmer_rendu');
    expect(rpcAppels[0].args.p_taille).toBe(120_000);
  });

  it('ne transmet aucun montant à la base', async () => {
    await confirmer();
    expect(Object.keys(rpcAppels[0].args).sort())
      .toEqual(['p_content_type', 'p_rendu_id', 'p_taille', 'p_user_id']);
  });
});

describe('4 & 5. Objet absent ou invalide — aucun débit', () => {
  it('objet absent → 422, tentative close, aucune confirmation', async () => {
    objet = null;
    const r = await confirmer();
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('objet_absent');
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
    expect(rpcAppels.some((a) => a.nom === 'clore_rendu')).toBe(true);
  });

  it('objet trop petit → aucun débit', async () => {
    objet = { size: TAILLE_MINIMALE - 1, metaData: { 'content-type': 'video/webm' } };
    const r = await confirmer();
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('trop_petit');
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
  });

  it('objet vide → aucun débit', async () => {
    objet = { size: 0, metaData: { 'content-type': 'video/webm' } };
    expect((await confirmer()).body.motif).toBe('trop_petit');
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
  });

  it('type refusé → aucun débit', async () => {
    objet = { size: 500_000, metaData: { 'content-type': 'text/html' } };
    const r = await confirmer();
    expect(r.body.motif).toBe('type_refuse');
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
  });

  it('les types acceptés restent une liste courte', () => {
    expect([...TYPES_AUTORISES]).toEqual(
      ['video/webm', 'video/mp4', 'video/quicktime', 'application/octet-stream'],
    );
  });

  it('stockage injoignable → 503, tentative LAISSÉE ouverte', async () => {
    objetLeve = new Error('ECONNREFUSED 10.0.0.4:9000');
    const r = await confirmer();
    expect(r.status).toBe(503);
    // La panne est de notre côté : on ne clôt pas la tentative de l'utilisateur.
    expect(rpcAppels.some((a) => a.nom === 'clore_rendu')).toBe(false);
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
  });

  it('une clé hors périmètre est refusée sans même interroger le stockage', async () => {
    rendu = { ...(rendu as object), cle_objet: 'quelquun-dautre/rendus/x.webm' } as Record<string, unknown>;
    const r = await confirmer();
    expect(r.body.motif).toBe('cle_hors_perimetre');
    expect(statAppels).toEqual([]);
    expect(rpcAppels.filter((a) => a.nom === 'confirmer_rendu')).toEqual([]);
  });
});

describe('8 & 11. Rejeu et double clic', () => {
  it('une tentative déjà confirmée ne re-vérifie ni ne re-débite', async () => {
    rendu = { ...(rendu as object), etat: 'confirmed' } as Record<string, unknown>;
    reponseRpc = [{ ok: true, etat: 'confirmed', solde: 90, deja_confirme: true, motif: null }];
    const r = await confirmer();
    expect(r.status).toBe(200);
    expect(r.body.dejaConfirme).toBe(true);
    // Le point : aucun appel au stockage, donc aucun coût, et surtout aucune
    // possibilité de re-débiter.
    expect(statAppels).toEqual([]);
  });
});

describe('9. Tentative d autrui', () => {
  it('404 sans rien vérifier ni débiter', async () => {
    rendu = null; // la requête filtre déjà sur user_id
    const r = await confirmer('job-dautrui');
    expect(r.status).toBe(404);
    expect(statAppels).toEqual([]);
    expect(rpcAppels).toEqual([]);
  });

  it('401 sans session', async () => {
    authMock.mockResolvedValue(null);
    expect((await confirmer()).status).toBe(401);
    expect(statAppels).toEqual([]);
  });
});

describe('10. Abandon — aucun débit', () => {
  it('annuler passe par clore_rendu, jamais par un débit', async () => {
    reponseRpc = [{ ok: true, etat: 'cancelled' }];
    const r = await annuler();
    expect(r.status).toBe(200);
    expect(rpcAppels[0].nom).toBe('clore_rendu');
    expect(rpcAppels[0].args.p_etat).toBe('cancelled');
    expect(rpcAppels.some((a) => a.nom === 'confirmer_rendu')).toBe(false);
  });

  it('annuler une tentative déjà close répond 409', async () => {
    reponseRpc = [{ ok: false, etat: 'confirmed' }];
    expect((await annuler()).status).toBe(409);
  });
});

describe('13 & 16. Les quatre parcours passent par le contrat, et livrent après', () => {
  const wizard = readSource('src/app/dashboard/creer/AssistantWizard.tsx');
  const avance = readSource('src/app/dashboard/creer-avance/page.tsx');

  it("l'Assistant fait passer aperçu et bureau par le contrat", () => {
    expect(wizard).toContain("operation: destination === 'apercu' ? 'apercu' : 'bureau',");
  });

  it("l'éditeur avancé fait passer ses deux exports par le contrat", () => {
    expect(avance).toContain("composerEtFacturer('avance-brouillon', renderFormat, {");
    expect(avance).toContain("composerEtFacturer('avance-bureau', renderFormat, {");
    expect(avance).not.toContain('composeAndUpload(');
  });

  it('16. rien n est livré avant la confirmation', () => {
    const garde = wizard.indexOf('if (!livraison.ok || !livraison.blob) {');
    expect(garde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(wizard.indexOf('setPreviewRender(composed.blob, signature, vignetteApercu, renduConfirme);'));
    expect(garde).toBeLessThan(wizard.indexOf('blobsBureau.push('));
  });

  it('14. aucun ancien appel avec un montant client ne subsiste', () => {
    for (const source of [wizard, avance]) {
      expect(source).not.toContain("JSON.stringify({ cost");
      expect(source).not.toContain('cost, reason:');
    }
  });
});

describe("16. L'orchestrateur ne livre RIEN sans confirmation", () => {
  // Ces tests appellent `rendreEtFacturer`. Une version anterieure de ce
  // fichier se contentait de verifier l'ORDRE des lignes dans le source du
  // wizard : remplacer la garde de confirmation par `if (false)` passait
  // alors au vert, et le montage etait livre sans que le serveur ait rien vu.
  const appels: string[] = [];

  const poserFetch = (confirmOk: boolean) => {
    appels.length = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      appels.push(`${String(init?.method ?? 'GET')} ${u}`);
      if (u === '/api/render/jobs') {
        return { ok: true, json: async () => ({
          ok: true, jobId: 'j1', uploadUrl: 'https://minio.test/put/j1',
          publicUrl: 'https://cdn.test/j1.webm', cout: 10,
        }) } as Response;
      }
      if (u.includes('/confirm')) {
        return { ok: confirmOk, json: async () => ({ ok: confirmOk, motif: confirmOk ? null : 'objet_absent', balance: 90 }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }) as unknown as typeof fetch;
  };

  const blob = () => new Blob(['x'.repeat(50_000)], { type: 'video/webm' });

  it('livre le montage quand le serveur confirme', async () => {
    poserFetch(true);
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(true);
    expect(r.blob).toBeTruthy();
    expect(r.url).toBe('https://cdn.test/j1.webm');
  });

  it('ne livre RIEN quand le serveur refuse — et le dit', async () => {
    poserFetch(false);
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(false);
    expect(r.blob).toBeUndefined();
    expect(r.url).toBeUndefined();
    expect(r.motif).toBe('objet_absent');
  });

  it("l'ordre est tenu : ouvrir, téléverser, confirmer — puis livrer", async () => {
    poserFetch(true);
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    await rendreEtFacturer({ operation: 'apercu', format: 'reel', composer: async () => blob() });
    expect(appels[0]).toBe('POST /api/render/jobs');
    expect(appels[1]).toBe('PUT https://minio.test/put/j1');
    expect(appels[2]).toContain('/confirm');
  });

  it('une composition qui échoue ferme la tentative et ne téléverse rien', async () => {
    poserFetch(true);
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({
      operation: 'apercu', format: 'reel',
      composer: async () => { throw new Error('canvas mort'); },
    });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('composition');
    expect(appels.some((a) => a.startsWith('PUT'))).toBe(false);
    expect(appels.some((a) => a.includes('/cancel'))).toBe(true);
    expect(appels.some((a) => a.includes('/confirm'))).toBe(false);
  });

  it('un téléversement qui échoue ferme la tentative et ne confirme JAMAIS', async () => {
    // Sans cette assertion, supprimer la gestion d'echec du PUT passait
    // inapercu : le code enchainait sur la confirmation d'un objet qui
    // n'etait jamais arrive.
    appels.length = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      appels.push(`${String(init?.method ?? 'GET')} ${u}`);
      if (u === '/api/render/jobs') {
        return { ok: true, json: async () => ({
          ok: true, jobId: 'j1', uploadUrl: 'https://minio.test/put/j1',
          publicUrl: 'https://cdn.test/j1.webm', cout: 10,
        }) } as Response;
      }
      if (u.startsWith('https://minio.test/put/')) {
        return { ok: false, status: 403, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }) as unknown as typeof fetch;

    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({ operation: 'bureau', format: 'reel', composer: async () => blob() });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('televersement');
    expect(r.blob).toBeUndefined();
    expect(appels.some((a) => a.includes('/confirm'))).toBe(false);
    expect(appels.some((a) => a.includes('/cancel'))).toBe(true);
  });

  it('un montage vide ne part pas et ne facture rien', async () => {
    poserFetch(true);
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    const r = await rendreEtFacturer({
      operation: 'bureau', format: 'reel',
      composer: async () => new Blob([], { type: 'video/webm' }),
    });
    expect(r.ok).toBe(false);
    expect(appels.some((a) => a.includes('/confirm'))).toBe(false);
  });

  it('aucun montant, aucune identité ne partent à la réservation', async () => {
    poserFetch(true);
    const corps: string[] = [];
    const vraiFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => {
      if (String(u) === '/api/render/jobs') corps.push(String(init?.body));
      return (vraiFetch as unknown as (a: unknown, b?: RequestInit) => Promise<Response>)(u, init);
    }) as unknown as typeof fetch;
    const { rendreEtFacturer } = await import('@/lib/rendus/client');
    await rendreEtFacturer({ operation: 'apercu', format: 'tv', composer: async () => blob() });
    expect(corps[0]).toBe(JSON.stringify({ operation: 'apercu', format: 'tv' }));
  });
});

describe('17 & 18. Le reste du système est intact', () => {
  it('le mode Série reste fermé', async () => {
    const { BATCH_SERIE_DISPONIBLE } = await import('@/lib/creer/batchDisponible');
    expect(BATCH_SERIE_DISPONIBLE).toBe(false);
  });

  it('/api/render/batch reste désactivée', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('15. les prix restent ceux du produit', async () => {
    const { RENDER_COSTS } = await import('@/lib/stripe/constants');
    expect(RENDER_COSTS).toEqual({ reel: 10, tv: 15 });
  });
});

function readSource(chemin: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs');
  return readFileSync(chemin, 'utf-8');
}
