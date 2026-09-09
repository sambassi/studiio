/**
 * A_8d — DU TEXTE ECRIT AU TEXTE PARLE, EN UN SEUL ENDROIT.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE SEULE PORTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Deux chemins mènent aujourd'hui a ElevenLabs — la voix-off de l'Autopilote
 * et la route TTS generale — et un troisieme viendra avec le clone video. Si
 * chacun preparait son texte a sa facon, la meme phrase se prononcerait
 * differemment selon l'ecran qui l'a demandee. Ils passent donc tous par ici.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * L'ORDRE, ET POURQUOI IL EST DANS CE SENS
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   texte affiche
 *     -> normalisation structurelle   (%, CHF, heures, dates, nombres)
 *     -> prononciations du compte     (noms propres, marques)
 *     -> texte parle
 *
 * ⚠️ LES REGLES DU COMPTE EN DERNIER. Devant, un alias contenant un chiffre ou
 * un symbole serait repasse dans les regles structurelles : « Studiio 2 » ->
 * « Studio deux » verrait son « deux » relu, et « CHF » dans un alias
 * deviendrait « francs suisses ». La table dit le mot FINAL.
 *
 * ⚠️ ET RIEN N'EST PERSISTE. Le texte parle est une vue, fabriquee au moment
 * de parler et jetee ensuite. Le ranger en base finirait par le faire
 * reafficher — et quelqu'un lirait « vingt-cinq pour cent » dans ses
 * sous-titres.
 */
import {
  normaliserTexteParle, langueParleeValide,
  type LangueParlee,
} from './spoken-text';
import { appliquerPrononciations, type Prononciation } from './prononciations';

export interface OptionsTexteParle {
  langue?: LangueParlee | string;
  prononciations?: readonly Prononciation[];
}

/**
 * Le texte a envoyer au moteur de synthese.
 *
 * FONCTION PURE. Le texte d'affichage entre et ressort intact : c'est la
 * VALEUR DE RETOUR qui est parlee, jamais l'entree.
 */
export function texteParle(displayScript: unknown, options: OptionsTexteParle = {}): string {
  const langue = langueParleeValide(options.langue);
  const normalise = normaliserTexteParle(displayScript, langue);
  return appliquerPrononciations(normalise, options.prononciations ?? []);
}
