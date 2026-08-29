/**
 * M3-B3.2a — le namespace d'analyse ne sort pas par la route publique.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI ETAIT OUVERT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lib/autopilot/analyse/extraction.ts` ecrit les vignettes sous
 * `media/<userId>/analyse/<analysisId>/vignette-NN.jpg`. Cette cle est
 * DETERMINISTE : les deux identifiants qui la composent sont deja dans le
 * navigateur de l'ecran d'analyse. `lib/autopilot/analyse/vignettes.ts` le
 * dit noir sur blanc : « Quiconque les a lit les vignettes de leur
 * proprietaire ».
 *
 * `/storage/v1/object/public/media/<cette cle>` n'exige AUCUNE session — et
 * ne peut pas en exiger une, sept appelants sans cookie en dependent. Elle
 * servait donc les vignettes de n'importe qui a n'importe qui.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. `GET` et `HEAD` sur le namespace rendent 404 SANS UN SEUL APPEL MinIO —
 *    la doublure compte les appels, c'est la seule preuve qui vaille.
 * 2. Le refus est INDISTINGUABLE d'un objet absent : meme code, meme corps.
 *    Ni 401 ni 403 — un code distinct repondrait « ce namespace existe », et
 *    comme la cle est devinable, ce bit suffirait.
 * 3. Les formes encodees, doublement encodees et de traversee visant
 *    `/analyse/` sont refusees elles aussi.
 * 4. RIEN d'autre ne bouge : rushes, `Range`/206/416, `HEAD` normal, prevol.
 * 5. La seule porte legitime — `/api/autopilot/analyses/[id]/vignettes/[n]`,
 *    authentifiee — rend toujours l'image.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleDansNamespaceAnalyse, BUCKET_NAMESPACE_ANALYSE,
} from '@/lib/storage/acces-objet';

// ───────────────────────────────────────────────────────────────────────────
// PARTIE 1 — la route publique de stockage.
//
// Le stockage simule, et le journal de TOUT ce qu'on lui demande : la preuve
// qu'une garde mord, c'est que MinIO n'est PAS interroge.
// ───────────────────────────────────────────────────────────────────────────

const etat = vi.hoisted(() => ({
  appels: [] as Array<{ methode: string; bucket: string; cle: string; debut?: number; longueur?: number }>,
  taille: 4096,
  /** Erreur a lever depuis `statObject`, pour comparer avec un objet absent. */
  erreurStat: null as { code?: string; message: string } | null,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'stat', bucket, cle });
      if (etat.erreurStat) {
        throw Object.assign(new Error(etat.erreurStat.message), { code: etat.erreurStat.code });
      }
      return { size: etat.taille, metaData: {} };
    }
    async getObject(bucket: string, cle: string) {
      etat.appels.push({ methode: 'get', bucket, cle });
      return Readable.from([Buffer.alloc(etat.taille, 7)]);
    }
    async getPartialObject(bucket: string, cle: string, debut: number, longueur: number) {
      etat.appels.push({ methode: 'partial', bucket, cle, debut, longueur });
      return Readable.from([Buffer.alloc(longueur, 7)]);
    }
  }
  return { Client };
});

// ───────────────────────────────────────────────────────────────────────────
// PARTIE 2 — la route authentifiee des vignettes.
//
// `lireAnalyse` et le lecteur MinIO sont des doublures : ce fichier ne teste
// ni PostgREST ni le stockage, seulement que la porte legitime reste ouverte.
// ───────────────────────────────────────────────────────────────────────────

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

const OCTETS_VIGNETTE = 'JPEG-FICTIF';
const lecturesVignette = vi.hoisted(() => ({ appels: [] as Array<{ bucket: string; cle: string }> }));

vi.mock('@/lib/storage/minio-client', async () => {
  const { Readable } = await import('node:stream');
  return {
    lecteurMinio: () => ({
      getObject: async (bucket: string, cle: string) => {
        lecturesVignette.appels.push({ bucket, cle });
        return Readable.from([Buffer.from('JPEG-FICTIF')]);
      },
    }),
    signeurPublic: () => null,
    signeurInterne: () => null,
    clientMinio: () => ({
      statObject: async () => { throw new Error('non sollicite'); },
      putObject: async () => { throw new Error('non sollicite'); },
    }),
  };
});

