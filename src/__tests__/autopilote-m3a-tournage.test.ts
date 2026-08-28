/**
 * M3-A — Session de tournage et rushes indexés.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE SOCLE REMPLACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'Autopilote gardait ses rushes dans `autopilot_config.rush_urls`, un
 * `text[]`. Ça suffit à piocher une vidéo au hasard, et à rien d'autre : pas
 * d'identité, pas d'ordre stable, pas de taille ni de type, et surtout aucune
 * notion de TOURNAGE — tous les rushes d'un compte dans le même sac.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les VRAIS gestionnaires de route sont appelés. Ce qui compte n'est pas
 * qu'une fonction existe, c'est ce que la route répond : à qui elle donne
 * accès, ce qu'elle refuse du client, et ce qu'elle exige du stockage avant
 * d'enregistrer quoi que ce soit.
 *
 * Aucun rendu, aucun crédit, aucune publication n'est touché — c'est vérifié,
 * pas supposé.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STATUTS_SESSION, ETATS_RUSH, CHAMPS_INTERDITS_TOURNAGE,
  titreValide, contexteValide, metadataValide,
  statutSessionValide, etatRushValide,
  sessionDepuisLigne, rushDepuisLigne,
} from '@/lib/autopilot/tournage/contrat';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** L'objet que le stockage prétend avoir — ou pas. */
let objetStocke: { size: number; metaData: Record<string, string> } | null;
let objetLeve: Error | null = null;
const statAppels: Array<{ bucket: string; cle: string }> = [];
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    async statObject(bucket: string, cle: string) {
      statAppels.push({ bucket, cle });
      if (objetLeve) throw objetLeve;
      if (!objetStocke) throw new Error('NoSuchKey: object does not exist');
      return objetStocke;
    },
  }),
}));

/**
 * Une base minuscule, en mémoire, avec le filtrage que fait PostgREST.
 *
 * Les `.eq()` sont RÉELLEMENT appliqués : c'est ce qui permet de vérifier
 * qu'une session d'autrui est introuvable, et non « trouvée puis refusée par
 * un `if` » — la nuance est tout l'intérêt du test.
 */
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
const insertions: Array<{ table: string; valeurs: Ligne }> = [];

