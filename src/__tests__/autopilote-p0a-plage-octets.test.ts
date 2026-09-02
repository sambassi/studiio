// @vitest-environment node
/**
 * P0-A — LA ROUTE DES OCTETS HONORE `Range`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PANNE MESURÉE EN PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sur le rendu `ceea92e8…` (11 958 505 octets), TOUTES ces requêtes rendaient
 * la même chose — `200`, `Content-Length: 11958505`, `Accept-Ranges: none`,
 * aucun `Content-Range` :
 *
 *     Range: bytes=0-1023
 *     Range: bytes=1000000-1001023
 *     Range: bytes=99999999-100000000
 *     Range: bytes=abc
 *
 * L'en-tête n'était jamais lu. Chrome ne pouvait ni se positionner ni
 * remplir le tampon de son lecteur : `readyState: 0`, puis
 * `NETWORK_NO_SOURCE` — sur l'URL nue comme dans la page.
 *
 * ⚠️ CE FICHIER APPELLE LA VRAIE ROUTE. Seuls la session, la base et le
 * stockage sont doublés ; le code des plages, lui, est celui qui part en
 * production. Un test qui relirait la source ne pourrait pas dire combien
 * d'octets sortent vraiment d'un `206`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'stream';

import {
  lirePlageOctets, enteteContentRange, enteteContentRangeInsatisfiable,
} from '@/lib/http/plage-octets';

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const AUTRUI = '11111111-2222-4333-8444-555555555555';
const RID = '55555555-5555-4555-8555-000000000001';
const CLE = `${UID}/autopilote/montages/${RID}/montage.mp4`;
const TAILLE = 11_958_505;

/** Le contenu servi : chaque octet vaut son index modulo 251, un nombre premier. */
const octet = (i: number) => i % 251;

/** Qui est connecté. Modifiable par test. */
let utilisateur: string | null = UID;
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateur ? { user: { id: utilisateur } } : null),
}));

/** Ce que la base rend. */
let ligne: Record<string, unknown> | null = null;
vi.mock('@/lib/autopilot/analyse/rendu-service', () => ({
  lireRenduParId: async (userId: string) => ({
    // ⚠️ LA BASE FILTRE PAR PROPRIÉTAIRE. La doublure le fait aussi : sans
    // cela, le test « l'octet d'autrui » passerait pour de mauvaises raisons.
    rendu: userId === UID ? ligne : null,
  }),
}));

/** Les demandes reçues par le stockage — c'est là qu'on prouve le coût. */
const demandes: Array<{ complet: boolean; decalage?: number; longueur?: number }> = [];
vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lecteurMinio: () => ({
    getObject: async () => {
      demandes.push({ complet: true });
      return Readable.from([Buffer.from(Array.from({ length: 4096 }, (_, i) => octet(i)))]);
    },
    getPartialObject: async (
      _b: string, _c: string, decalage: number, longueur: number,
    ) => {
      demandes.push({ complet: false, decalage, longueur });
      // ⚠️ EXACTEMENT `longueur` OCTETS, comme le vrai client : c'est ce qui
      // permet d'affirmer qu'un `206` ne sert pas le fichier entier.
      return Readable.from([Buffer.from(
        Array.from({ length: longueur }, (_, i) => octet(decalage + i)),
      )]);
    },
  }),
}));

// eslint-disable-next-line import/first
import { GET } from '@/app/api/autopilot/rendus-montage/[renduId]/fichier/route';

const appeler = (plage?: string) => GET(
  new NextRequest(`https://studiio.pro/api/autopilot/rendus-montage/${RID}/fichier`, {
    headers: plage ? { Range: plage } : {},
  }),
  { params: { renduId: RID } },
);

const corps = async (r: Response) => Buffer.from(await r.arrayBuffer());

beforeEach(() => {
  utilisateur = UID;
  demandes.length = 0;
  ligne = { etat: 'reussie', resultat: { bucket: 'studiio', cle: CLE, octets: TAILLE } };
});

// ═══════════════════════════════════════════════════════════════════════════
// A. LA REQUÊTE COMPLÈTE
// ═══════════════════════════════════════════════════════════════════════════

