// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * AVATAR-1B — la source d'un clone vit en stockage PRIVÉ, sous une clé que
 * le serveur construit, et ne se retire que si elle est À CE COMPTE.
 *
 * Ce que ces tests verrouillent :
 * - la forme de clé est EXACTEMENT celle que `/api/avatar/create` écrit déjà ;
 * - la propriété est plus stricte que `clePossedeePar` : ni préfixe partagé,
 *   ni vidéo générée, ni traversée, ni autre domaine ;
 * - `purposeAcceptable('avatar')` est refusé — les routes d'envoi génériques
 *   ne fabriquent jamais une clé `<userId>/avatar/…` ;
 * - le nettoyage ne touche ni une autre personne, ni une génération payée,
 *   ni la source conservée ; l'absence et l'échec du stockage rendent `false`
 *   sans lever.
 */

const stockage = vi.hoisted(() => ({
  retires: [] as string[],
  panne: null as null | 'lever' | 'erreur',
  objets: new Map<string, number>(),
}));

vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        remove: async (cles: string[]) => {
          if (bucket !== 'media') throw new Error(`bucket inattendu ${bucket}`);
          if (stockage.panne === 'lever') throw new Error('minio injoignable');
          if (stockage.panne === 'erreur') return { data: null, error: { message: 'AccessDenied' } };
          // S3 : supprimer un objet absent réussit silencieusement.
          for (const c of cles) { stockage.retires.push(c); stockage.objets.delete(c); }
          return { data: cles, error: null };
        },
      }),
    },
  },
}));

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (_b: string, cle: string) => {
      if (stockage.panne === 'lever') throw new Error('minio injoignable');
      const taille = stockage.objets.get(cle);
      if (taille === undefined) throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
      return { size: taille };
    },
  }),
  lecteurMinio: () => ({ getObject: async () => ({ pipe() {} }) }),
}));

import {
  cleSourceAvatar, cleSourceAvatarDuCompte, cleAvatarDuCompte, typeSourceAvatar, extensionSourceAvatar,
  retirerSourceAvatar, sourceAvatarPresente, ouvrirSourceAvatar, BUCKET_AVATAR, TYPES_SOURCE_AUTORISES,
  cleSourceDepuisUrlLegacy,
} from '@/lib/avatar/source';
import * as pur from '@/lib/avatar/source-cle';
import {
  cleDansNamespaceAvatar, cleDansNamespaceLut, cleDansNamespaceMontage, purposeAcceptable, clePossedeePar,
  BUCKET_NAMESPACE_AVATAR, SEGMENT_NAMESPACE_AVATAR,
} from '@/lib/storage/acces-objet';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const GEN = '11111111-1111-4111-8111-000000000009';

beforeEach(() => {
  stockage.retires.length = 0;
  stockage.panne = null;
  stockage.objets.clear();
});

describe('cleSourceAvatar — construite par le serveur, dans la forme que main écrit déjà', () => {
  it('⚠️ `<userId>/avatar/source-<horodatage>.<ext>` — mot pour mot create/route.ts:212', () => {
    expect(cleSourceAvatar(U, 'mp4', 1757900000000)).toBe(`${U}/avatar/source-1757900000000.mp4`);
    expect(cleSourceAvatar(U, 'JPG', 7)).toBe(`${U}/avatar/source-7.jpg`);
    expect(BUCKET_AVATAR).toBe('media');
    expect(BUCKET_NAMESPACE_AVATAR).toBe('media');
    expect(SEGMENT_NAMESPACE_AVATAR).toBe('avatar');
  });

  it('la clé produite est reconnue par la règle de propriété ET par le namespace', () => {
    const cle = cleSourceAvatar(U, 'webm');
    expect(cleSourceAvatarDuCompte(cle, U)).toBe(true);
    expect(cleDansNamespaceAvatar('media', cle)).toBe(true);
    expect(clePossedeePar(cle, U)).toBe(true);
    expect(typeSourceAvatar(cle)).toBe('video/webm');
  });

  it('refuse un compte non-UUID, un format inconnu, un horodatage invalide — rien n’est deviné', () => {
    expect(() => cleSourceAvatar('../autre', 'mp4')).toThrow(/compte/);
    expect(() => cleSourceAvatar(U, 'gif')).toThrow(/format/);
    expect(() => cleSourceAvatar(U, 'mp4/../x')).toThrow(/format/);
    expect(() => cleSourceAvatar(U, 'mp4', -1)).toThrow(/horodatage/);
    expect(() => cleSourceAvatar(U, 'mp4', 1.5)).toThrow(/horodatage/);
  });

  it('les formats autorisés sont ceux du fournisseur : images et vidéos, pas d’audio ni de gif', () => {
    expect(Object.keys(TYPES_SOURCE_AUTORISES).sort()).toEqual(['jpeg', 'jpg', 'mov', 'mp4', 'png', 'webm', 'webp']);
    expect(extensionSourceAvatar('Moi.MOV')).toBe('mov');
    expect(extensionSourceAvatar('moi.mp3')).toBeNull();
    expect(extensionSourceAvatar('sansextension')).toBeNull();
  });
});

