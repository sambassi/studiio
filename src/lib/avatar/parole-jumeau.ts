import { texteParle } from '@/lib/voice/pipeline';
import { langueParleeValide, type LangueParlee } from '@/lib/voice/spoken-text';
import type { Prononciation } from '@/lib/voice/prononciations';
import type { VoixJumeau } from '@/lib/avatar/voix-jumeau';

/**
 * A_8g — CE QUE LE JUMEAU VA DIRE, ET AVEC QUELLE VOIX.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * UN SEUL PIPELINE PARLE, ET C'EST CELUI D'A_8d
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   texte affiche (DISPLAY_SCRIPT)
 *     -> `texteParle` : normalisation (%, CHF, heures, dates, nombres, fr-CH)
 *                       puis prononciations du compte
 *     -> texte parle (SPOKEN_SCRIPT)
 *     -> synthese A_6 avec la voix de la personne
 *     -> audio du jumeau
 *
 * ⚠️ AUCUNE DEUXIEME IMPLEMENTATION. Ce module n'a ni normaliseur ni table de
 * prononciation a lui : il APPELLE `texteParle`. Le jour ou une regle change,
 * elle change pour la voix-off, la route TTS et le jumeau en meme temps.
 *
 * ⚠️ LE TEXTE AFFICHE RESSORT INTACT. `displayScript` est ce que la personne a
 * ecrit ; il alimente les sous-titres et l'ecran. `spokenScript` est une VUE
 * fabriquee pour le moteur de synthese, et jetee ensuite — jamais persistee.
 *
 * ⚠️ LA VOIX EST DEJA RESOLUE QUAND ON ARRIVE ICI. Ce module ne lit pas la
 * base et ne verifie pas la propriete : c'est `voixJumeauUtilisable` qui l'a
 * fait. Il ne recoit qu'une `VoixJumeau`, c'est-a-dire une voix deja jugee
 * utilisable par ce compte.
 */

export interface ParoleJumeau {
  /** Ce qui est affiche : sous-titres, ecran, historique. Inchange. */
  displayScript: string;
  /** Ce qui est envoye au moteur de synthese. Une vue, jamais stockee. */
  spokenScript: string;
  langue: LangueParlee;
  voix: VoixJumeau;
}

export type IssueParoleJumeau =
  | { ok: true; parole: ParoleJumeau }
  /** Le jumeau n'a rien a dire : aucun texte ecrit par la personne. */
  | { ok: false; motif: 'script_absent' };

/**
 * Prepare la parole du jumeau. FONCTION PURE.
 *
 * `langue` : celle du profil si un jour il en porte une ; a defaut celle
 * declaree au clonage de la voix ; a defaut celle d'A_8d (`fr-FR`).
 */
export function preparerParoleJumeau(entree: {
  voix: VoixJumeau;
  displayScript: unknown;
  prononciations?: readonly Prononciation[];
  langue?: LangueParlee | string | null;
}): IssueParoleJumeau {
  const displayScript = typeof entree.displayScript === 'string' ? entree.displayScript.trim() : '';
  if (displayScript.length === 0) return { ok: false, motif: 'script_absent' };

  const langue = entree.langue ? langueParleeValide(entree.langue) : entree.voix.langue;
  const spokenScript = texteParle(displayScript, {
    langue, prononciations: entree.prononciations ?? [],
  });
  return { ok: true, parole: { displayScript, spokenScript, langue, voix: entree.voix } };
}
