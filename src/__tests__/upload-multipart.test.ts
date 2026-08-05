import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  planParts, aggregateProgress, backoffMs,
  PART_SIZE, MULTIPART_THRESHOLD, MAX_TENTATIVES,
} from '@/lib/storage/uploadFile';

/**
 * Envoi découpé et reprenable.
 *
 * ⚠️ LE PROBLÈME N'ÉTAIT PAS LE DÉBIT, C'ÉTAIT L'ABSENCE DE POINT DE REPRISE.
 *
 * Un envoi en un seul `PUT` est tout ou rien : quelques secondes de Wi-Fi
 * perdues, un basculement 4G, et la totalité du transfert est annulée quel
 * qu'en soit l'avancement. D'où des échecs à 39 % ou 45 % sur des fichiers
 * courts, alors que le serveur poussait 5 Mo à 14 Mio/s sans broncher : la
 * coupure n'était pas de son côté.
 *
 * Découper rend chaque morceau ré-essayable — une coupure ne coûte plus que
 * le morceau en cours.
 */

const helper = readFileSync(resolve(__dirname, '../lib/storage/uploadFile.ts'), 'utf-8');
const route = readFileSync(resolve(__dirname, '../app/api/upload/multipart/route.ts'), 'utf-8');
const library = readFileSync(resolve(__dirname, '../components/shared/MediaLibrary.tsx'), 'utf-8');

describe('Le découpage', () => {
  it('couvre le fichier ENTIER, sans trou ni chevauchement', () => {
    // Une erreur d'un octet aux bornes produit un fichier corrompu que seul
    // un visionnage révélerait.
    const taille = PART_SIZE * 3 + 1234;
    const parts = planParts(taille);
    expect(parts[0].start).toBe(0);
    expect(parts[parts.length - 1].end).toBe(taille);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i].start).toBe(parts[i - 1].end);
    }
    expect(parts.reduce((n, p) => n + (p.end - p.start), 0)).toBe(taille);
  });

  it('numérote à partir de 1 — S3 refuse le morceau 0', () => {
    expect(planParts(PART_SIZE * 2)[0].partNumber).toBe(1);
    expect(planParts(PART_SIZE * 2)[1].partNumber).toBe(2);
  });

  it('le dernier morceau peut être plus petit, les autres non', () => {
    // S3 impose 5 Mio minimum pour tout morceau sauf le dernier.
    const parts = planParts(PART_SIZE + 10);
    expect(parts).toHaveLength(2);
    expect(parts[0].end - parts[0].start).toBe(PART_SIZE);
    expect(parts[1].end - parts[1].start).toBe(10);
    expect(PART_SIZE).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it('un fichier plus petit qu un morceau en fait un seul', () => {
    expect(planParts(1024)).toHaveLength(1);
  });

  it('une taille absurde ne produit rien', () => {
    expect(planParts(0)).toEqual([]);
    expect(planParts(Number.NaN)).toEqual([]);
  });
});

describe('La progression agrégée', () => {
  it('compte les morceaux TERMINÉS plus celui en cours', () => {
    // Sans le morceau en cours, la barre resterait figée pendant 8 Mio puis
    // sauterait d'un cran.
    expect(aggregateProgress(0, 0, 100)).toBe(0);
    expect(aggregateProgress(50, 25, 100)).toBe(75);
    expect(aggregateProgress(100, 0, 100)).toBe(100);
  });

  it('ne dépasse jamais 100 %', () => {
    expect(aggregateProgress(90, 50, 100)).toBe(100);
  });

  it('une taille inconnue rend 0, pas « Infinity »', () => {
    expect(aggregateProgress(10, 0, 0)).toBe(0);
    expect(aggregateProgress(10, 0, Number.NaN)).toBe(0);
  });
});

describe('La reprise', () => {
  it('trois tentatives, avec attente croissante', () => {
    expect(MAX_TENTATIVES).toBe(3);
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(2)).toBe(1000);
    expect(backoffMs(3)).toBe(2000);
  });

  it('elle est plafonnée — on ne fait pas attendre une minute', () => {
    expect(backoffMs(20)).toBeLessThanOrEqual(8000);
  });

  it('elle couvre AUSSI l envoi en un bloc', () => {
    // Les petits fichiers subissaient les mêmes micro-coupures.
    expect(helper).toContain("), 'envoi');");
  });

  it('un morceau raté est ré-essayé sans tout recommencer', () => {
    expect(helper).toContain('`morceau ${m.partNumber}/${morceaux.length}`');
  });
});

describe('Le seuil de bascule', () => {
  it('en dessous, l envoi reste en un bloc', () => {
    // Découper coûterait trois allers-retours de signature pour rien.
    expect(helper).toContain('if (file.size > MULTIPART_THRESHOLD) {');
    expect(MULTIPART_THRESHOLD).toBe(8 * 1024 * 1024);
  });

  it('un endpoint public absent fait retomber sur l envoi en un bloc', () => {
    // Et SEULEMENT ce cas : masquer une autre erreur ferait recommencer
    // 300 Mo en un seul PUT.
    expect(route).toContain('unsupported: true');
    expect(helper).toContain("if (!(err as { unsupported?: boolean })?.unsupported) throw err;");
  });
});

describe('L ETag — sans lui, rien ne se recolle', () => {
  it('il est lu sur la réponse de chaque morceau', () => {
    expect(helper).toContain("xhr.getResponseHeader('ETag')");
  });

  it('son absence est signalée pour ce qu elle est', () => {
    // Tous les octets sont arrivés, mais l'assemblage est impossible : le
    // message doit désigner la configuration CORS, pas le réseau.
    expect(helper).toContain('Access-Control-Expose-Headers');
  });

  it('les guillemets sont retirés des deux côtés', () => {
    // MinIO rend `"abc"` ; le comparer tel quel ferait échouer l'assemblage.
    expect(helper).toContain("etag.replace(/\"/g, '')");
    expect(route).toContain("String(p.ETag).replace(/\"/g, '')");
  });

  it('les morceaux sont réordonnés avant l assemblage', () => {
    // MinIO les exige ordonnés ; une reprise peut les avoir désordonnés.
    expect(route).toContain('.sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber))');
  });
});

describe('La route multipart', () => {
  it('elle contrôle le périmètre du chemin', () => {
    // Sans ça, un appelant pourrait poursuivre l'envoi d'un autre.
    expect(route).toContain('function cheminAutorise');
    expect(route).toContain("storagePath.startsWith(`${userId}/`)");
    expect(route).toContain("!storagePath.includes('..')");
  });

  it('elle exige une session', () => {
    expect(route).toContain("{ success: false, error: 'Unauthorized' }");
  });

  it('un envoi raté est ABANDONNÉ côté serveur', () => {
    // Les morceaux déposés n'appartiennent à aucun objet tant que l'envoi
    // n'est ni terminé ni abandonné : ils resteraient facturés et invisibles.
    expect(helper).toContain("action: 'abort'");
    expect(route).toContain('abortMultipartUpload');
  });

  it('la région est fixée — la signature reste locale', () => {
    // Sinon le SDK demande la région au serveur avant CHAQUE morceau.
    expect(route).toContain("region: process.env.MINIO_REGION || 'us-east-1'");
  });

  it('l URL de lecture ne change pas', () => {
    expect(route).toContain('`/storage/v1/object/public/${bucket}/${key}`');
  });
});

describe('La Médiathèque en profite sans rien changer', () => {
  it('elle passe toujours par le helper partagé', () => {
    expect(library).toContain('await uploadFile(file, {');
    expect(library).toContain('onProgress: setProgress,');
  });
});
