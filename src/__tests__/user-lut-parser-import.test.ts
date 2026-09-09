/**
 * A_9b — CE QU'ON ACCEPTE D'APPELER « UNE LUT ».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA PANNE QUE CE FICHIER EMPÊCHE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Une LUT acceptée à l'import et ignorée au rendu. Elle apparaîtrait dans la
 * bibliothèque, se mettrait en favori, se choisirait dans un montage — et ne
 * changerait rien à l'image. L'utilisateur chercherait le défaut dans sa
 * vidéo, jamais dans son fichier.
 *
 * D'où deux règles qui gouvernent tout ce module :
 *
 *   1. NI L'EXTENSION NI LE MIME NE SONT CRUS. C'est le contenu qui tranche.
 *   2. CE QUE LE RENDU NE SAIT PAS FAIRE EST REFUSÉ À L'ENTRÉE, avec un motif
 *      nommé — les LUT 1D en particulier, que `lut3d` ignore depuis A_2.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  lireLutUtilisateur, empreinteLut, nomParDefaut,
  MOTIFS_IMPORT_LUT, MESSAGES_IMPORT_LUT,
} from '@/lib/luts/import-utilisateur';
import { OCTETS_LUT_MAX, TAILLE_CUBE_MAX } from '@/lib/creatif/lut-utilisateur';

const octets = (s: string) => Buffer.from(s, 'utf8');

/** Un vrai cube 3D, écrit comme un exportateur l'écrirait. */
function cube(taille: number, entete = ''): string {
  const lignes = [
    '# Généré pour le test',
    entete,
    `LUT_3D_SIZE ${taille}`,
  ].filter((l) => l !== '');
  for (let b = 0; b < taille; b += 1) {
    for (let g = 0; g < taille; g += 1) {
      for (let r = 0; r < taille; r += 1) {
        const d = taille - 1;
        lignes.push(`${(r / d).toFixed(6)} ${(g / d).toFixed(6)} ${(b / d).toFixed(6)}`);
      }
    }
  }
  return `${lignes.join('\n')}\n`;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les vrais fichiers passent', () => {
  it('1.1 ⚠️ UN .CUBE NATIF DE STUDIIO EST ACCEPTÉ', () => {
    /* Le meilleur test de non-régression possible : ce que le produit rend
       déjà tous les jours doit pouvoir entrer par la porte d'import. */
    const brut = readFileSync(path.join(process.cwd(), 'public/luts/clean.cube'));
    const lu = lireLutUtilisateur(brut);
    expect(lu.ok).toBe(true);
    if (!lu.ok) return;
    expect(lu.mesure.taille).toBe(16);
    expect(lu.mesure.octets).toBe(brut.length);
  });

  it('1.2 ⚠️ UN 33³ RÉALISTE EST ACCEPTÉ, ET IL TIENT SOUS LA LIMITE', () => {
    // 33 pas par axe est le format courant du marché.
    const texte = cube(33);
    const brut = octets(texte);
    expect(brut.length).toBeLessThan(OCTETS_LUT_MAX);
    const lu = lireLutUtilisateur(brut);
    expect(lu.ok).toBe(true);
    if (lu.ok) expect(lu.mesure.taille).toBe(33);
  });

  it('1.3 TITLE et DOMAIN sont lus et conservés', () => {
    const lu = lireLutUtilisateur(octets(cube(
      4, 'TITLE "Mon Cinéma"\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0',
    )));
    expect(lu.ok).toBe(true);
    if (!lu.ok) return;
    expect(lu.mesure.titre).toBe('Mon Cinéma');
    expect(lu.mesure.domainMin).toEqual([0, 0, 0]);
    expect(lu.mesure.domainMax).toEqual([1, 1, 1]);
  });

  it('1.4 la notation scientifique passe', () => {
    const texte = 'LUT_3D_SIZE 2\n' + Array.from({ length: 8 },
      () => '1.0e-3 2.5E-1 0.0').join('\n') + '\n';
    expect(lireLutUtilisateur(octets(texte)).ok).toBe(true);
  });

  it('1.5 le BOM UTF-8 ne fait pas échouer un fichier valide', () => {
    /* Un exportateur Windows en ajoute un ; sans son retrait, le parseur lirait
       « ﻿LUT_3D_SIZE » comme une ligne de données. */
    expect(lireLutUtilisateur(octets('﻿' + cube(2))).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce qui est refusé, et pourquoi', () => {
  it('2.1 ⚠️ UNE LUT 1D EST REFUSÉE, AVEC SON MOTIF', () => {
    /* Le rendu applique `lut3d`. Accepter une 1D la ferait apparaître dans la
       bibliothèque et ne rien faire à l'image. */
    const texte = 'LUT_1D_SIZE 4\n0 0 0\n0.3 0.3 0.3\n0.6 0.6 0.6\n1 1 1\n';
    const lu = lireLutUtilisateur(octets(texte));
    expect(lu).toEqual({ ok: false, motif: 'lut_1d_non_supportee' });
    expect(MESSAGES_IMPORT_LUT.lut_1d_non_supportee).toContain('LUT 3D');
  });

  it('2.2 ⚠️ UN FICHIER TEXTE RENOMMÉ .CUBE EST REFUSÉ', () => {
    expect(lireLutUtilisateur(octets('bonjour')))
      .toEqual({ ok: false, motif: 'cube_invalide' });
  });

  it('2.3 ⚠️ UN FICHIER BINAIRE N’ATTEINT PAS LE PARSEUR', () => {
    /* `toString('utf8')` ne rejette rien : il remplace. Un binaire deviendrait
       un texte de la même taille, découpé en lignes et parcouru pour rien. */
    const binaire = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00]);
    expect(lireLutUtilisateur(binaire)).toEqual({ ok: false, motif: 'binaire' });
  });

  it('2.4 un fichier vide, ou seulement des commentaires', () => {
    expect(lireLutUtilisateur(Buffer.alloc(0)))
      .toEqual({ ok: false, motif: 'fichier_vide' });
    expect(lireLutUtilisateur(octets('   \n\t\n')))
      .toEqual({ ok: false, motif: 'fichier_vide' });
    expect(lireLutUtilisateur(octets('# rien que des commentaires\n# vraiment\n')))
      .toEqual({ ok: false, motif: 'cube_invalide' });
  });

  it('2.5 ⚠️ LE POIDS EST REFUSÉ AVANT LE DÉCODAGE', () => {
    const trop = Buffer.alloc(OCTETS_LUT_MAX + 1, 0x20);
    expect(lireLutUtilisateur(trop)).toEqual({ ok: false, motif: 'trop_volumineux' });
  });

  it('2.6 ⚠️ UN CUBE INCOMPLET NE SE COMPLÈTE PAS TOUT SEUL', () => {
    /* Un `.cube` tronqué dont on compléterait les triplets manquants par des
       zéros produirait un étalonnage faux mais plausible — le pire cas. */
    const texte = 'LUT_3D_SIZE 4\n0 0 0\n1 1 1\n';
    expect(lireLutUtilisateur(octets(texte)))
      .toEqual({ ok: false, motif: 'cube_invalide' });
  });

  it('2.7 des valeurs non finies sont refusées', () => {
    const texte = 'LUT_3D_SIZE 2\n' + Array.from({ length: 7 }, () => '0 0 0')
      .concat('NaN Infinity 0').join('\n') + '\n';
    expect(lireLutUtilisateur(octets(texte)))
      .toEqual({ ok: false, motif: 'cube_invalide' });
  });

  it('2.8 une taille hors bornes est refusée', () => {
    const trop = `LUT_3D_SIZE ${TAILLE_CUBE_MAX + 1}\n0 0 0\n`;
    expect(lireLutUtilisateur(octets(trop)).ok).toBe(false);
  });

  it('2.9 ⚠️ AUCUN MESSAGE DU PARSEUR N’EST RELAYÉ', () => {
    /* Ses messages nomment des numéros de ligne d'un fichier que l'appelant
       contrôle : les renvoyer ferait de la réponse un écho. */
    const lu = lireLutUtilisateur(octets('LUT_3D_SIZE 4\n0 0 0\n'));
    expect(lu.ok).toBe(false);
    if (lu.ok) return;
    expect(MESSAGES_IMPORT_LUT[lu.motif]).not.toMatch(/ligne \d+|triplets attendus/);
  });

  it('2.10 chaque motif porte une phrase', () => {
    for (const m of MOTIFS_IMPORT_LUT) expect(MESSAGES_IMPORT_LUT[m], m).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’empreinte identifie les octets', () => {
  it('3.1 ⚠️ C’EST UN SHA-256 DES OCTETS ORIGINAUX', () => {
    const brut = octets(cube(2));
    expect(empreinteLut(brut))
      .toBe(createHash('sha256').update(brut).digest('hex'));
    expect(empreinteLut(brut)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('3.2 ⚠️ DEUX ÉCRITURES DIFFÉRENTES DU MÊME CUBE SONT DEUX FICHIERS', () => {
    /* Un espace de plus, un commentaire : ce sont d'autres octets, donc une
       autre empreinte. Le rendu les distinguera, et c'est voulu. */
    const a = lireLutUtilisateur(octets(cube(2)));
    const b = lireLutUtilisateur(octets(`# une note\n${cube(2)}`));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.mesure.empreinte).not.toBe(b.mesure.empreinte);
  });

  it('3.3 les mêmes octets donnent la même empreinte, toujours', () => {
    const texte = cube(4);
    const premier = lireLutUtilisateur(octets(texte));
    for (let i = 0; i < 5; i += 1) {
      const suivant = lireLutUtilisateur(octets(texte));
      expect(premier.ok && suivant.ok
        && premier.mesure.empreinte === suivant.mesure.empreinte).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le nom affiché', () => {
  it('4.1 le TITLE gagne sur le nom de fichier', () => {
    expect(nomParDefaut('Mon Cinéma', 'export_final_v3.cube')).toBe('Mon Cinéma');
  });

  it('4.2 sans TITLE, le nom de fichier est nettoyé de son extension', () => {
    expect(nomParDefaut(null, 'SonyWarm.cube')).toBe('SonyWarm');
  });

  it('4.3 ⚠️ UN NOM DE FICHIER PIÉGÉ RESTE UN LIBELLÉ', () => {
    /* La clé vient de l'empreinte : un chemin dans le nom ne désigne rien. On
       vérifie quand même qu'il ne ressort pas tel quel à l'écran. */
    const nom = nomParDefaut(null, '../../etc/passwd.cube');
    expect(nom).toBe('passwd');
    expect(nom).not.toContain('/');
    expect(nom).not.toContain('..');
  });

  it('4.4 un nom vide retombe sur un libellé neutre', () => {
    expect(nomParDefaut(null, '')).toBe('Mon look');
    expect(nomParDefaut(null, '.cube')).toBe('Mon look');
  });
});