function requete(table: string) {
  let filtres: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.colonne] ?? 0); const y = Number(b[tri!.colonne] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const erreurTable = { code: '42P01', message: 'relation does not exist' };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => {
      aInserer = valeurs; return api;
    },
    maybeSingle: async () => {
      if (tableAbsente === table) return { data: null, error: erreurTable };
      if (aInserer) {
        const ligne = {
          id: `${table}-${(tables[table] ?? []).length + 1}`,
          created_at: '2026-08-31T10:00:00Z',
          updated_at: '2026-08-31T10:00:00Z',
          statut: 'ouverte',
          metadata: {},
          ...aInserer,
        };
        insertions.push({ table, valeurs: aInserer });
        tables[table] = [...(tables[table] ?? []), ligne];
        return { data: ligne, error: null };
      }
      const l = lignes();
      return { data: l && l.length ? l[0] : null, error: null };
    },
    then: (resoudre: (v: unknown) => unknown) => {
      const l = lignes();
      return resoudre(l === null ? { data: null, error: erreurTable } : { data: l, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

const { GET: LISTER, POST: CREER } = await import('@/app/api/autopilot/sessions/route');
const { GET: LIRE } = await import('@/app/api/autopilot/sessions/[id]/route');
const { GET: LISTER_RUSHES, POST: INDEXER } =
  await import('@/app/api/autopilot/sessions/[id]/rushes/route');

const creer = async (body: unknown) => {
  const res = await CREER({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};
const lister = async () => {
  const res = await LISTER({} as never);
  return { status: res.status, body: await res.json() };
};
const lire = async (id: string) => {
  const res = await LIRE({} as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};
const indexer = async (id: string, body: unknown) => {
  const res = await INDEXER({ json: async () => body } as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};
const listerRushes = async (id: string) => {
  const res = await LISTER_RUSHES({} as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};

const OBJET_VALIDE = { size: 5_000_000, metaData: { 'content-type': 'video/mp4' } };

beforeEach(() => {
  statAppels.length = 0;
  insertions.length = 0;
  tableAbsente = null;
  objetLeve = null;
  objetStocke = OBJET_VALIDE;
  tables = {
    shoot_sessions: [
      {
        id: 's-a', user_id: 'A', titre: 'Cours du samedi', statut: 'ouverte',
        contexte: null, metadata: {}, created_at: '2026-08-30T10:00:00Z',
        updated_at: '2026-08-30T10:00:00Z',
      },
      {
        id: 's-b', user_id: 'B', titre: 'Tournage de B', statut: 'ouverte',
        contexte: null, metadata: {}, created_at: '2026-08-30T11:00:00Z',
        updated_at: '2026-08-30T11:00:00Z',
      },
    ],
    rushes: [],
  };
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'A' } });
});

// ────────────────────────────────────────────────────────────────────────────
// Le contrat, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('Le contrat est déclaré une seule fois', () => {
  it('les états sont ceux des contraintes CHECK de la migration', () => {
    expect(STATUTS_SESSION).toEqual(['ouverte', 'fermee', 'archivee']);
    expect(ETATS_RUSH).toEqual(['indexe', 'verifie', 'absent']);
  });

  it('un état inconnu est refusé, pas toléré', () => {
    for (const v of ['en_cours', '', null, 42, 'OUVERTE']) {
      expect(statutSessionValide(v), String(v)).toBe(false);
    }
    for (const v of ['ok', 'pret', undefined, 0]) {
      expect(etatRushValide(v), String(v)).toBe(false);
    }
  });

  it('un titre vide, blanc ou trop long est refusé', () => {
    expect(titreValide('  Cours  ')).toBe('Cours');
    for (const v of ['', '   ', '\t', null, 42, 'x'.repeat(201)]) {
      expect(titreValide(v), JSON.stringify(v)).toBeNull();
    }
    expect(titreValide('x'.repeat(200))).toHaveLength(200);
  });

  it('un contexte absent ou vide devient `null`, jamais une chaîne vide', () => {
    expect(contexteValide(undefined)).toEqual({ ok: true, valeur: null });
    expect(contexteValide('   ')).toEqual({ ok: true, valeur: null });
    expect(contexteValide('x'.repeat(2001)).ok).toBe(false);
  });

  it('un tableau n est pas un objet de métadonnées', () => {
    expect(metadataValide([]).ok).toBe(false);
    expect(metadataValide({ a: 1 })).toEqual({ ok: true, valeur: { a: 1 } });
    expect(metadataValide(undefined)).toEqual({ ok: true, valeur: {} });
  });

  it('une durée inconnue reste `null` — jamais zéro', () => {
    const r = rushDepuisLigne({ id: 'r', shoot_session_id: 's', user_id: 'A', duree_secondes: null });
    expect(r.dureeSecondes).toBeNull();
    expect(r.dureeSecondes).not.toBe(0);
  });

  it('une ligne aux champs inattendus retombe sur des valeurs sûres', () => {
    const s = sessionDepuisLigne({ id: 's', user_id: 'A', statut: 'inconnu', metadata: [] });
    expect(s.statut).toBe('ouverte');
    expect(s.metadata).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sessions
// ────────────────────────────────────────────────────────────────────────────

describe('Création et lecture des sessions', () => {
  it('A crée une session, et le serveur pose l identité', async () => {
    const r = await creer({ titre: 'Interview Marie', contexte: 'studio' });
    expect(r.status).toBe(201);
    expect(r.body.session.titre).toBe('Interview Marie');
    expect(r.body.session.userId).toBe('A');
    expect(insertions[0].valeurs.user_id).toBe('A');
  });

  it('A ne voit QUE ses sessions', async () => {
    const r = await lister();
    expect(r.status).toBe(200);
    expect(r.body.sessions).toHaveLength(1);
    expect(r.body.sessions[0].id).toBe('s-a');
  });

  it('B ne voit pas celles de A', async () => {
    authMock.mockResolvedValue({ user: { id: 'B' } });
    const r = await lister();
    expect(r.body.sessions.map((s: { id: string }) => s.id)).toEqual(['s-b']);
  });

  it('B ne peut pas LIRE la session de A — introuvable, pas interdite', async () => {
    authMock.mockResolvedValue({ user: { id: 'B' } });
    const r = await lire('s-a');
    // 404 et non 403 : un 403 confirmerait que la session existe.
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('Cours du samedi');
  });

  it('A lit bien la sienne', async () => {
    const r = await lire('s-a');
    expect(r.status).toBe(200);
    expect(r.body.session.titre).toBe('Cours du samedi');
  });

  it('sans session authentifiée, rien n est lisible ni créable', async () => {
    authMock.mockResolvedValue(null);
    expect((await lister()).status).toBe(401);
    expect((await lire('s-a')).status).toBe(401);
    expect((await creer({ titre: 'x' })).status).toBe(401);
    expect(insertions).toEqual([]);
  });
});

describe('Ce que le client n a pas le droit de dire', () => {
  CHAMPS_INTERDITS_TOURNAGE.forEach((champ) => {
    it(`« ${champ} » est refusé en 422, pas ignoré`, async () => {
      const r = await creer({ titre: 'Essai', [champ]: 'peu importe' });
      expect(r.status).toBe(422);
      expect(r.body.error).toContain(champ);
      expect(insertions).toEqual([]);
    });
  });

  it('un user_id du navigateur ne remplace jamais celui de la session', async () => {
    const r = await creer({ titre: 'Essai', user_id: 'B' });
    expect(r.status).toBe(422);
    // Et même refusée, la tentative n'a rien écrit.
    expect(insertions).toEqual([]);
  });

  it('un corps non-objet est refusé', async () => {
    for (const body of [[], 'texte', 42, null]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await creer(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('un titre manquant est refusé', async () => {
    expect((await creer({ contexte: 'sans titre' })).status).toBe(422);
    expect((await creer({ titre: '   ' })).status).toBe(422);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Rushes
// ────────────────────────────────────────────────────────────────────────────

describe('Indexation d un rush', () => {
  const RUSH = { bucket: 'media', path: 'A/rushes/plan-01.mp4', nomOrigine: 'plan-01.mp4' };

  it('le fichier est VÉRIFIÉ dans le stockage avant d être indexé', async () => {
    const r = await indexer('s-a', RUSH);
    expect(r.status).toBe(201);
    expect(statAppels).toEqual([{ bucket: 'media', cle: 'A/rushes/plan-01.mp4' }]);
  });

  it('le rush porte la CLÉ du stockage, pas une URL', async () => {
    const r = await indexer('s-a', RUSH);
    expect(r.body.rush.bucket).toBe('media');
    expect(r.body.rush.cleObjet).toBe('A/rushes/plan-01.mp4');
    expect(JSON.stringify(r.body.rush)).not.toContain('http');
  });

  it('la taille et le type viennent du STOCKAGE, pas du navigateur', async () => {
    const r = await indexer('s-a', { ...RUSH, tailleOctets: 42, contentType: 'video/mensonge' });
    expect(r.status).toBe(201);
    expect(r.body.rush.tailleOctets).toBe(5_000_000);
    expect(r.body.rush.contentType).toBe('video/mp4');
  });

  it('son état est « verifie » — le serveur a vu le fichier', async () => {
    const r = await indexer('s-a', RUSH);
    expect(r.body.rush.etat).toBe('verifie');
  });

  it('sa durée est inconnue à l ingestion, donc `null`', async () => {
    const r = await indexer('s-a', RUSH);
    expect(r.body.rush.dureeSecondes).toBeNull();
  });

  it('un objet absent du stockage n est PAS indexé', async () => {
    objetStocke = null;
    const r = await indexer('s-a', RUSH);
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('objet_absent');
    expect(insertions.filter((i) => i.table === 'rushes')).toEqual([]);
  });

  it('une clé hors du périmètre de l utilisateur est refusée', async () => {
    const r = await indexer('s-a', { ...RUSH, path: 'B/rushes/vole.mp4' });
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('cle_hors_perimetre');
    expect(insertions.filter((i) => i.table === 'rushes')).toEqual([]);
  });

  it('un stockage injoignable rend 503, pas 422 — la panne est de notre côté', async () => {
    objetLeve = new Error('connexion refusee');
    const r = await indexer('s-a', RUSH);
    expect(r.status).toBe(503);
    expect(r.body.motif).toBe('stockage_injoignable');
  });

  it('B ne peut pas indexer dans la session de A', async () => {
    authMock.mockResolvedValue({ user: { id: 'B' } });
    const r = await indexer('s-a', { bucket: 'media', path: 'B/rushes/x.mp4' });
    expect(r.status).toBe(404);
    expect(statAppels).toEqual([]);
    expect(insertions.filter((i) => i.table === 'rushes')).toEqual([]);
  });

  it('`bucket` et `path` sont requis', async () => {
    expect((await indexer('s-a', {})).status).toBe(422);
    expect((await indexer('s-a', { bucket: 'media' })).status).toBe(422);
    expect((await indexer('s-a', { path: 'A/x.mp4' })).status).toBe(422);
  });
});

describe('L ordre des rushes est décidé par le serveur', () => {
  it('les rangs se suivent, 0 puis 1 puis 2', async () => {
    for (const n of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await indexer('s-a', { bucket: 'media', path: `A/rushes/plan-0${n}.mp4` });
    }
    const rangs = insertions
      .filter((i) => i.table === 'rushes')
      .map((i) => i.valeurs.rang);
    expect(rangs).toEqual([0, 1, 2]);
  });

  it('un rang envoyé par le client est refusé', async () => {
    const r = await indexer('s-a', { bucket: 'media', path: 'A/x.mp4', rang: 99 });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain('rang');
  });

  it('la liste rend les rushes dans l ordre', async () => {
    for (const n of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await indexer('s-a', { bucket: 'media', path: `A/rushes/plan-0${n}.mp4` });
    }
    const r = await listerRushes('s-a');
    expect(r.status).toBe(200);
    expect(r.body.rushes.map((x: { rang: number }) => x.rang)).toEqual([0, 1, 2]);
  });

  it('une session sans rush rend une liste vide, pas une erreur', async () => {
    const r = await listerRushes('s-a');
    expect(r.status).toBe(200);
    expect(r.body.rushes).toEqual([]);
  });

  it('B ne lit pas les rushes de la session de A', async () => {
    await indexer('s-a', { bucket: 'media', path: 'A/rushes/plan-01.mp4' });
    authMock.mockResolvedValue({ user: { id: 'B' } });
    const r = await listerRushes('s-a');
    // Introuvable, et non « liste vide » : une session vide et une session
    // d'autrui ne doivent pas se ressembler.
    expect(r.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La migration absente, et ce que ce lot ne touche pas
// ────────────────────────────────────────────────────────────────────────────

describe('Sans la migration, tout refuse proprement', () => {
  it('les routes rendent 503 en nommant le fichier à appliquer', async () => {
    tableAbsente = 'shoot_sessions';
    for (const r of [await lister(), await lire('s-a'), await creer({ titre: 'x' })]) {
      expect(r.status).toBe(503);
      expect(r.body.error).toContain('2026-08-31-shoot-sessions-rushes.sql');
    }
  });

  it('aucune écriture n est tentée dans ce cas', async () => {
    tableAbsente = 'shoot_sessions';
    await creer({ titre: 'x' });
    expect(insertions).toEqual([]);
  });
});

describe('M3-A ne touche à rien d autre', () => {
  it('aucun crédit, aucun rendu, aucune publication dans ces routes', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sources = [
      'src/app/api/autopilot/sessions/route.ts',
      'src/app/api/autopilot/sessions/[id]/route.ts',
      'src/app/api/autopilot/sessions/[id]/rushes/route.ts',
      'src/lib/autopilot/tournage/service.ts',
      'src/lib/autopilot/tournage/contrat.ts',
    ].map((f) => readFileSync(join(process.cwd(), f), 'utf-8')).join('\n');
    for (const interdit of [
      'deductCredits', 'debiter_credits', 'composerEtFacturer', 'composeAndUpload',
      'render_jobs', 'social/publish', 'BATCH_SERIE_MAX',
      // `rendus` est cherché comme TABLE — le mot apparaît légitimement dans
      // la prose des commentaires (« le socle de rendu », « les rendus »).
      "from('rendus')", 'public.rendus',
    ]) {
      expect(sources, interdit).not.toContain(interdit);
    }
  });

  it('le mode Série reste à 2 et /api/render/batch désactivée', async () => {
    const { BATCH_SERIE_MAX, BATCH_SERIE_DISPONIBLE } =
      await import('@/lib/creer/batchDisponible');
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_SERIE_DISPONIBLE).toBe(true);
    expect(BATCH_SERIE_MAX).toBe(2);
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('la reprise après échec reste fermée', async () => {
    const { repriseAutorisee } = await import('@/lib/creer/batchRun');
    expect(repriseAutorisee([]).autorisee).toBe(false);
  });

  it('aucun deuxième système d upload n est créé', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const service = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/tournage/service.ts'), 'utf-8',
    );
    // Il RÉUTILISE la vérification du socle de rendu plutôt que d'en écrire
    // une seconde, et ne signe aucune URL lui-même.
    expect(service).toContain("from '@/lib/storage/verifier-objet'");
    expect(service).not.toContain('presignedPutObject');
    expect(service).not.toContain('signed-url');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Rushes venus d'un volume externe — SSD, carte mémoire, clé USB
// ────────────────────────────────────────────────────────────────────────────

describe('Le fichier peut venir de n importe quel volume', () => {
  it('aucune copie locale, aucun chargement en mémoire dans le téléverseur', async () => {
    // L'exigence produit : quelqu'un dont le disque interne est plein doit
    // pouvoir envoyer 300 Go depuis une carte mémoire. Ce qui l'empêcherait,
    // ce serait un `arrayBuffer()` — qui matérialise TOUT le fichier en RAM.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(process.cwd(), 'src/lib/storage/uploadFile.ts'), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('arrayBuffer(');
    expect(code).not.toContain('readAsArrayBuffer');
    // Il envoie le `File`/`Blob` tel quel : le navigateur le lit paresseusement
    // depuis le volume d'origine.
    expect(code).toContain('xhr.send(');
    // Et découpe les gros fichiers par tranches, sans les matérialiser.
    expect(code).toContain('file.slice(');
  });

  it('le découpage couvre exactement le fichier, sans trou ni recouvrement', async () => {
    const { planParts, PART_SIZE } = await import('@/lib/storage/uploadFile');
    // 300 Go depuis une carte mémoire : le cas prioritaire.
    const taille = 300 * 1024 * 1024 * 1024;
    const parts = planParts(taille);
    expect(parts[0].start).toBe(0);
    expect(parts[parts.length - 1].end).toBe(taille);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i].start).toBe(parts[i - 1].end);
    }
    expect(parts.reduce((n, p) => n + (p.end - p.start), 0)).toBe(taille);
    expect(PART_SIZE).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it("l'écran ouvre le sélecteur du système, sans restreindre les volumes", async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(process.cwd(), 'src/components/creer/SessionsTournagePanel.tsx'), 'utf-8',
    );
    // Un `input type=file` ordinaire : c'est le sélecteur de l'OS, donc tout
    // volume monté. Il n'y a rien à écrire pour ça — et surtout rien qui
    // impose une copie préalable sur le disque interne.
    expect(src).toContain('type="file"');
    expect(src).toContain('multiple');
    expect(src).not.toContain('webkitdirectory');
    // Le téléversement passe par la fonction partagée, pas par un second
    // système.
    expect(src).toContain("from '@/lib/storage/uploadFile'");
    expect(src).not.toContain('presignedPutObject');
  });
});

describe('Débrancher le volume pendant l envoi ne crée jamais de faux rush', () => {
  it('objet absent : refus, et aucune ligne écrite', async () => {
    // Le morceau n'est jamais arrivé : le stockage n'a rien à cette clé.
    objetStocke = null;
    const r = await indexer('s-a', { bucket: 'media', path: 'A/rushes/coupe.mp4' });
    expect(r.status).toBe(422);
    expect(insertions.filter((i) => i.table === 'rushes')).toEqual([]);
  });

  it('objet tronqué : refus, et aucune ligne écrite', async () => {
    // Un envoi interrompu peut laisser un objet minuscule. Il est refusé
    // comme incomplet plutôt qu'indexé comme un rush.
    objetStocke = { size: 12, metaData: { 'content-type': 'video/mp4' } };
    const r = await indexer('s-a', { bucket: 'media', path: 'A/rushes/tronque.mp4' });
    expect(r.status).toBe(422);
    expect(r.body.motif).toBe('trop_petit');
    expect(insertions.filter((i) => i.table === 'rushes')).toEqual([]);
  });

  it("le client ne peut pas se déclarer ingéré : `etat` est refusé", async () => {
    const r = await indexer('s-a', {
      bucket: 'media', path: 'A/rushes/x.mp4', etat: 'verifie',
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toContain('etat');
  });

  it('après un refus, la liste ne contient toujours rien', async () => {
    objetStocke = null;
    await indexer('s-a', { bucket: 'media', path: 'A/rushes/coupe.mp4' });
    objetStocke = OBJET_VALIDE;
    const r = await listerRushes('s-a');
    expect(r.body.rushes).toEqual([]);
  });

  it('un envoi repris plus tard s indexe normalement', async () => {
    objetStocke = null;
    expect((await indexer('s-a', { bucket: 'media', path: 'A/rushes/repris.mp4' })).status).toBe(422);
    // L'utilisateur relance, le fichier arrive : rien ne bloque.
    objetStocke = OBJET_VALIDE;
    const r = await indexer('s-a', { bucket: 'media', path: 'A/rushes/repris.mp4' });
    expect(r.status).toBe(201);
    expect(r.body.rush.etat).toBe('verifie');
    expect(r.body.rush.rang).toBe(0);
  });
});
