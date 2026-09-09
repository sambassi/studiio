/**
 * A_8f — QUI A LE DROIT DE PARLER AVEC LE VISAGE DE QUELQU'UN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTEGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Laisser un moteur automatique produire, sans que personne ne regarde, des
 * videos ou c'est LE VISAGE ET LA VOIX d'une personne qui parlent est le geste
 * le plus lourd du produit. Trois regles le tiennent, et chacune a son bloc :
 *
 *   1. ETEINT PAR DEFAUT — aucun compte ne se reveille active ;
 *   2. AUCUN REPLI SILENCIEUX — un clone demande et indisponible produit un
 *      motif nomme, jamais une video ordinaire que la personne croira sienne ;
 *   3. AUCUN HASARD SUR L'IDENTITE — le mode creatif variable fait tourner les
 *      LUT et la musique, jamais l'avatar ni la voix.
 */
import { describe, it, expect } from 'vitest';
import {
  lireConfigJumeau, jumeauHistorique, resoudreJumeauPourGeneration,
  JUMEAU_DESACTIVE, MOTIFS_JUMEAU, MESSAGES_JUMEAU,
} from '@/lib/avatar/jumeau';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import { SUJET_AVATAR } from '@/lib/avatar/contrat';
import { CARD_STYLE_NAMES } from '@/lib/creer/cardStyles';

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX = 'dddddddd-4444-4444-8444-444444444444';

const AVATAR_COMPLET = {
  id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_1',
  validated_at: '2026-09-09T12:00:00Z', deleted_at: null,
  subject_type: SUJET_AVATAR, version: 1,
};
const VOIX_COMPLETE = {
  id: VOIX, user_id: UID, provider_voice_id: 'el_1', consent_at: '2026-09-01T10:00:00Z',
};
const CONFIG_COMPLETE = {
  active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX,
};

