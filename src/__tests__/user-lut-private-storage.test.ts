/**
 * A_9b — UN LOOK IMPORTÉ NE SE TÉLÉCHARGE PAS SANS SESSION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE AVANT MÊME L'INTERFACE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un `.cube` est le travail d'étalonnage de quelqu'un — parfois acheté,
 * parfois vendu. Le relais public sert tout objet d'un compartiment autorisé
 * SANS SESSION : ranger les LUT dans `media` sans fermer le namespace en même
 * temps en ferait un catalogue en libre-service, téléchargeable par quiconque
 * devine deux identifiants.
 *
 * A_8b a payé cette leçon sur les visages. La règle qui en est sortie tient en
 * une phrase, et elle est vérifiée ici pour la troisième fois :
 *
 *   ON REFUSE À L'ÉCRITURE CE QU'ON REFUSE À LA LECTURE.
 *
 * Fermer la lecture sans fermer l'écriture laisserait les routes d'envoi
 * fabriquer une clé `<userId>/lut/…` que notre propre serveur rendrait ensuite
 * illisible — sans message, sans trace, et sans que personne comprenne.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cleDansNamespaceLut, cleDansNamespaceAvatar, cleDansNamespaceAnalyse,
  purposeAcceptable, SEGMENT_NAMESPACE_LUT, BUCKET_NAMESPACE_LUT,
} from '@/lib/storage/acces-objet';
import {
  cleLutUtilisateur, cleLutValide, empreinteValide, nomLutValide,
  lutUtilisateurValide, lutsUtilisateurValides,
  LUTS_UTILISATEUR_MAX, NOM_LUT_MAX, OCTETS_LUT_MAX,
} from '@/lib/creatif/lut-utilisateur';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const PROXY = lire('src/app/storage/v1/object/public/[bucket]/[...path]/route.ts');

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const E = 'a'.repeat(64);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le namespace privé', () => {
  it('1.1 ⚠️ UNE CLÉ DE LUT EST DANS LE NAMESPACE REFUSÉ', () => {
    const cle = cleLutUtilisateur(U, E);
    expect(cle).toBe(`${U}/${SEGMENT_NAMESPACE_LUT}/${E}.cube`);
    expect(cleDansNamespaceLut(BUCKET_NAMESPACE_LUT, cle)).toBe(true);
  });

  it('1.2 le namespace ne mord pas sur les autres compartiments', () => {
    expect(cleDansNamespaceLut('videos', `${U}/lut/x.cube`)).toBe(false);
    expect(cleDansNamespaceLut('audio', `${U}/lut/x.cube`)).toBe(false);
  });

  it('1.3 ⚠️ LES FORMES ENCODÉES SONT COUVERTES', () => {
    /* Un `%6cut` ne doit pas échapper au refus en désignant malgré tout le
       même objet — la garde que les vignettes et les avatars ont déjà. */
    for (const cle of [
      `${U}/%6cut/${E}.cube`,
      `${U}/lut%2F${E}.cube`,
      `${U}/lut/sous/${E}.cube`,
    ]) {
      expect(cleDansNamespaceLut('media', cle), cle).toBe(true);
    }
  });

  it('1.4 les namespaces voisins n’ont pas bougé', () => {
    // On ajoute une garde, on n'en déplace aucune.
    expect(cleDansNamespaceAvatar('media', `${U}/avatar/source-1.mp4`)).toBe(true);
    expect(cleDansNamespaceAnalyse('media', `${U}/analyse/a1/v.jpg`)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le relais public refuse', () => {
  it('2.1 ⚠️ LE PROXY PUBLIC INTERROGE LA GARDE LUT', () => {
    expect(PROXY).toContain('cleDansNamespaceLut(bucket, storagePath)');
  });

  it('2.2 le refus arrive AVANT tout appel au stockage', () => {
    /* Un chemin refusé ne doit pas coûter une requête au stockage — et
       surtout ne doit pas permettre d'en SONDER l'existence. */
    const garde = PROXY.indexOf('cleDansNamespaceLut');
    const appel = PROXY.indexOf('cibleRecevable(bucket, storagePath)');
    expect(garde).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(garde);
  });

  it('2.3 ⚠️ ON REFUSE À L’ÉCRITURE CE QU’ON REFUSE À LA LECTURE', () => {
    expect(purposeAcceptable(SEGMENT_NAMESPACE_LUT)).toBe(false);
    expect(purposeAcceptable('avatar')).toBe(false);
    expect(purposeAcceptable('analyse')).toBe(false);
    // Les usages légitimes restent ouverts.
    expect(purposeAcceptable('library')).toBe(true);
    expect(purposeAcceptable('rushes')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La clé porte la propriété', () => {
  it('3.1 ⚠️ LA CLÉ D’UN AUTRE COMPTE EST REFUSÉE', () => {
    expect(cleLutValide(cleLutUtilisateur(AUTRUI, E), U)).toBe(false);
    expect(cleLutValide(cleLutUtilisateur(U, E), U)).toBe(true);
  });

  it('3.2 ⚠️ AUCUNE TRAVERSÉE NE SORT DU NAMESPACE', () => {
    for (const cle of [
      `${U}/lut/../../etc/passwd`,
      `${U}/lut/..%2F..%2Fpasswd`,
      `${U}/lut/x\\y.cube`,
      `https://ailleurs/${U}/lut/x.cube`,
      `../${U}/lut/x.cube`,
    ]) {
      expect(cleLutValide(cle, U), cle).toBe(false);
    }
  });

  it('3.3 la clé est faite de l’empreinte, jamais du nom de fichier', () => {
    /* C'est ce qui rend un nom de fichier piégé inoffensif : il ne participe
       pas au chemin. */
    expect(cleLutUtilisateur(U, E)).not.toContain('.cube.cube');
    expect(cleLutUtilisateur(U, E).endsWith(`${E}.cube`)).toBe(true);
  });

  it('3.4 une empreinte doit être un vrai SHA-256 hexadécimal', () => {
    expect(empreinteValide(E)).toBe(true);
    expect(empreinteValide('A'.repeat(64))).toBe(false);
    expect(empreinteValide('a'.repeat(63))).toBe(false);
    expect(empreinteValide(42)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Ce qui entre au catalogue', () => {
  const valide = {
    empreinte: E, cle: cleLutUtilisateur(U, E), nom: 'Mon Cinéma', titre: 'MyCinema',
    octets: 110_000, taille: 16, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
    importeeLe: '2026-09-09T10:00:00.000Z',
  };

  it('4.1 une entrée complète est relue telle quelle', () => {
    expect(lutUtilisateurValide(valide, U)).toEqual(valide);
  });

  it('4.2 ⚠️ SANS COMPTE, ON NE DEVINE PAS', () => {
    // Même règle que la banque audio : relire sans savoir à qui appartient la
    // clé laisserait entrer celle d'un tiers.
    expect(lutsUtilisateurValides([valide], '')).toEqual([]);
    expect(lutUtilisateurValide(valide, AUTRUI)).toBeNull();
  });

  it('4.3 les entrées incohérentes sont écartées, pas réparées', () => {
    expect(lutUtilisateurValide({ ...valide, empreinte: 'court' }, U)).toBeNull();
    expect(lutUtilisateurValide({ ...valide, nom: '   ' }, U)).toBeNull();
    expect(lutUtilisateurValide({ ...valide, taille: 1 }, U)).toBeNull();
    expect(lutUtilisateurValide({ ...valide, taille: 128 }, U)).toBeNull();
    expect(lutUtilisateurValide({ ...valide, octets: 0 }, U)).toBeNull();
    expect(lutUtilisateurValide({ ...valide, octets: OCTETS_LUT_MAX + 1 }, U)).toBeNull();
  });

  it('4.4 ⚠️ LES DOUBLONS D’EMPREINTE SONT FONDUS', () => {
    const deux = lutsUtilisateurValides([valide, { ...valide, nom: 'Copie' }], U);
    expect(deux).toHaveLength(1);
    expect(deux[0].nom).toBe('Mon Cinéma');
  });

  it('4.5 le catalogue est borné', () => {
    const beaucoup = Array.from({ length: LUTS_UTILISATEUR_MAX + 10 }, (_, i) => ({
      ...valide,
      empreinte: i.toString(16).padStart(64, '0'),
      cle: cleLutUtilisateur(U, i.toString(16).padStart(64, '0')),
    }));
    expect(lutsUtilisateurValides(beaucoup, U)).toHaveLength(LUTS_UTILISATEUR_MAX);
  });

  it('4.6 le nom est borné et nettoyé, pas rejeté', () => {
    expect(nomLutValide(`  ${'x'.repeat(200)}  `)).toHaveLength(NOM_LUT_MAX);
    expect(nomLutValide('Mon\nLook')).toBe('Mon Look');
    expect(nomLutValide('')).toBeNull();
  });
});