describe('source-cle — le module pur, seule définition de la forme', () => {
  it('source.ts ré-exporte source-cle : une seule règle, pas deux', () => {
    expect(typeSourceAvatar).toBe(pur.typeSourceAvatar);
    expect(extensionSourceAvatar).toBe(pur.extensionSourceAvatar);
    expect(TYPES_SOURCE_AUTORISES).toBe(pur.TYPES_SOURCE_AUTORISES);
  });

  it('estCleSourceAvatar : trois segments, `avatar`, nom source-<ts>.<ext> — pour n’importe quel compte', () => {
    expect(pur.estCleSourceAvatar(`${U}/avatar/source-1.jpg`)).toBe(true);
    expect(pur.estCleSourceAvatar(`${AUTRUI}/avatar/source-1.jpg`)).toBe(true);
    expect(pur.estCleSourceAvatar(`${U}/avatar/${GEN}.mp4`)).toBe(false);
    expect(pur.estCleSourceAvatar(`/avatar/source-1.jpg`)).toBe(false);
    expect(pur.estCleSourceAvatar(`${U}/avatar/x/source-1.jpg`)).toBe(false);
    expect(pur.estCleSourceAvatar(null)).toBe(false);
  });

  it('le module pur n’importe ni base ni stockage', () => {
    expect(Object.keys(pur).sort()).toEqual([
      'NOM_SOURCE_AVATAR', 'SEGMENT_SOURCE_AVATAR', 'TYPES_SOURCE_AUTORISES',
      'estCleSourceAvatar', 'extensionSourceAvatar', 'typeSourceAvatar',
    ]);
  });
});

describe('cleSourceDepuisUrlLegacy — la forme exacte de getPublicUrl(), et la propriété', () => {
  const RELAIS = 'https://studiio.pro/storage/v1/object/public/media';

  it('extrait la clé d’un source_url du compte (absolu ou relatif)', () => {
    expect(cleSourceDepuisUrlLegacy(`${RELAIS}/${U}/avatar/source-1757000000000.jpg`, U)).toBe(`${U}/avatar/source-1757000000000.jpg`);
    expect(cleSourceDepuisUrlLegacy(`/storage/v1/object/public/media/${U}/avatar/source-1.mp4`, U)).toBe(`${U}/avatar/source-1.mp4`);
  });

  it('⚠️ refuse : autre compte, autre bucket, autre namespace, vidéo générée', () => {
    expect(cleSourceDepuisUrlLegacy(`${RELAIS}/${AUTRUI}/avatar/source-1.jpg`, U)).toBeNull();
    expect(cleSourceDepuisUrlLegacy(`https://studiio.pro/storage/v1/object/public/videos/${U}/avatar/source-1.jpg`, U)).toBeNull();
    expect(cleSourceDepuisUrlLegacy(`${RELAIS}/${U}/lut/source-1.jpg`, U)).toBeNull();
    expect(cleSourceDepuisUrlLegacy(`${RELAIS}/${U}/avatar/${GEN}.mp4`, U)).toBeNull();
  });

  it('refuse : domaine/chemin forgé, préfixe répété, query/fragment/encodage, malformé, vide', () => {
    for (const url of [
      `https://evil.example/${U}/avatar/source-1.jpg`,
      `https://evil.example/x/storage/v1/object/public/media/${U}/avatar/source-1.jpg/../${AUTRUI}/avatar/source-1.jpg`,
      `${RELAIS}/${U}/avatar/source-1.jpg?x=1`,
      `${RELAIS}/${U}/avatar/source-1.jpg#f`,
      `${RELAIS}/${U}%2Favatar%2Fsource-1.jpg`,
      `${RELAIS}/x${RELAIS}/${U}/avatar/source-1.jpg`,
      `${RELAIS}/`,
      `${RELAIS}`,
      'pas une url', '', null, undefined, 42,
    ]) {
      expect(cleSourceDepuisUrlLegacy(url, U), String(url)).toBeNull();
    }
  });
});