const resoudre = (o: Partial<Parameters<typeof resoudreJumeauPourGeneration>[0]> = {}) =>
  resoudreJumeauPourGeneration({
    config: CONFIG_COMPLETE, userId: UID,
    avatar: AVATAR_COMPLET, voix: VOIX_COMPLETE, ...o,
  });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Éteint par défaut, pour tout le monde', () => {
  it('1.1 ⚠️ UN COMPTE HISTORIQUE N’A RIEN D’ACTIVÉ', () => {
    /* Aucune activation rétroactive : un compte qui n'a jamais vu cet écran
       ne doit pas découvrir que son clone parle déjà à sa place. */
    expect(lireConfigJumeau(undefined)).toEqual(JUMEAU_DESACTIVE);
    expect(lireConfigJumeau(null)).toEqual(JUMEAU_DESACTIVE);
    expect(lireConfigJumeau({})).toEqual(JUMEAU_DESACTIVE);
    expect(jumeauHistorique(lireConfigJumeau({}))).toBe(true);
  });

  it('1.2 ⚠️ UN `active: true` SANS AVATAR NE S’ACTIVE PAS', () => {
    // Activer un clone que personne ne peut designer n'a aucun sens.
    expect(lireConfigJumeau({ active: true }).active).toBe(false);
    expect(lireConfigJumeau({ active: true, avatarId: 'pas-un-uuid' }).active).toBe(false);
  });

  it('1.3 une valeur illisible ne laisse pas une configuration à moitié', () => {
    const c = lireConfigJumeau({
      active: true, avatarId: AVATAR, avatarVersion: 'deux', userVoiceId: 42,
    });
    expect(c.avatarVersion).toBeNull();
    expect(c.userVoiceId).toBeNull();
  });

  it('1.4 ⚠️ LE STYLE D’UN COMPTE HISTORIQUE NE GAGNE PAS DE CLÉ', () => {
    /* Ecrire un objet là où il n'y en avait pas ferait changer l'empreinte du
       rendu de tous les comptes existants — et tout serait recalculé. */
    expect(sanitizeDesignStyle({}).jumeauNumerique).toBeUndefined();
    expect(sanitizeDesignStyle({ jumeauNumerique: {} }).jumeauNumerique).toBeUndefined();
  });

  it('1.5 le style conserve une configuration réelle', () => {
    const style = sanitizeDesignStyle({ jumeauNumerique: CONFIG_COMPLETE });
    expect(style.jumeauNumerique).toEqual(CONFIG_COMPLETE);
  });

  it('1.6 ⚠️ ET IL NE PERD PAS LES RÉGLAGES VOISINS', () => {
    /* La dette payée pour `montage`, `audio` puis les favoris : `compacter`
       ne garde que ce qui est nommé dans le sanitizer. Un voisin oublié
       disparaît SILENCIEUSEMENT au prochain enregistrement. */
    const style = sanitizeDesignStyle({
      jumeauNumerique: CONFIG_COMPLETE,
      montage: { format: '9:16', dureeSecondes: 30 },
      cardStyle: CARD_STYLE_NAMES[0],
    });
    expect(style.jumeauNumerique).toEqual(CONFIG_COMPLETE);
    expect(style.montage).toBeDefined();
    expect(style.cardStyle).toBe(CARD_STYLE_NAMES[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le portail — ce qui est vrai au moment de générer', () => {
  it('2.1 configuration complète et vraie : prêt', () => {
    expect(resoudre()).toEqual({
      etat: 'pret',
      identite: { avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX },
    });
  });

  it('2.2 éteint reste éteint, sans rien lire', () => {
    expect(resoudre({ config: JUMEAU_DESACTIVE })).toEqual({ etat: 'desactive' });
  });

  it('2.3 ⚠️ UNE SOURCE PRÊTE N’EST PAS UN CLONE', () => {
    const issue = resoudre({
      avatar: { ...AVATAR_COMPLET, provider_avatar_id: null, status: 'source_ready' },
    });
    expect(issue).toEqual({ etat: 'bloque', motif: 'avatar_non_entraine' });
  });

  it('2.4 ⚠️ UN CLONE NON VALIDÉ NE PARLE PAS', () => {
    /* La validation humaine est une condition d'USAGE, pas une formalité
       d'inscription : personne ne fait parler ce qu'il n'a pas accepté. */
    expect(resoudre({ avatar: { ...AVATAR_COMPLET, validated_at: null } }))
      .toEqual({ etat: 'bloque', motif: 'clone_non_valide' });
  });

  it('2.5 ⚠️ L’AVATAR D’AUTRUI EST REFUSÉ, MÊME S’IL EST PARFAIT', () => {
    /* La propriété est vérifiée sur la LIGNE relue, pas sur la configuration :
       un `avatarId` rangé en base ne prouve rien. */
    expect(resoudre({ avatar: { ...AVATAR_COMPLET, user_id: AUTRUI } }))
      .toEqual({ etat: 'bloque', motif: 'avatar_etranger' });
  });

  it('2.6 ⚠️ LA VOIX D’AUTRUI EST REFUSÉE', () => {
    expect(resoudre({ voix: { ...VOIX_COMPLETE, user_id: AUTRUI } }))
      .toEqual({ etat: 'bloque', motif: 'voix_etrangere' });
  });

  it('2.7 ⚠️ SANS VOIX RÉELLE, RIEN NE PART', () => {
    /* La pire sortie possible : le visage de la personne, parlant avec une
       voix qui n'est pas la sienne. */
    expect(resoudre({ config: { ...CONFIG_COMPLETE, userVoiceId: null } }))
      .toEqual({ etat: 'bloque', motif: 'voix_absente' });
    expect(resoudre({ voix: null }))
      .toEqual({ etat: 'bloque', motif: 'voix_absente' });
    expect(resoudre({ voix: { ...VOIX_COMPLETE, provider_voice_id: '' } }))
      .toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('2.8 ⚠️ UNE VOIX SANS CONSENTEMENT DATÉ NE SERT PAS', () => {
    // La preuve est relue à l'USAGE, pas seulement à la création.
    expect(resoudre({ voix: { ...VOIX_COMPLETE, consent_at: null } }))
      .toEqual({ etat: 'bloque', motif: 'voix_absente' });
  });

  it('2.9 ⚠️ UNE PRÉPARATION SUPPRIMÉE N’EST JAMAIS UTILISABLE', () => {
    expect(resoudre({ avatar: { ...AVATAR_COMPLET, deleted_at: '2026-09-09T13:00:00Z' } }))
      .toEqual({ etat: 'bloque', motif: 'avatar_supprime' });
  });

  it('2.10 ⚠️ UN CLONE QUI NE REPRÉSENTE PAS SON PROPRIÉTAIRE EST REFUSÉ', () => {
    // A_8 est SELF ONLY, et la règle est vérifiée à l'usage.
    expect(resoudre({ avatar: { ...AVATAR_COMPLET, subject_type: 'tiers' } }))
      .toEqual({ etat: 'bloque', motif: 'sujet_non_self' });
  });

  it('2.11 une version inconnue bloque plutôt que d’être devinée', () => {
    expect(resoudre({ avatar: { ...AVATAR_COMPLET, version: null } }))
      .toEqual({ etat: 'bloque', motif: 'version_absente' });
  });

  it('2.12 ⚠️ LA VERSION VIENT DE LA LIGNE, PAS DE LA CONFIGURATION', () => {
    /* Le navigateur ne décide pas de quelle version de la personne il s'agit :
       une configuration périmée ne doit pas figer une identité obsolète. */
    const issue = resoudre({
      config: { ...CONFIG_COMPLETE, avatarVersion: 1 },
      avatar: { ...AVATAR_COMPLET, version: 2 },
    });
    expect(issue).toEqual({
      etat: 'pret',
      identite: { avatarId: AVATAR, avatarVersion: 2, userVoiceId: VOIX },
    });
  });

  it('2.13 aucun avatar relu : bloqué, pas laissé passer', () => {
    // Une base injoignable rend `null` — l'absence n'autorise rien.
    expect(resoudre({ avatar: null }))
      .toEqual({ etat: 'bloque', motif: 'avatar_absent' });
  });

  it('2.14 chaque motif porte une phrase, sans exception', () => {
    for (const m of MOTIFS_JUMEAU) {
      expect(MESSAGES_JUMEAU[m], m).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Aucun hasard sur l’identité', () => {
  it('3.1 ⚠️ CENT RÉSOLUTIONS RENDENT LA MÊME PERSONNE', () => {
    /* Le mode créatif variable fait tourner les LUT, les transitions et la
       musique. Il ne doit JAMAIS faire tourner un visage ou une voix. Ce
       module n'a pas de graine, et ce test le prouve sur la durée. */
    const premier = JSON.stringify(resoudre());
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(resoudre())).toBe(premier);
    }
  });

  it('3.2 la fonction est pure : elle ne modifie pas ce qu’on lui donne', () => {
    const config = { ...CONFIG_COMPLETE };
    const avatar = { ...AVATAR_COMPLET };
    resoudreJumeauPourGeneration({ config, userId: UID, avatar, voix: VOIX_COMPLETE });
    expect(config).toEqual(CONFIG_COMPLETE);
    expect(avatar).toEqual(AVATAR_COMPLET);
  });
});
