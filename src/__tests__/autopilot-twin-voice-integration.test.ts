/**
 * A_8g — LA CHAÎNE AUTOPILOTE RÉSOUT LA VOIX DU JUMEAU, ET NE PRODUIT RIEN À SA PLACE.
 *
 * Le comportement de la préparation (avatar, voix, texte parlé) est prouvé
 * sur le vrai code dans `avatar-twin-user-voice.test.ts` — c'est la fonction
 * que la chaîne appelle. Ce fichier tient le BRANCHEMENT : que la chaîne
 * passe bien par elle, qu'un blocage devienne un motif nommé, qu'un jumeau
 * prêt ne rende pas une vidéo ordinaire, et que la voix-off classique des
 * comptes sans jumeau soit intouchée.
 *
 * ⚠️ LE CODE, PAS LES COMMENTAIRES — la règle du dépôt pour ce genre de garde.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MOTIFS_M3 } from '@/lib/autopilot/automatique/contrat';

const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CHAINE = sansProse(readFileSync(
  path.join(process.cwd(), 'src/lib/autopilot/automatique/chaine-serveur.ts'), 'utf8',
));

describe('A_8g — le branchement dans la chaîne', () => {
  it('⚠️ LA CHAÎNE PASSE PAR `preparerJumeauDuCompte` — voix ET parole, une seule porte', () => {
    expect(CHAINE).toContain("import { preparerJumeauDuCompte } from '@/lib/avatar/jumeau-serveur'");
    expect(CHAINE).toMatch(/const preparation = await preparerJumeauDuCompte\(userId, configJumeau, biblio\)/);
    // L'ancienne lecture, qui ne résolvait que l'avatar, n'est plus appelée ici.
    expect(CHAINE).not.toContain('resoudreJumeauDuCompte(');
  });

  it('⚠️ BLOQUÉ = MOTIF NOMMÉ ; PRÊT = AUCUNE VIDÉO ORDINAIRE SOUS LE NOM DE LA PERSONNE', () => {
    const bloc = CHAINE.slice(CHAINE.indexOf('preparerJumeauDuCompte(userId'), CHAINE.indexOf('let profilEffectif'));
    expect(bloc).toMatch(/preparation\.etat === 'bloque'[\s\S]{0,80}motif: 'jumeau_non_pret'/);
    expect(bloc).toMatch(/preparation\.etat === 'pret'[\s\S]{0,600}motif: 'jumeau_indisponible'/);
    expect(MOTIFS_M3).toContain('jumeau_non_pret');
    expect(MOTIFS_M3).toContain('jumeau_indisponible');
  });

  it('⚠️ AUCUNE VOIX DE REPLI DANS LA CHAÎNE : ni première voix, ni catalogue, ni fournisseur', () => {
    expect(CHAINE).not.toMatch(/voix\[0\]|voices\[0\]|resolveVoiceId|listCatalogVoices|HEYGEN_FALLBACK_VOICE|elevenlabs\.io/);
  });

  it('le jumeau est résolu AVANT le style et la voix-off classique', () => {
    expect(CHAINE.indexOf('preparerJumeauDuCompte(userId')).toBeLessThan(CHAINE.indexOf('resoudreStyleEffectif('));
    expect(CHAINE.indexOf('preparerJumeauDuCompte(userId')).toBeLessThan(CHAINE.indexOf('biblio.voixOff && recetteEffective'));
  });

  it('⚠️ LA VOIX-OFF CLASSIQUE DES COMPTES SANS JUMEAU EST INTOUCHÉE', () => {
    expect(CHAINE).toContain(`  if (biblio.voixOff && recetteEffective) {
    recetteEffective = {
      ...recetteEffective,
      voix: {
        bucket: BUCKET_MUSIQUE,
        cle: biblio.voixOff.cle,
        version: biblio.voixOff.empreinte,
      },
    };
  }`);
    // Éteint, le jumeau sort avant toute lecture : le chemin d'avant, sans requête de plus.
    expect(CHAINE).toMatch(/if \(!jumeauHistorique\(configJumeau\) && configJumeau\.active\) \{/);
  });
});