/** L'analyse que `lireAnalyse` rendra. `null` = introuvable. */
const baseAnalyse = vi.hoisted(() => ({
  valeur: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/autopilot/analyse/service', () => ({
  lireAnalyse: async () => ({
    analyse: baseAnalyse.valeur, motif: baseAnalyse.valeur ? null : 'analyse_introuvable',
  }),
}));

// La route lit `STORAGE_PROVIDER` AU CHARGEMENT : il faut le poser avant.
process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { GET: LIRE, HEAD: SONDER, OPTIONS: PREVOL } = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);
const { GET: LIRE_VIGNETTE } = await import(
  '@/app/api/autopilot/analyses/[id]/vignettes/[n]/route'
);

const ORIGINE = 'https://studiio.pro';

function requete(chemin: string, entetes: Record<string, string> = {}): never {
  return new Request(`${ORIGINE}${chemin}`, { headers: entetes }) as never;
}

function lire(bucket: string, segments: string[], entetes: Record<string, string> = {}) {
  return LIRE(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`, entetes), {
    params: Promise.resolve({ bucket, path: segments }),
  });
}

function sonder(bucket: string, segments: string[], entetes: Record<string, string> = {}) {
  return SONDER(requete(`/storage/v1/object/public/${bucket}/${segments.join('/')}`, entetes), {
    params: Promise.resolve({ bucket, path: segments }),
  });
}

/**
 * La cle REELLE d'une vignette, recopiee de `extraction.ts` :
 *   `${entree.userId}/analyse/${entree.analysisId}/vignette-${NN}.jpg`
 * avec `NN = String(index + 1).padStart(2, '0')` — donc numerotee a partir
 * de `01`, et non de `00`.
 */
const CLE_VIGNETTE = ['userA', 'analyse', 'an-1', 'vignette-01.jpg'];

beforeEach(() => {
  etat.appels.length = 0;
  etat.taille = 4096;
  etat.erreurStat = null;
  lecturesVignette.appels.length = 0;
  authMock.mockReset();
  baseAnalyse.valeur = null;
});

// ───────────────────────────────────────────────────────────────────────────

describe('Le motif vient du code, pas d une supposition', () => {
  it('la cle produite par l extraction est bien `<userId>/analyse/<analysisId>/vignette-NN.jpg`', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/analyse/extraction.ts'), 'utf8',
    );
    // La ligne qui fabrique la cle, telle qu'elle est ecrite.
    expect(source).toContain(
      '`${entree.userId}/analyse/${entree.analysisId}/vignette-${String(index + 1).padStart(2, \'0\')}.jpg`',
    );
    // Et le compartiment vise par la garde est bien celui ou elle est ecrite.
    expect(source).toContain("export const BUCKET_VIGNETTES = 'media'");
    expect(BUCKET_NAMESPACE_ANALYSE).toBe('media');
  });
});

