/**
 * A_8g — LA VOIX FAIT PARTIE DE L'IDENTITÉ DU RENDU.
 *
 * Une vidéo produite avec l'avatar X (version N) et la voix A n'est pas la
 * vidéo produite avec le même avatar et la voix B : sans ce champ dans
 * l'empreinte, changer de voix rendrait L'ANCIEN FICHIER, avec l'ancienne
 * voix, sans erreur et sans message. La référence est celle de Studiio
 * (`user_voices.id`), jamais l'identifiant du fournisseur.
 *
 * ⚠️ ET LE PASSÉ RESTE INTACT : sans jumeau, l'empreinte d'hier est celle
 * d'aujourd'hui, au caractère près.
 */
import { describe, it, expect } from 'vitest';
import {
  methodeRendu, empreinteRenduComplet, PREFIXE_METHODE_JUMEAU, LONGUEUR_METHODE_RENDU_MAX,
  METHODE_RENDU,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { PROFIL_CREATIF_DEFAUT } from '@/lib/autopilot/analyse/profil-creatif';
import type { IdentiteJumeau } from '@/lib/avatar/jumeau';

const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX_A = 'eeeeeeee-5555-4555-8555-555555555555';
const VOIX_B = 'ffffffff-6666-4666-8666-666666666666';
const jumeau = (userVoiceId: string, avatarVersion = 1): IdentiteJumeau => ({ avatarId: AVATAR, avatarVersion, userVoiceId });

describe('A_8g — la voix dans l’empreinte', () => {
  it('⚠️ MÊME AVATAR, MÊME VERSION, MÊME TOUT — VOIX A ≠ VOIX B', () => {
    const a = methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_A));
    const b = methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_B));
    expect(a).not.toBe(b);
    expect(a.startsWith(PREFIXE_METHODE_JUMEAU)).toBe(true);
    expect(b.startsWith(PREFIXE_METHODE_JUMEAU)).toBe(true);
    expect(a.length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
  });

  it('même voix, même version : même empreinte (le cache reste utile)', () => {
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_A)))
      .toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_A)));
  });

  it('la version du clone distingue aussi', () => {
    expect(empreinteRenduComplet(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_A, 1)))
      .not.toBe(empreinteRenduComplet(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, jumeau(VOIX_A, 2)));
  });

  it('⚠️ SANS JUMEAU, RIEN NE CHANGE — les rendus d’hier restent trouvables', () => {
    expect(methodeRendu(null, null, null)).toBe(METHODE_RENDU);
    const hier = empreinteRenduComplet(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null);
    expect(empreinteRenduComplet(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT, null, null)).toBe(hier);
  });

  it('la référence hachée est celle de Studiio, pas celle du fournisseur', () => {
    /* Deux voix Studiio distinctes qui partageraient par accident un même
       identifiant fournisseur restent deux identités : seule `userVoiceId`
       entre dans l'empreinte, et `IdentiteJumeau` n'a pas d'autre champ voix. */
    const champs = Object.keys(jumeau(VOIX_A)).sort();
    expect(champs).toEqual(['avatarId', 'avatarVersion', 'userVoiceId']);
  });
});
