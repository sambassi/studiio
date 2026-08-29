/**
 * M3-B2.1 — Les délais réseau de MinIO sur le chemin d'extraction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois appels MinIO du chemin d'extraction — `statObject`, la signature de
 * lecture, l'écriture d'une vignette — n'avaient AUCUN délai. Le client
 * `minio` n'en pose pas de lui-même, et `maxDuration` de Next est inerte sur
 * Coolify (`docs/infra.md`). Un stockage qui accepte la connexion puis se
 * tait bloquait donc l'analyse pour toujours : la place d'extraction — il n'y
 * en a qu'UNE — restait prise, et la ligne restait `en_cours`, état dont
 * l'index unique de M3-B1 interdit de sortir autrement qu'à la main.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST PROUVÉ, ET COMMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avec de VRAIS serveurs HTTP locaux, jamais un vrai MinIO, et avec le VRAI
 * paquet `minio` — pas une doublure. Une doublure de client ne prouverait que
 * sa propre programmation : la question posée ici est précisément ce que fait
 * le paquet réel quand personne ne lui répond.
 *
 * Deux serveurs suffisent :
 *
 *   • LE TROU NOIR : il accepte la connexion, enregistre la requête, et ne
 *     répond jamais. C'est le mode de panne qui n'était pas couvert.
 *   • LE STOCKAGE POLI : il répond comme MinIO à un `HEAD` et à un `PUT`.
 *     Il sert à vérifier qu'une opération normale n'a RIEN perdu.
 *
 * La preuve qui compte n'est pas « la promesse a rejeté » — un `Promise.race`
 * le ferait aussi, en laissant la socket ouverte et les octets continuer
 * d'arriver. C'est le serveur qui la donne : il observe la fermeture de SA
 * socket, côté distant, dans la fenêtre du délai. L'I/O est réellement
 * arrêtée, pas seulement cessée d'être attendue.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { Socket } from 'net';
import {
  clientMinio, signeurInterne, transportMinioBorne, RAISON_TIMEOUT_MINIO,
} from '@/lib/storage/minio-client';
import {
  TIMEOUT_MINIO_MS, TIMEOUT_SONDE_MS, TIMEOUT_VIGNETTE_MS,
  BUDGET_EXTRACTION_MS, BORNE_MINIO, VIGNETTES_MAX, masquerUrls,
} from '@/lib/autopilot/analyse/extraction';
import { RETRY_APRES_SECONDES } from '@/lib/autopilot/analyse/capacite';
import type { MoteurExtraction } from '@/lib/autopilot/analyse/moteur';

/**
 * Le délai employé par les tests de mécanisme.
 *
 * Court EXPRÈS. Ce qui se vérifie ici est que la borne COUPE, pas la valeur
 * qu'elle vaut en production — celle-là est vérifiée séparément, sur les
 * constantes. Un test qui attendrait dix secondes pour prouver la même chose
 * ne prouverait rien de plus et serait le premier qu'on désactiverait.
 */
const DELAI_TEST_MS = 300;

/** La marge accordée à l'ordonnanceur avant de crier au dépassement. */
const MARGE_MS = 1_500;

// ─────────────────────────────────────────────────────────────────────────
// Les deux serveurs
// ─────────────────────────────────────────────────────────────────────────

interface ServeurEspion {
  serveur: Server;
  port: number;
  /** Les requêtes reçues, chemin compris. */
  requetes: string[];
  /** Les sockets encore ouvertes, côté serveur. */
  ouvertes: Set<Socket>;
  /** Combien de sockets ont été fermées par le distant. */
  fermees: number;
  fermer(): Promise<void>;
}