describe('Le namespace d analyse rend 404 AVANT tout appel MinIO', () => {
  it('GET media/userA/analyse/an-1/vignette-01.jpg : 404, zero appel', async () => {
    const res = await lire('media', CLE_VIGNETTE);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('HEAD sur la meme cle : 404, zero appel', async () => {
    const res = await sonder('media', CLE_VIGNETTE);
    expect(res.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });

  it('les huit index d une planche sont tous refuses', async () => {
    for (let i = 1; i <= 8; i++) {
      etat.appels.length = 0;
      const n = String(i).padStart(2, '0');
      const res = await lire('media', ['userA', 'analyse', 'an-1', `vignette-${n}.jpg`]);
      expect(res.status, n).toBe(404);
      expect(etat.appels, n).toHaveLength(0);
    }
  });

  it('tout le namespace tombe, pas seulement le motif `vignette-NN.jpg`', async () => {
    // Une regle collee au nom de fichier d'aujourd'hui laisserait passer
    // celui de demain — planche contact, JSON de scores, extrait audio.
    for (const feuille of ['planche.jpg', 'scores.json', 'extrait.mp4', 'quoi-que-ce-soit']) {
      etat.appels.length = 0;
      const res = await lire('media', ['userA', 'analyse', 'an-1', feuille]);
      expect(res.status, feuille).toBe(404);
      expect(etat.appels, feuille).toHaveLength(0);
    }
  });

  it('le refus ne depend pas de l Origin : avec ou sans, c est 404 sans appel', async () => {
    const jeux: Record<string, string>[] = [{}, { origin: ORIGINE }, { origin: 'https://evil.example' }];
    for (const entetes of jeux) {
      etat.appels.length = 0;
      const res = await lire('media', CLE_VIGNETTE, entetes);
      expect(res.status).toBe(404);
      expect(etat.appels).toHaveLength(0);
    }
  });
});

describe('Le refus est INDISTINGUABLE d un objet absent — ni 401, ni 403', () => {
  it('meme code et meme corps que pour une cle qui n existe vraiment pas', async () => {
    // Reference : un objet du stockage qui repond NoSuchKey.
    etat.erreurStat = { code: 'NoSuchKey', message: 'The specified key does not exist.' };
    const absent = await lire('media', ['userA', 'rush', 'jamais-envoye.mp4']);
    const corpsAbsent = await absent.text();
    expect(absent.status).toBe(404);
    expect(etat.appels).toHaveLength(1); // l'objet absent, lui, coute un stat

    etat.appels.length = 0;
    etat.erreurStat = null;
    const namespace = await lire('media', CLE_VIGNETTE);
    const corpsNamespace = await namespace.text();

    expect(namespace.status).toBe(absent.status);
    expect(corpsNamespace).toBe(corpsAbsent);
    // Et cette fois, aucun appel : le refus est meme MOINS cher.
    expect(etat.appels).toHaveLength(0);
  });

  it('jamais 401, jamais 403, ni en GET ni en HEAD', async () => {
    const g = await lire('media', CLE_VIGNETTE);
    const h = await sonder('media', CLE_VIGNETTE);
    for (const res of [g, h]) {
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    }
  });

  it('aucun en-tete ne trahit le refus (pas de WWW-Authenticate, pas de motif)', async () => {
    const res = await lire('media', CLE_VIGNETTE);
    expect(res.headers.get('www-authenticate')).toBeNull();
    const corps = await res.text();
    expect(corps.toLowerCase()).not.toContain('analyse');
    expect(corps.toLowerCase()).not.toContain('vignette');
    expect(corps.toLowerCase()).not.toContain('interdit');
    expect(corps.toLowerCase()).not.toContain('forbidden');
  });
});

describe('Les contournements de chemin visant `/analyse/` sont refuses aussi', () => {
  /**
   * Next.js decode DEJA une fois les segments dynamiques. Les segments
   * ci-dessous sont donc ce qui ARRIVE au gestionnaire — c'est-a-dire ce que
   * l'attaquant a envoye, moins un decodage.
   */
  const formes: Array<[string, string[]]> = [
    ['encode une fois de plus (`%61nalyse`)', ['userA', '%61nalyse', 'an-1', 'vignette-01.jpg']],
    ['encode deux fois de plus (`%2561nalyse`)', ['userA', '%2561nalyse', 'an-1', 'vignette-01.jpg']],
    ['segment entierement encode (`%61%6e%61%6c%79%73%65`)', ['userA', '%61%6e%61%6c%79%73%65', 'an-1', 'v.jpg']],
    ['barre oblique encodee dans un seul segment', ['userA%2Fanalyse%2Fan-1', 'vignette-01.jpg']],
    ['barre oblique doublement encodee', ['userA%252Fanalyse%252Fan-1', 'vignette-01.jpg']],
    ['traversee vers le namespace', ['userA', 'rush', '..', 'analyse', 'an-1', 'v.jpg']],
    ['traversee encodee', ['userA', 'rush', '%2e%2e', 'analyse', 'an-1', 'v.jpg']],
    ['separateur antislash', ['userA\\analyse\\an-1\\vignette-01.jpg']],
    ['barres doublees', ['userA', '', 'analyse', '', 'an-1', 'vignette-01.jpg']],
  ];

  /**
   * ⚠️ LA CASSE N'EST PAS BLOQUEE, ET C'EST UN CHANGEMENT ASSUME.
   *
   * La premiere version refusait `Analyse` et `AnAlYsE`. Deux audits
   * independants ont conclu que c'etait un refus sans gain : les cles S3 sont
   * exactes a l'octet pres, donc `A/Analyse/...` designe un objet DIFFERENT,
   * qui n'existe pas. Le bloquer ne rend aucune vignette inaccessible et
   * n'ajoute que des refus sur des cles qu'un compte pourrait s'etre
   * legitimement donnees.
   */
  it.each([['casse differente', 'Analyse'], ['casse melangee', 'AnAlYsE']])(
    '%s (`%s`) reste servie — la cle designe un autre objet',
    async (_q, segment) => {
      etat.appels.length = 0;
      const g = await lire('media', ['userA', segment, 'an-1', 'vignette-01.jpg']);
      // Servie, donc le stockage est bien interroge — la preuve que la garde
      // n'a pas mordu.
      expect(g.status).toBe(200);
      expect(etat.appels.length).toBeGreaterThan(0);
    },
  );

  for (const [nom, segments] of formes) {
    it(`${nom} : 404 sans appel MinIO`, async () => {
      etat.appels.length = 0;
      const g = await lire('media', segments);
      expect(g.status, nom).toBe(404);
      expect(etat.appels, nom).toHaveLength(0);

      etat.appels.length = 0;
      const h = await sonder('media', segments);
      expect(h.status, nom).toBe(404);
      expect(etat.appels, nom).toHaveLength(0);
    });
  }
});

describe('Le reste de la route est INTACT', () => {
  it('un rush normal est toujours servi', async () => {
    const res = await lire('media', ['userA', 'rush', 'video.mp4']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(etat.appels.map((a) => a.methode)).toEqual(['stat', 'get']);
    expect(etat.appels[1].cle).toBe('userA/rush/video.mp4');
  });

  it('les quatre compartiments declares passent toujours hors namespace', async () => {
    for (const bucket of ['media', 'audio', 'videos', 'images']) {
      etat.appels.length = 0;
      const res = await lire(bucket, ['userA', 'rush', 'a.mp4']);
      expect(res.status, bucket).toBe(200);
    }
  });

  it('Range rend 206, le bon Content-Range, et lit PARTIELLEMENT', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['userA', 'rush', 'video.mp4'], { range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(etat.appels.find((a) => a.methode === 'partial')).toMatchObject({
      debut: 100, longueur: 100,
    });
    // Le flux partiel, JAMAIS l'objet entier.
    expect(etat.appels.some((a) => a.methode === 'get')).toBe(false);
  });

  it('un Range ouvert `bytes=500-` va jusqu au bout', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['userA', 'rush', 'video.mp4'], { range: 'bytes=500-' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 500-999/1000');
    expect(etat.appels.find((a) => a.methode === 'partial')).toMatchObject({
      debut: 500, longueur: 500,
    });
  });

  it('un Range hors bornes rend 416 avec `Content-Range: bytes *\/taille`', async () => {
    etat.taille = 1000;
    const res = await lire('media', ['userA', 'rush', 'video.mp4'], { range: 'bytes=5000-6000' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('HEAD normal rend 200, la taille et Accept-Ranges', async () => {
    etat.taille = 777;
    const res = await sonder('media', ['userA', 'rush', 'video.mp4']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('777');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    // Un `HEAD` ne lit PAS le corps.
    expect(etat.appels.map((a) => a.methode)).toEqual(['stat']);
  });

  it('les protections du lot precedent tiennent toujours', async () => {
    const res = await lire('media', ['userA', 'rush', 'video.mp4'], { origin: ORIGINE });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGINE);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    // Compartiment hors liste : toujours 404 sans appel.
    etat.appels.length = 0;
    const hors = await lire('backups', ['dump.mp4']);
    expect(hors.status).toBe(404);
    expect(etat.appels).toHaveLength(0);
  });
});

describe('Le prevol n ouvre aucun acces et ne revele rien', () => {
  it('OPTIONS ne touche jamais MinIO', async () => {
    await PREVOL(requete(`/storage/v1/object/public/media/${CLE_VIGNETTE.join('/')}`, { origin: ORIGINE }));
    expect(etat.appels).toHaveLength(0);
  });

  it('OPTIONS repond la MEME chose pour le namespace et pour un rush', async () => {
    const surNamespace = await PREVOL(
      requete(`/storage/v1/object/public/media/${CLE_VIGNETTE.join('/')}`, { origin: ORIGINE }),
    );
    const surRush = await PREVOL(
      requete('/storage/v1/object/public/media/userA/rush/video.mp4', { origin: ORIGINE }),
    );
    expect(surNamespace.status).toBe(surRush.status);
    expect([...surNamespace.headers].sort()).toEqual([...surRush.headers].sort());
    // Et il ne rend aucun octet.
    expect(await surNamespace.text()).toBe('');
  });
});

describe('La garde, prise a part', () => {
  it('vraie sur le namespace, fausse ailleurs', () => {
    expect(cleDansNamespaceAnalyse('media', 'userA/analyse/an-1/vignette-01.jpg')).toBe(true);
    expect(cleDansNamespaceAnalyse('media', 'userA/analyse/an-1')).toBe(true);
    expect(cleDansNamespaceAnalyse('media', 'userA/rush/video.mp4')).toBe(false);
    expect(cleDansNamespaceAnalyse('media', 'converted/1712345678.mp4')).toBe(false);
    // `analyse` sans rien apres n'est pas un objet du namespace.
    expect(cleDansNamespaceAnalyse('media', 'userA/analyse')).toBe(false);
    // Ni sans rien avant.
    expect(cleDansNamespaceAnalyse('media', 'analyse/x.jpg')).toBe(false);
    // Un nom de fichier qui CONTIENT le mot n'est pas un segment.
    expect(cleDansNamespaceAnalyse('media', 'userA/rush/analyse-du-plan.mp4')).toBe(false);
    expect(cleDansNamespaceAnalyse('media', 'userA/analyses/an-1/x.jpg')).toBe(false);
  });

  it('ne vise que `media` — le compartiment ou l extraction ecrit', () => {
    for (const bucket of ['audio', 'videos', 'images', 'backups']) {
      expect(cleDansNamespaceAnalyse(bucket, 'userA/analyse/an-1/vignette-01.jpg'), bucket)
        .toBe(false);
    }
  });

  it('resiste aux entrees qui ne sont pas des chaines', () => {
    for (const valeur of [null, undefined, 42, {}, []]) {
      expect(cleDansNamespaceAnalyse('media', valeur)).toBe(false);
    }
    expect(cleDansNamespaceAnalyse('media', '')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// La seule porte legitime.
// ───────────────────────────────────────────────────────────────────────────

describe('La route authentifiee des vignettes reste la porte ouverte', () => {
  const analyseDeA = {
    id: 'an-1', rushId: 'r-a', userId: 'userA', etat: 'reussie',
    vignettes: [
      { bucket: 'media', cle: 'userA/analyse/an-1/vignette-01.jpg', seconde: 1 },
      { bucket: 'media', cle: 'userA/analyse/an-1/vignette-02.jpg', seconde: 2 },
    ],
  };

  it('avec session, elle rend toujours l image — et lit la cle du namespace', async () => {
    authMock.mockResolvedValue({ user: { id: 'userA' } });
    baseAnalyse.valeur = analyseDeA;

    const res = await LIRE_VIGNETTE(
      requete('/api/autopilot/analyses/an-1/vignettes/0'),
      { params: { id: 'an-1', n: '0' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(await res.text()).toBe(OCTETS_VIGNETTE);
    // C'est BIEN une cle du namespace bloque cote public : la fermeture de la
    // route publique n'a pas ferme celle-ci.
    expect(lecturesVignette.appels).toEqual([
      { bucket: 'media', cle: 'userA/analyse/an-1/vignette-01.jpg' },
    ]);
    expect(cleDansNamespaceAnalyse('media', lecturesVignette.appels[0].cle)).toBe(true);
  });

  it('le second index rend la seconde vignette', async () => {
    authMock.mockResolvedValue({ user: { id: 'userA' } });
    baseAnalyse.valeur = analyseDeA;
    const res = await LIRE_VIGNETTE(
      requete('/api/autopilot/analyses/an-1/vignettes/1'),
      { params: { id: 'an-1', n: '1' } },
    );
    expect(res.status).toBe(200);
    expect(lecturesVignette.appels[0].cle).toBe('userA/analyse/an-1/vignette-02.jpg');
  });

  it('sans session, 401 — et aucun objet ouvert', async () => {
    authMock.mockResolvedValue(null);
    baseAnalyse.valeur = analyseDeA;
    const res = await LIRE_VIGNETTE(
      requete('/api/autopilot/analyses/an-1/vignettes/0'),
      { params: { id: 'an-1', n: '0' } },
    );
    expect(res.status).toBe(401);
    expect(lecturesVignette.appels).toHaveLength(0);
  });

  it('l analyse d autrui reste introuvable, jamais interdite', async () => {
    authMock.mockResolvedValue({ user: { id: 'userB' } });
    // `lireAnalyse` filtre sur `user_id` : pour B, l'analyse de A n'existe pas.
    baseAnalyse.valeur = null;
    const res = await LIRE_VIGNETTE(
      requete('/api/autopilot/analyses/an-1/vignettes/0'),
      { params: { id: 'an-1', n: '0' } },
    );
    expect(res.status).toBe(404);
    expect(lecturesVignette.appels).toHaveLength(0);
  });
});
