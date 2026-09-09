/**
 * A_8f — DEUX PERSONNES NUMÉRIQUES NE PARTAGENT PAS UN FICHIER.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA PANNE QUE CE FICHIER EMPÊCHE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La réutilisation d'un rendu réussi est STRUCTURELLE : un index unique refuse
 * le second, l'appelant relit le premier. C'est une bonne chose — jusqu'au
 * jour où l'identité de la personne ne fait pas partie de la clé.
 *
 * Ce jour-là, réentraîner son clone, ou changer de voix, rend L'ANCIEN
 * FICHIER : l'ancien visage, l'ancienne voix, sans erreur et sans message. La
 * pire des pannes, celle qui ne se voit pas — appliquée cette fois au visage
 * de quelqu'un.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ET LA CONTREPARTIE, TOUT AUSSI IMPORTANTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le parc existant ne doit pas bouger d'un bit. Un compte sans personne
 * numérique — c'est-à-dire tout le monde aujourd'hui — doit obtenir
 * EXACTEMENT la valeur d'hier, sinon chaque rendu déjà réussi deviendrait
 * introuvable, serait recalculé, et serait refacturé.
 */
import { describe, it, expect } from 'vitest';
import {
  methodeRendu, empreinteRenduComplet, METHODE_RENDU,
  PREFIXE_METHODE_MIX, PREFIXE_METHODE_PROFIL, PREFIXE_METHODE_JUMEAU,
  LONGUEUR_METHODE_RENDU_MAX, LONGUEUR_EMPREINTE,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { PROFIL_CREATIF_DEFAUT } from '@/lib/autopilot/analyse/profil-creatif';
import type { IdentiteJumeau } from '@/lib/avatar/jumeau';

const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const AUTRE_AVATAR = 'eeeeeeee-5555-4555-8555-555555555555';
const VOIX_A = 'dddddddd-4444-4444-8444-444444444444';
const VOIX_B = 'ffffffff-6666-4666-8666-666666666666';

const V1: IdentiteJumeau = { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX_A };
const V2: IdentiteJumeau = { avatarId: AVATAR, avatarVersion: 2, userVoiceId: VOIX_A };

const MUSIQUE = {
  ...RECETTE_AUDIO_DEFAUT,
  musique: { bucket: 'media', cle: 'u/library/a.mp3', version: 'v1' },
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le parc existant ne bouge pas', () => {
  it('1.1 ⚠️ SANS PERSONNE NUMÉRIQUE, LA MÉTHODE EST CELLE D’HIER', () => {
    expect(methodeRendu(null, null, null)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null))
      .toBe(METHODE_RENDU);
  });

  it('1.2 ⚠️ ET L’EMPREINTE EST IDENTIQUE AU BIT PRÈS', () => {
    /* `undefined` et `null` doivent produire exactement ce que produisait
       l'appel à trois arguments : sinon tous les rendus réussis du parc
       deviennent introuvables. */
    const hier = empreinteRenduComplet(MUSIQUE, PROFIL_CREATIF_DEFAUT, null);
    expect(empreinteRenduComplet(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, null)).toBe(hier);
    expect(empreinteRenduComplet(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, undefined)).toBe(hier);
  });

  it('1.3 les trois cas historiques gardent leur préfixe', () => {
    expect(methodeRendu(MUSIQUE, null, null).startsWith(PREFIXE_METHODE_MIX)).toBe(true);
    expect(methodeRendu(null, null, { texte: 'Réserve ta place', destination: null })
      .startsWith(PREFIXE_METHODE_PROFIL)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Deux personnes, deux fichiers', () => {
  it('2.1 ⚠️ VERSION 1 ET VERSION 2 NE SONT PAS LA MÊME VIDÉO', () => {
    /* Réentraîner produit le même identifiant interne et une AUTRE personne
       numérique. Sans la version dans la clé, on resservirait l'ancien
       visage. */
    const a = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    const b = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V2);
    expect(a).not.toBe(b);
  });

  it('2.2 ⚠️ DEUX VOIX NE SONT PAS LA MÊME VIDÉO', () => {
    const a = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    const b = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null,
      { ...V1, userVoiceId: VOIX_B });
    expect(a).not.toBe(b);
  });

  it('2.3 deux avatars ne sont pas la même vidéo', () => {
    const a = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    const b = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null,
      { ...V1, avatarId: AUTRE_AVATAR });
    expect(a).not.toBe(b);
  });

  it('2.4 ⚠️ AVEC ET SANS PERSONNE NUMÉRIQUE NE SE CONFONDENT JAMAIS', () => {
    /* Même script, même style, même son : la vidéo où quelqu'un parle et
       celle où personne n'apparaît sont deux vidéos. */
    const sans = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null);
    const avec = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    expect(avec).not.toBe(sans);
    expect(avec.startsWith(PREFIXE_METHODE_JUMEAU)).toBe(true);
  });

  it('2.5 la personne l’emporte sur tout le reste', () => {
    // Un compte sans style ni musique qui utilise son clone doit quand même
    // sortir du régime historique.
    expect(methodeRendu(null, null, null, V1).startsWith(PREFIXE_METHODE_JUMEAU)).toBe(true);
  });

  it('2.6 la même personne rend la même valeur, toujours', () => {
    const a = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    for (let i = 0; i < 20; i += 1) {
      expect(methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, { ...V1 })).toBe(a);
    }
  });

  it('2.7 le reste de la recette compte toujours, avec un clone', () => {
    // La personne ne doit pas ÉCRASER les autres facteurs : deux musiques
    // différentes avec le même clone restent deux vidéos.
    const a = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    const b = methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, V1);
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La colonne a la place', () => {
  it('3.1 ⚠️ LE PRÉFIXE TIENT DANS LES 40 CARACTÈRES DE LA COLONNE', () => {
    /* Un préfixe plus bavard ferait échouer l'INSERTION, pas la validation —
       c'est-à-dire en production, au moment de téléverser un rendu déjà
       calculé et déjà payé. */
    const methode = methodeRendu(MUSIQUE, PROFIL_CREATIF_DEFAUT, null, V1);
    expect(methode.length).toBe(PREFIXE_METHODE_JUMEAU.length + LONGUEUR_EMPREINTE);
    expect(methode.length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
  });

  it('3.2 le préfixe est distinct des trois autres', () => {
    const prefixes = [PREFIXE_METHODE_MIX, PREFIXE_METHODE_PROFIL, PREFIXE_METHODE_JUMEAU];
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(PREFIXE_METHODE_JUMEAU.length).toBe(PREFIXE_METHODE_PROFIL.length);
  });
});