describe('cleSourceAvatarDuCompte — la propriété, stricte', () => {
  const mienne = `${U}/avatar/source-1.mp4`;

  it('la source de ce compte : oui ; la même clé pour un autre compte : non', () => {
    expect(cleSourceAvatarDuCompte(mienne, U)).toBe(true);
    expect(cleSourceAvatarDuCompte(mienne, AUTRUI)).toBe(false);
    expect(cleSourceAvatarDuCompte(`${AUTRUI}/avatar/source-1.mp4`, U)).toBe(false);
  });

  it('⚠️ une vidéo GÉNÉRÉE (`<userId>/avatar/<uuid>.mp4`) n’est PAS une source', () => {
    const generee = `${U}/avatar/${GEN}.mp4`;
    expect(cleSourceAvatarDuCompte(generee, U)).toBe(false);
    // …mais elle est bien dans le domaine avatar du compte.
    expect(cleAvatarDuCompte(generee, U)).toBe(true);
    expect(cleAvatarDuCompte(generee, AUTRUI)).toBe(false);
    // Le domaine est plus large (suffixe libre) : là, la traversée doit être refusée explicitement.
    expect(cleAvatarDuCompte(`${U}/avatar/../${AUTRUI}/avatar/x.mp4`, U)).toBe(false);
    expect(cleAvatarDuCompte(`${U}/avatar/x.mp4\\y`, U)).toBe(false);
  });

  it('traversée, encodage, backslash, schéma, contrôle → refusés', () => {
    for (const cle of [
      `${U}/avatar/../${AUTRUI}/avatar/source-1.mp4`,
      `${U}/avatar/source-1.mp4/..`,
      `${U}%2Favatar%2Fsource-1.mp4`,
      `${U}/avatar/source-1.mp4\\x`,
      `https://x/${U}/avatar/source-1.mp4`,
      `${U}/avatar/source-1.mp4${String.fromCharCode(0)}`,
      `/${U}/avatar/source-1.mp4`,
      `${U}//avatar/source-1.mp4`,
      `${U}/avatar//source-1.mp4`,
      `${U}/Avatar/source-1.mp4`,
      `${U}/avatar/sous/source-1.mp4`,
      `${U}/avatar/source-1.mp3`,
      `${U}/avatar/source-.mp4`,
      `${U}/avatar/source-1.mp4.exe`,
      '', null, undefined, 42,
    ]) {
      expect(cleSourceAvatarDuCompte(cle, U), String(cle)).toBe(false);
    }
  });

  it('⚠️ plus strict que clePossedeePar : un préfixe partagé (`converted/`) n’est jamais une source', () => {
    const partagee = 'converted/source-1.mp4';
    expect(clePossedeePar(partagee, U)).toBe(true);
    expect(cleSourceAvatarDuCompte(partagee, U)).toBe(false);
    expect(cleAvatarDuCompte(partagee, U)).toBe(false);
  });

  it('un compte non-UUID ne possède rien, même sa propre clé', () => {
    expect(cleSourceAvatarDuCompte('moi/avatar/source-1.mp4', 'moi')).toBe(false);
  });
});

describe('namespaces — avatar est distinct de lut et montage, et fermé à l’écriture générique', () => {
  it('cleDansNamespaceAvatar reconnaît le segment entouré, dans le bucket media seulement', () => {
    expect(cleDansNamespaceAvatar('media', `${U}/avatar/source-1.mp4`)).toBe(true);
    expect(cleDansNamespaceAvatar('media', `${U}%2Favatar%2Fx.mp4`)).toBe(true);
    expect(cleDansNamespaceAvatar('videos', `${U}/avatar/source-1.mp4`)).toBe(false);
    expect(cleDansNamespaceAvatar('media', 'avatar/x.mp4')).toBe(false);
    expect(cleDansNamespaceAvatar('media', `${U}/avatar`)).toBe(false);
    expect(cleDansNamespaceAvatar('media', `${U}/avatars/x.mp4`)).toBe(false);
    expect(cleDansNamespaceAvatar('media', `${U}/lut/x.cube`)).toBe(false);
  });

  it('une clé avatar n’est ni lut ni montage, et réciproquement', () => {
    const avatar = `${U}/avatar/source-1.mp4`;
    expect(cleDansNamespaceLut('media', avatar)).toBe(false);
    expect(cleDansNamespaceMontage('media', avatar)).toBe(false);
    expect(cleDansNamespaceAvatar('media', `${U}/lut/x.cube`)).toBe(false);
  });

  it('⚠️ purposeAcceptable refuse « avatar », comme « analyse » et « lut » ; le reste passe encore', () => {
    expect(purposeAcceptable('avatar')).toBe(false);
    expect(purposeAcceptable('analyse')).toBe(false);
    expect(purposeAcceptable('lut')).toBe(false);
    expect(purposeAcceptable('rush')).toBe(true);
    expect(purposeAcceptable('media')).toBe(true);
  });
});