describe('A. Sans `Range` : la ressource entière', () => {
  it('A.1 rend 200, la taille totale, et annonce accepter les plages', async () => {
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('content-length')).toBe(String(TAILLE));
    // ⚠️ L'ANNONCE EST CE QUI DÉCLENCHE LE POSITIONNEMENT côté navigateur.
    // Sans elle, Chrome ne tente même pas de demander une plage.
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('content-range')).toBeNull();
    expect(demandes).toEqual([{ complet: true }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B → D. LES PLAGES
// ═══════════════════════════════════════════════════════════════════════════

describe('B. Le premier segment', () => {
  it('B.1 `bytes=0-1023` rend 206 et EXACTEMENT 1024 octets', async () => {
    const r = await appeler('bytes=0-1023');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 0-1023/${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('1024');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    const b = await corps(r);
    expect(b.length).toBe(1024);
    // Le premier octet du fichier, pas celui d'ailleurs.
    expect(b[0]).toBe(octet(0));
    expect(b[1023]).toBe(octet(1023));
  });

  it('B.2 le stockage n’est sollicité que pour ces 1024 octets', async () => {
    await appeler('bytes=0-1023');
    // ⚠️ C'EST LA RÈGLE DE COÛT. Servir mille octets ne doit pas en lire
    // douze millions — sinon le déplacement dans la timeline reste ruineux
    // même avec un 206 correct.
    expect(demandes).toEqual([{ complet: false, decalage: 0, longueur: 1024 }]);
  });
});

describe('C. Un segment au milieu', () => {
  it('C.1 `bytes=1000000-1001023` rend le bon `Content-Range` et les bons octets', async () => {
    const r = await appeler('bytes=1000000-1001023');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 1000000-1001023/${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('1024');
    const b = await corps(r);
    expect(b.length).toBe(1024);
    // Les octets viennent du MILIEU : un décalage ignoré rendrait `octet(0)`.
    expect(b[0]).toBe(octet(1000000));
    expect(demandes).toEqual([{ complet: false, decalage: 1000000, longueur: 1024 }]);
  });
});

describe('D. Les bords du fichier', () => {
  it('D.1 `bytes=N-` va jusqu’au dernier octet, sans le dépasser', async () => {
    const r = await appeler(`bytes=${TAILLE - 10}-`);
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes ${TAILLE - 10}-${TAILLE - 1}/${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('10');
    expect((await corps(r)).length).toBe(10);
  });

  it('D.2 une fin au-delà du fichier est RAMENÉE à la fin, pas refusée', async () => {
    // Chrome demande couramment `bytes=0-` ou une fin large : refuser serait
    // casser la lecture pour une demande parfaitement légitime.
    const r = await appeler(`bytes=${TAILLE - 5}-999999999`);
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes ${TAILLE - 5}-${TAILLE - 1}/${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('5');
  });

  it('D.3 `bytes=-N` rend les N DERNIERS octets', async () => {
    const r = await appeler('bytes=-500');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes ${TAILLE - 500}-${TAILLE - 1}/${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('500');
  });

  it('D.4 le dernier octet, seul', async () => {
    const r = await appeler(`bytes=${TAILLE - 1}-${TAILLE - 1}`);
    expect(r.status).toBe(206);
    expect(r.headers.get('content-length')).toBe('1');
    expect((await corps(r)).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. LA PLAGE IMPOSSIBLE
// ═══════════════════════════════════════════════════════════════════════════

describe('E. Ce qui ne peut pas être servi', () => {
  it('E.1 une plage hors du fichier rend 416 et la taille réelle', async () => {
    const r = await appeler('bytes=99999999-100000000');
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe(`bytes */${TAILLE}`);
    expect(r.headers.get('content-length')).toBe('0');
    expect((await corps(r)).length).toBe(0);
    // ⚠️ ET LE STOCKAGE N'EST PAS TOUCHÉ. Un 416 qui lirait quand même
    // l'objet ferait payer une demande qu'on vient de refuser.
    expect(demandes).toEqual([]);
  });

  it('E.2 commencer PILE à la taille est déjà hors du fichier', async () => {
    const r = await appeler(`bytes=${TAILLE}-`);
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe(`bytes */${TAILLE}`);
  });

  it('E.3 un en-tête illisible est IGNORÉ, jamais transformé en erreur', async () => {
    // La RFC 7233 l'autorise explicitement, et un 416 sur `bytes=abc`
    // casserait des clients qui n'ont rien demandé de spécial.
    for (const cabosse of ['bytes=abc', 'items=0-9', 'bytes=', 'bytes=5-2', 'bytes=0-9,20-29']) {
      demandes.length = 0;
      // eslint-disable-next-line no-await-in-loop
      const r = await appeler(cabosse);
      expect(r.status, cabosse).toBe(200);
      expect(r.headers.get('content-length'), cabosse).toBe(String(TAILLE));
      expect(r.headers.get('content-range'), cabosse).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F / I. LA SÉCURITÉ N'A PAS BOUGÉ
// ═══════════════════════════════════════════════════════════════════════════

describe('F. L’accès reste fermé', () => {
  it('F.1 sans session, 401 — plage ou pas', async () => {
    utilisateur = null;
    for (const p of [undefined, 'bytes=0-1023']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await appeler(p);
      expect(r.status).toBe(401);
    }
    expect(demandes).toEqual([]);
  });

  it('F.2 le rendu d’autrui reste introuvable, y compris par plage', async () => {
    utilisateur = AUTRUI;
    const r = await appeler('bytes=0-1023');
    expect(r.status).toBe(404);
    expect(demandes).toEqual([]);
  });

  it('F.3 une clé qui sort de l’espace du propriétaire est refusée', async () => {
    // ⚠️ LA REVALIDATION DE CLÉ EST AVANT LA PLAGE. Sans cet ordre, une
    // requête partielle lirait l'espace d'un tiers avant tout contrôle.
    ligne = {
      etat: 'reussie',
      resultat: { bucket: 'studiio', cle: `${AUTRUI}/autopilote/x.mp4`, octets: TAILLE },
    };
    const r = await appeler('bytes=0-1023');
    expect(r.status).toBe(404);
    expect(demandes).toEqual([]);
  });

  it('F.4 un rendu pas encore abouti ne sert aucun octet', async () => {
    ligne = { etat: 'en_cours', resultat: null };
    const r = await appeler('bytes=0-1023');
    expect(r.status).toBe(404);
    expect(demandes).toEqual([]);
  });

  it('F.5 les verrous d’en-tête sont intacts sur les trois codes', async () => {
    for (const [plage, code] of [
      [undefined, 200], ['bytes=0-1023', 206], ['bytes=99999999-100000000', 416],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const r = await appeler(plage);
      expect(r.status).toBe(code);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('cache-control')).toContain('private');
      expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    }
  });

  it('F.6 aucun octet de réponse ne nomme le compartiment ni la clé', async () => {
    const r = await appeler('bytes=0-1023');
    const entetes = JSON.stringify([...r.headers.entries()]);
    expect(entetes).not.toContain('studiio-minio');
    expect(entetes).not.toContain(CLE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G / H. CE QUE CE LOT NE DEVAIT PAS CASSER
// ═══════════════════════════════════════════════════════════════════════════

describe('G. Le téléchargement', () => {
  it('G.1 un GET sans plage sert toujours le fichier entier, en video/mp4', async () => {
    const r = await appeler();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('content-length')).toBe(String(TAILLE));
  });

  it('H.1 le type est celui du contrat, sur les trois codes', async () => {
    for (const p of [undefined, 'bytes=0-1023', 'bytes=99999999-100000000'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const r = await appeler(p);
      expect(r.headers.get('content-type')).toBe('video/mp4');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA LECTURE DE L'EN-TÊTE, ÉPROUVÉE SEULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Le lecteur d’en-tête, sans serveur', () => {
  const T = 1000;
  it('lit les trois formes de la RFC', () => {
    expect(lirePlageOctets('bytes=0-99', T)).toEqual({ sorte: 'plage', debut: 0, fin: 99, longueur: 100 });
    expect(lirePlageOctets('bytes=900-', T)).toEqual({ sorte: 'plage', debut: 900, fin: 999, longueur: 100 });
    expect(lirePlageOctets('bytes=-100', T)).toEqual({ sorte: 'plage', debut: 900, fin: 999, longueur: 100 });
  });

  it('tolère la casse et les espaces', () => {
    expect(lirePlageOctets('BYTES= 0 - 99 ', T)).toEqual({ sorte: 'plage', debut: 0, fin: 99, longueur: 100 });
  });

  it('ignore ce qu’il ne sait pas servir', () => {
    for (const x of [null, undefined, '', 'bytes=abc', 'items=0-9', 'bytes=0-9,20-29', 'bytes=5-2', 'bytes=-abc']) {
      expect(lirePlageOctets(x, T), String(x)).toEqual({ sorte: 'absente' });
    }
  });

  it('refuse ce qui n’existe pas', () => {
    expect(lirePlageOctets(`bytes=${T}-`, T)).toEqual({ sorte: 'insatisfiable' });
    expect(lirePlageOctets('bytes=-0', T)).toEqual({ sorte: 'insatisfiable' });
    expect(lirePlageOctets('bytes=-5', 0)).toEqual({ sorte: 'insatisfiable' });
  });

  it('écrit les deux en-têtes `Content-Range`', () => {
    expect(enteteContentRange(0, 1023, TAILLE)).toBe(`bytes 0-1023/${TAILLE}`);
    expect(enteteContentRangeInsatisfiable(TAILLE)).toBe(`bytes */${TAILLE}`);
  });
});