async function demarrer(
  gestionnaire: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<ServeurEspion> {
  const serveur = createServer((req, res) => {
    espion.requetes.push(`${req.method} ${req.url}`);
    gestionnaire(req, res);
  });
  // ⚠️ L'objet est construit AVANT les écouteurs, et ceux-ci écrivent DEDANS.
  // Une copie (`{ ...espion }`) figerait `fermees` à sa valeur de départ : le
  // test aurait lu 0 quoi qu'il arrive, et aurait donc échoué à prouver la
  // seule chose qui compte ici.
  const espion: ServeurEspion = {
    serveur,
    port: 0,
    requetes: [],
    ouvertes: new Set<Socket>(),
    fermees: 0,
    async fermer() {
      for (const s of espion.ouvertes) s.destroy();
      await new Promise<void>((r) => serveur.close(() => r()));
    },
  };
  serveur.on('connection', (s: Socket) => {
    espion.ouvertes.add(s);
    s.on('close', () => { espion.ouvertes.delete(s); espion.fermees += 1; });
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', () => r()));
  espion.port = (serveur.address() as { port: number }).port;
  return espion;
}

/** Accepte, enregistre, et ne répond JAMAIS. */
let trouNoir: ServeurEspion;

/** Répond comme MinIO à un `HEAD` et à un `PUT`. */
let stockagePoli: ServeurEspion;

/** Ce que le stockage poli a reçu en écriture, par chemin. */
let ecritures: Record<string, number> = {};

function viserLeTrouNoir() {
  process.env.MINIO_ENDPOINT = '127.0.0.1';
  process.env.MINIO_PORT = String(trouNoir.port);
}

function viserLeStockagePoli() {
  process.env.MINIO_ENDPOINT = '127.0.0.1';
  process.env.MINIO_PORT = String(stockagePoli.port);
}

beforeAll(async () => {
  trouNoir = await demarrer(() => { /* le silence, c'est le sujet */ });
  stockagePoli = await demarrer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'content-length': '4242',
        'last-modified': new Date().toUTCString(),
        etag: '"abc"',
      });
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      let recus = 0;
      req.on('data', (c: Buffer) => { recus += c.length; });
      req.on('end', () => {
        ecritures[req.url ?? ''] = recus;
        res.writeHead(200, { etag: '"def"' });
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end('<?xml version="1.0"?><LocationConstraint>us-east-1</LocationConstraint>');
  });

  process.env.MINIO_USE_SSL = 'false';
  process.env.MINIO_SECRET_KEY = 'secret-de-test';
  process.env.MINIO_ACCESS_KEY = 'cle-de-test';
  process.env.MINIO_REGION = 'us-east-1';
});

afterAll(async () => {
  await trouNoir.fermer();
  await stockagePoli.fermer();
});

beforeEach(() => {
  trouNoir.requetes.length = 0;
  stockagePoli.requetes.length = 0;
  trouNoir.fermees = 0;
  stockagePoli.fermees = 0;
  ecritures = {};
});

/** Mesure la durée d'une promesse et attrape son échec. */
async function chronometrer<T>(f: () => Promise<T>): Promise<{ ms: number; erreur: Error | null }> {
  const t0 = Date.now();
  try {
    await f();
    return { ms: Date.now() - t0, erreur: null };
  } catch (e: unknown) {
    return { ms: Date.now() - t0, erreur: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ═════════════════════════════════════════════════════════════════════════
describe('Un stockage muet ne bloque plus : la borne COUPE', () => {
  it('`statObject` bloqué rend la main dans le délai, et pas au bout d’un temps infini', async () => {
    viserLeTrouNoir();
    const { ms, erreur } = await chronometrer(
      () => clientMinio({ timeoutMs: DELAI_TEST_MS }).statObject('media', 'A/rush/plan.mp4'),
    );

    expect(erreur, 'la promesse échoue au lieu d’attendre').toBeTruthy();
    expect(erreur!.message).toContain(RAISON_TIMEOUT_MINIO);
    expect(ms).toBeGreaterThanOrEqual(DELAI_TEST_MS - 50);
    expect(ms).toBeLessThan(DELAI_TEST_MS + MARGE_MS);
    // La requête est bien PARTIE : sans cela, le test prouverait seulement
    // qu'on n'a pas su se connecter.
    expect(trouNoir.requetes.some((r) => r.startsWith('HEAD'))).toBe(true);
  });

  it('`presignedGetObject` bloqué rend la main dans le délai', async () => {
    // ⚠️ Le client construit un client SANS région exprès.
    //
    // `signeurInterne()` FIXE la région, et une région fixée supprime la seule
    // requête que `presignedGetObject` puisse faire (`GET ?location`) — le
    // test suivant le prouve. La borne existe pour le jour où cette région
    // disparaîtrait : c'est CE jour-là qu'on met à l'épreuve ici, avec le
    // transport réellement employé en production.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('minio');
    const client = new Client({
      endPoint: '127.0.0.1', port: trouNoir.port, useSSL: false,
      accessKey: 'cle-de-test', secretKey: 'secret-de-test',
      transport: transportMinioBorne(false, DELAI_TEST_MS),
      retryOptions: { disableRetry: true },
    });

    const { ms, erreur } = await chronometrer(
      () => client.presignedGetObject('media', 'A/rush/plan.mp4', 600) as Promise<string>,
    );

    expect(erreur).toBeTruthy();
    expect(erreur!.message).toContain(RAISON_TIMEOUT_MINIO);
    expect(ms).toBeLessThan(DELAI_TEST_MS + MARGE_MS);
    expect(trouNoir.requetes.some((r) => r.includes('location'))).toBe(true);
  });

  it('`putObject` d’une vignette bloqué rend la main dans le délai', async () => {
    viserLeTrouNoir();
    const vignette = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);
    const { ms, erreur } = await chronometrer(
      () => clientMinio({ timeoutMs: DELAI_TEST_MS }).putObject(
        'media', 'A/analyse/an-1/vignette-01.jpg', vignette, vignette.length,
        { 'Content-Type': 'image/jpeg' },
      ),
    );

    expect(erreur).toBeTruthy();
    expect(erreur!.message).toContain(RAISON_TIMEOUT_MINIO);
    expect(ms).toBeLessThan(DELAI_TEST_MS + MARGE_MS);
    expect(trouNoir.requetes.some((r) => r.startsWith('PUT'))).toBe(true);
  });

  it('SANS la borne, la même opération n’aboutit toujours pas — c’est bien elle qui coupe', async () => {
    viserLeTrouNoir();
    // Le témoin. Sans lui, les trois tests ci-dessus ne prouvent pas que
    // c'est la BORNE qui a rendu la main : un serveur qui refuse la connexion
    // les ferait passer tout autant.
    const client = clientMinio();
    const course = await Promise.race([
      client.statObject('media', 'A/rush/plan.mp4').then(() => 'repondu').catch(() => 'echoue'),
      new Promise<string>((r) => { setTimeout(() => r('toujours en attente'), DELAI_TEST_MS * 4); }),
    ]);
    expect(course).toBe('toujours en attente');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('La borne ARRÊTE l’I/O — elle ne cesse pas seulement de l’attendre', () => {
  it('la socket est fermée côté serveur, dans la fenêtre du délai', async () => {
    viserLeTrouNoir();
    const ouvertesAvant = trouNoir.ouvertes.size;

    await chronometrer(
      () => clientMinio({ timeoutMs: DELAI_TEST_MS }).statObject('media', 'A/rush/plan.mp4'),
    );

    // La fermeture arrive côté serveur au tour de boucle suivant.
    await new Promise((r) => { setTimeout(r, 200); });

    expect(trouNoir.fermees, 'le serveur a vu la connexion se fermer').toBeGreaterThanOrEqual(1);
    expect(trouNoir.ouvertes.size, 'aucune socket résiduelle').toBe(ouvertesAvant);
  });

  it('aucune requête résiduelle n’est émise après la coupure', async () => {
    viserLeTrouNoir();
    await chronometrer(
      () => clientMinio({ timeoutMs: DELAI_TEST_MS }).statObject('media', 'A/rush/plan.mp4'),
    );
    const apresCoupure = trouNoir.requetes.length;

    // Une reprise interne du SDK produirait une seconde requête ici : c'est
    // exactement ce que `disableRetry` interdit, et ce qui ferait mentir le
    // délai annoncé d'un facteur deux.
    await new Promise((r) => { setTimeout(r, DELAI_TEST_MS * 3); });

    expect(trouNoir.requetes.length).toBe(apresCoupure);
    expect(apresCoupure).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Une opération qui aboutit ne change pas de comportement', () => {
  it('`statObject` rend la taille, bien avant la borne', async () => {
    viserLeStockagePoli();
    const t0 = Date.now();
    const stat = await clientMinio(BORNE_MINIO).statObject('media', 'A/rush/plan.mp4');
    expect(Number(stat.size)).toBe(4242);
    expect(Date.now() - t0).toBeLessThan(TIMEOUT_MINIO_MS);
  });

  it('`putObject` écrit réellement les octets de la vignette', async () => {
    viserLeStockagePoli();
    const vignette = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33]);
    await clientMinio(BORNE_MINIO).putObject(
      'media', 'A/analyse/an-1/vignette-01.jpg', vignette, vignette.length,
      { 'Content-Type': 'image/jpeg' },
    );
    expect(ecritures['/media/A/analyse/an-1/vignette-01.jpg']).toBe(vignette.length);
  });

  it('`signeurInterne` signe sans AUCUNE requête réseau — il n’y a donc rien à borner', async () => {
    viserLeStockagePoli();
    const signeur = signeurInterne(BORNE_MINIO);
    expect(signeur).not.toBeNull();

    const url = await signeur!.presignedGetObject('media', 'A/rush/plan.mp4', 600);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(url).toContain('X-Amz-Signature');
    // La région est FIXÉE par `signeurInterne` : le SDK n'a personne à
    // interroger avant de signer. C'est ce fait, et non la borne, qui rend
    // cet appel insensible à un stockage muet aujourd'hui.
    expect(stockagePoli.requetes).toEqual([]);
  });

  it('un client construit SANS borne garde exactement son comportement d’avant', async () => {
    viserLeStockagePoli();
    // La rétro-compatibilité du reste de Studiio — relais de téléversement,
    // `verifier-objet`, rendus — tient à cette ligne : sans argument, rien
    // n'a changé. Un envoi de rush de vingt gigaoctets n'a pas les délais
    // d'un `statObject`.
    const stat = await clientMinio().statObject('media', 'A/rush/plan.mp4');
    expect(Number(stat.size)).toBe(4242);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('L’ordre des bornes, écrit noir sur blanc', () => {
  it('délai réseau MinIO < délai des processus ffprobe/ffmpeg', () => {
    expect(TIMEOUT_MINIO_MS).toBeLessThan(TIMEOUT_VIGNETTE_MS);
    expect(TIMEOUT_MINIO_MS).toBeLessThan(TIMEOUT_SONDE_MS);
  });

  it('délai des processus < budget global de l’analyse', () => {
    expect(TIMEOUT_VIGNETTE_MS).toBeLessThan(BUDGET_EXTRACTION_MS);
    expect(TIMEOUT_SONDE_MS).toBeLessThan(BUDGET_EXTRACTION_MS);
  });

  it('le budget global reste sous ce que le serveur annonce à l’appelant', () => {
    // `RETRY_APRES_SECONDES` est l'en-tête `Retry-After` d'un refus pour
    // cause de place occupée. Si le pire cas du moteur le dépassait, le
    // client reviendrait pile pour se faire refuser de nouveau.
    expect(BUDGET_EXTRACTION_MS).toBeLessThanOrEqual(RETRY_APRES_SECONDES * 1000);
  });

  it('le budget est la SOMME des bornes, pas un nombre choisi à la main', () => {
    expect(BUDGET_EXTRACTION_MS).toBe(
      TIMEOUT_MINIO_MS * 2
      + TIMEOUT_SONDE_MS
      + VIGNETTES_MAX * (TIMEOUT_VIGNETTE_MS + TIMEOUT_MINIO_MS),
    );
  });

  it('la borne du module est bien celle des constantes', () => {
    expect(BORNE_MINIO).toEqual({ timeoutMs: TIMEOUT_MINIO_MS });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Les TROIS appels MinIO de l’extraction portent la borne', () => {
  /**
   * Le source SANS ses commentaires.
   *
   * Ce module se raconte abondamment, et il cite ses propres appels dans ses
   * commentaires (« `clientMinio()` lève sur une configuration incomplète »).
   * Chercher un appel nu dans le texte brut ferait échouer le contrôle sur
   * une phrase, pas sur du code — le pire des tests, celui qu'on désactive.
   */
  const SOURCE = readFileSync(
    join(process.cwd(), 'src/lib/autopilot/analyse/extraction.ts'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('aucun `clientMinio()` ni `signeurInterne()` nu ne subsiste', () => {
    // Un appel nu compilerait, passerait tous les autres tests, et
    // rétablirait silencieusement l'attente infinie sur le chemin qu'il
    // occupe. C'est le seul contrôle qui couvre les trois appels d'un coup,
    // y compris celui des vignettes, que seul un vrai ffmpeg atteint.
    expect(SOURCE).not.toMatch(/clientMinio\(\s*\)/);
    expect(SOURCE).not.toMatch(/signeurInterne\(\s*\)/);
  });

  it('les trois appels passent `BORNE_MINIO`', () => {
    const avecBorne = SOURCE.match(/(?:clientMinio|signeurInterne)\(BORNE_MINIO\)/g) ?? [];
    // Deux `clientMinio` — le sondage d'objet, l'écriture des vignettes — et
    // un `signeurInterne`.
    expect(avecBorne).toHaveLength(3);
  });

  it('`maxDuration` n’est plus présenté comme une protection', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts'), 'utf8',
    );
    // La valeur reste — elle redeviendrait vraie sur une plateforme qui
    // l'applique — mais le commentaire doit dire qu'elle ne borne rien ici.
    // 360 depuis M3-B4 : l'étape `visuel` s'ajoute dans la même requête.
    expect(route).toContain('export const maxDuration = 360');
    expect(route).toContain('NE PROTÈGE RIEN');
    expect(route).toContain('Coolify');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Rien de signé ne fuit dans un échec', () => {
  it('l’erreur de coupure ne contient ni hôte, ni chemin, ni signature', async () => {
    viserLeTrouNoir();
    const { erreur } = await chronometrer(
      () => clientMinio({ timeoutMs: DELAI_TEST_MS })
        .statObject('media', 'A/rush/plan.mp4'),
    );
    const texte = `${erreur!.message}\n${erreur!.stack ?? ''}`;
    expect(texte).not.toContain('X-Amz-Signature');
    expect(texte).not.toContain('A/rush/plan.mp4');
    expect(texte).not.toMatch(/https?:\/\//);
  });

  it('`masquerUrls` efface une URL signée entière, quoi qu’elle contienne', () => {
    const url = 'http://studiio-minio:9000/media/A/rush/plan.mp4'
      + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef';
    const masque = masquerUrls(`ffmpeg: cannot open ${url}`);
    expect(masque).not.toContain('X-Amz-Signature');
    expect(masque).not.toContain('studiio-minio');
    expect(masque).toContain('<url-masquee>');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// La preuve de bout en bout : la place est rendue, l'analyse finit `echouee`
// ═════════════════════════════════════════════════════════════════════════
//
// Le vrai moteur (`extraireRush`), la vraie route, le vrai paquet `minio`, et
// un stockage qui se tait. C'est le scénario exact du défaut : avant ce lot,
// cette requête ne serait jamais revenue.

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]> = {};

/** Une base minuscule, en mémoire, avec le filtrage que fait PostgREST. */
function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  const filtresLt: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;

  const lignes = () => {
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c]))
        && filtresLt.every(([c, v]) => String(l[c] ?? '') < String(v)),
    );
    if (tri) {
      const t = tri;
      out = [...out].sort((a, b) => {
        const x = Number(a[t.colonne] ?? 0); const y = Number(b[t.colonne] ?? 0);
        return t.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (aInserer) {
      const ligne: Ligne = {
        id: `an-${(tables[table] ?? []).length + 1}`,
        version: 1, etat: 'en_attente', etape: null, fournisseurs: {},
        duree_secondes: null, technique: {}, resume: null, textes_visibles: [],
        parole: {}, audio: {}, qualite: {}, vignettes: [], usage: {},
        motif_echec: null, created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z', ...aInserer,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }
    if (aMettreAJour) {
      const cibles = lignes();
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMettreAJour;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      return { data: (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null, error: null };
    }
    const l = lignes();
    return { data: l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    // ⚠️ `.lt()` EST INDISPENSABLE DEPUIS LA RÉCUPÉRATION DES ANALYSES.
    //
    // `creerAnalyse` filtre désormais sur `updated_at < seuil`. Une doublure
    // qui ignore `.lt` lève `api.lt is not a function`, l'exception sort par
    // le `catch` global de la route, et TOUS les tests de ce fichier
    // répondent 500 — un échec qui accuse le stockage alors que le fautif
    // est la doublure.
    lt: (c: string, v: unknown) => { filtresLt.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => resoudre({ data: lignes(), error: null }),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

const { POST } = await import('@/app/api/autopilot/rushes/[id]/analyse/route');
const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
const { definirMoteurExtraction } = await import('@/lib/autopilot/analyse/moteur');
const { extractionsEnCours, prendrePlaceExtraction, reinitialiserCapacite } = await import(
  '@/lib/autopilot/analyse/capacite'
);

const RUSH: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};

describe('Bout en bout : un stockage muet ne laisse plus l’analyse en_cours', () => {
  beforeEach(() => {
    reinitialiserCapacite();
    authMock.mockResolvedValue({ user: { id: 'A' } });
    tables = { rushes: [{ ...RUSH }], rush_analyses: [] };
    // Le VRAI moteur. Injecté seulement pour court-circuiter l'import
    // dynamique de la couture, pas pour en changer le comportement.
    //
    // La conversion est celle que `chargerMoteurExtraction` fait déjà en
    // production : `extraction.ts` et `moteur.ts` décrivent le même retour
    // avec deux types distincts, dont l'un porte des champs que l'autre
    // ignore. Cet écart préexiste à ce lot et ne lui appartient pas.
    definirMoteurExtraction(extraireRush as unknown as MoteurExtraction);
    viserLeTrouNoir();
  });

  afterAll(() => { definirMoteurExtraction(null); });

  it(
    'la requête revient, la place est rendue, la ligne est `echouee` et rien de signé n’a fuité',
    async () => {
      const t0 = Date.now();
      const reponse = await POST(
        new Request('http://x/api/autopilot/rushes/r-a/analyse', { method: 'POST' }) as never,
        { params: { id: 'r-a' } },
      );
      const ecoule = Date.now() - t0;
      const corps = await reponse.json();

      // 1. Elle revient — c'est déjà tout le lot.
      expect(ecoule).toBeLessThan(TIMEOUT_MINIO_MS + 5_000);

      // 2. Le stockage muet est nommé pour ce qu'il est.
      expect(corps.motif).toBe('stockage_injoignable');
      expect(reponse.status).toBe(503);

      // 3. La place d'extraction — il n'y en a qu'UNE — est rendue, et la
      //    suivante peut réellement la prendre. Sans la borne, elle serait
      //    restée occupée jusqu'au redémarrage du conteneur, et toute analyse
      //    ultérieure aurait reçu 429.
      expect(extractionsEnCours()).toBe(0);
      const suivante = prendrePlaceExtraction();
      expect(suivante, 'la place suivante est disponible').not.toBeNull();
      suivante!.liberer();

      // 4. La ligne est close. `en_cours` éternel est l'état dont l'index
      //    unique de M3-B1 interdit de sortir sans intervention manuelle.
      const analyse = (tables.rush_analyses ?? [])[0];
      expect(analyse.etat).toBe('echouee');
      expect(analyse.motif_echec).toBe('stockage_injoignable');

      // 5. Aucune URL, signée ou non, nulle part dans ce qui est rendu ou écrit.
      const tout = JSON.stringify(corps) + JSON.stringify(analyse);
      expect(tout).not.toMatch(/https?:\/\//);
      expect(tout).not.toContain('X-Amz-Signature');
    },
    TIMEOUT_MINIO_MS + 10_000,
  );
});