describe('retirerSourceAvatar — limité à MA source périmée, jamais à une vidéo, ne lève jamais', () => {
  const ancienne = `${U}/avatar/source-1.mp4`;
  const nouvelle = `${U}/avatar/source-2.mp4`;

  it('retire une source périmée du compte', async () => {
    stockage.objets.set(ancienne, 10);
    expect(await retirerSourceAvatar(U, ancienne, nouvelle)).toBe(true);
    expect(stockage.retires).toEqual([ancienne]);
  });

  it('⚠️ jamais la clé d’un autre compte — le stockage n’est même pas appelé', async () => {
    stockage.objets.set(`${AUTRUI}/avatar/source-1.mp4`, 10);
    expect(await retirerSourceAvatar(U, `${AUTRUI}/avatar/source-1.mp4`)).toBe(false);
    expect(await retirerSourceAvatar(U, `${U}/avatar/../${AUTRUI}/avatar/source-1.mp4`)).toBe(false);
    expect(stockage.retires).toEqual([]);
  });

  it('⚠️ jamais une vidéo générée (payée), même du bon compte', async () => {
    const generee = `${U}/avatar/${GEN}.mp4`;
    stockage.objets.set(generee, 10);
    expect(await retirerSourceAvatar(U, generee)).toBe(false);
    expect(stockage.retires).toEqual([]);
  });

  it('⚠️ jamais la source CONSERVÉE (la nouvelle)', async () => {
    stockage.objets.set(nouvelle, 10);
    expect(await retirerSourceAvatar(U, nouvelle, nouvelle)).toBe(false);
    expect(stockage.retires).toEqual([]);
  });

  it('jamais un préfixe partagé ni une clé d’un autre domaine', async () => {
    expect(await retirerSourceAvatar(U, 'converted/source-1.mp4')).toBe(false);
    expect(await retirerSourceAvatar(U, `${U}/lut/source-1.mp4`)).toBe(false);
    expect(await retirerSourceAvatar(U, `${U}/source-1.mp4`)).toBe(false);
    expect(stockage.retires).toEqual([]);
  });

  it('source absente : le retrait est idempotent (true), sans lever', async () => {
    expect(await retirerSourceAvatar(U, ancienne, nouvelle)).toBe(true);
    expect(stockage.retires).toEqual([ancienne]);
  });

  it('⚠️ stockage en panne (exception OU erreur rendue) → false, sans lever', async () => {
    stockage.objets.set(ancienne, 10);
    stockage.panne = 'lever';
    await expect(retirerSourceAvatar(U, ancienne, nouvelle)).resolves.toBe(false);
    stockage.panne = 'erreur';
    await expect(retirerSourceAvatar(U, ancienne, nouvelle)).resolves.toBe(false);
    expect(stockage.retires).toEqual([]);
  });
});

describe('sourceAvatarPresente / ouvrirSourceAvatar — après le contrôle de propriété seulement', () => {
  const mienne = `${U}/avatar/source-1.mp4`;

  it('présente si l’objet existe, non vide, et au compte', async () => {
    stockage.objets.set(mienne, 1024);
    expect(await sourceAvatarPresente(U, mienne)).toBe(true);
    expect(await sourceAvatarPresente(AUTRUI, mienne)).toBe(false);
    stockage.objets.set(mienne, 0);
    expect(await sourceAvatarPresente(U, mienne)).toBe(false);
  });

  it('absente ou stockage en panne → false, sans lever', async () => {
    expect(await sourceAvatarPresente(U, mienne)).toBe(false);
    stockage.objets.set(mienne, 1024);
    stockage.panne = 'lever';
    await expect(sourceAvatarPresente(U, mienne)).resolves.toBe(false);
  });

  it('ouvrir : null pour une clé qui n’est pas au compte ; flux + type + taille sinon', async () => {
    stockage.objets.set(mienne, 2048);
    expect(await ouvrirSourceAvatar(AUTRUI, mienne)).toBeNull();
    expect(await ouvrirSourceAvatar(U, `${U}/avatar/${GEN}.mp4`)).toBeNull();
    const r = await ouvrirSourceAvatar(U, mienne);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('video/mp4');
    expect(r!.taille).toBe(2048);
  });
});

describe('AVATAR-2B — le fournisseur ne dépend d’aucune URL publique', () => {
  it('⚠️ HeyGen reçoit les octets en multipart (uploadAsset), jamais source_url', () => {
    const heygen = readFileSync(resolve(__dirname, '../lib/avatar/heygen.ts'), 'utf8');
    const create = readFileSync(resolve(__dirname, '../app/api/avatar/create/route.ts'), 'utf8');
    expect(heygen).not.toMatch(/source_url|sourceUrl|getPublicUrl/);
    // Le POST envoie le buffer reçu ; la seule URL publique produite ne part
    // qu'en base (localisateur legacy), jamais vers le fournisseur.
    expect(create).toMatch(/uploadAsset\(\s*new Blob\(\[buffer\]/);
    expect(create).not.toMatch(/uploadAsset\([^)]*sourceUrl/);
    expect(create).not.toMatch(/createAvatarFromAsset\([^)]*sourceUrl/);
  });
});
