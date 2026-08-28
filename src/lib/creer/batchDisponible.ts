/**
 * Le mode SERIE de l'Assistant — reouvert, en PILOTE de deux videos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI IL AVAIT ETE FERME, ET POURQUOI IL PEUT ROUVRIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le lot n'a jamais cesse de fonctionner : il composait chaque montage et
 * creait chaque post. Ce qui n'etait pas sur, c'etait ce qu'il faisait AUX
 * CREDITS. Quatre points le rendaient indefendable, et aucun n'etait dans
 * l'Assistant :
 *
 *   - `deductCredits` etait un lire-modifier-ecrire sans verrou ;
 *   - `/api/credits/deduct` acceptait le COUT envoye par le client ;
 *   - aucune cle d'idempotence n'existait ;
 *   - rien ne prouvait au serveur qu'un fichier avait ete produit.
 *
 * Un lot, c'est N debits d'affilee : exactement le cas ou ces points cessent
 * d'etre theoriques.
 *
 * Les quatre sont fermes. Le debit passe par `debiter_credits`, atomique et
 * idempotent sur `(user_id, reference_id)` ; le cout vient de
 * `tarifs_rendu` ; le serveur va REGARDER l'objet a la cle qu'il a lui-meme
 * attribuee avant de debiter ; et les sept anciens chemins de composition
 * ont ete ramenes sur ce meme socle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX, ET PAS DIX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `BATCH_SERIE_MAX` vaut 2. Ce n'est pas une limite technique : le code du
 * lot sait faire dix. C'est une ouverture PILOTE — deux videos suffisent a
 * exercer tout ce qui distingue une serie d'un contenu unique (deux
 * tentatives independantes, deux confirmations, un echec partiel possible)
 * sans exposer un utilisateur a dix debits d'un coup au premier essai.
 *
 * Elever le pilote, c'est changer CE nombre, et rien d'autre.
 */

import { MAX_BATCH } from './batch';

/**
 * Annote `boolean` et NON `true`, deliberement : sans cette annotation,
 * TypeScript retrecit la constante au litteral et declare inatteignable tout
 * le code de la branche opposee — ce qui produit des erreurs sans rapport.
 * Meme raison que `BATCH_RENDER_DESACTIVE` dans `lib/render/batch-disabled`.
 */
export const BATCH_SERIE_DISPONIBLE: boolean = true;

/**
 * Le plafond du pilote. UN SEUL endroit.
 *
 * L'ecran, la normalisation d'un brouillon restaure et le refus au lancement
 * le lisent tous ici. Trois copies auraient fini par diverger, et c'est
 * precisement le genre de divergence qui se paie en credits.
 */
export const BATCH_SERIE_MAX = 2;

/** Pastille de la carte « Serie ». */
export const BATCH_SERIE_BADGE = 'Pilote';

/** Une ligne, sous la carte : ce que le pilote permet. */
export const BATCH_SERIE_EXPLICATION = `${BATCH_SERIE_MAX} brouillons, un par jour`;

/**
 * Message affiche si un lot hors plafond est declenche malgre tout.
 *
 * Il dit la vraie raison : ce n'est pas une panne, c'est une ouverture
 * progressive. Et il dit ce qui n'a PAS eu lieu — ni composition, ni debit.
 */
export const BATCH_SERIE_REFUS =
  `La série est ouverte en pilote, à ${BATCH_SERIE_MAX} vidéos au maximum. `
  + 'Rien n’a été composé et aucun crédit n’a été débité. Relancez avec '
  + `${BATCH_SERIE_MAX} vidéos, ou en « Un seul contenu ».`;

/**
 * Nombre de montages REELLEMENT autorise.
 *
 * Le point unique par lequel toute valeur doit passer — y compris celles qui
 * ne viennent d'aucun clic. Un brouillon enregistre avant le pilote porte
 * `batchCount: 10` dans le `localStorage` de l'utilisateur : il rouvrirait un
 * lot de dix au chargement, sans que personne n'ait touche un bouton. Griser
 * l'ecran ne suffit donc pas.
 *
 * Fail-closed dans les deux sens : drapeau baisse -> 1 ; valeur illisible,
 * negative ou infinie -> 1 ; valeur au-dessus du pilote -> le pilote.
 */
export function batchCountAutorise(valeur: number): number {
  if (!BATCH_SERIE_DISPONIBLE) return 1;
  if (!Number.isFinite(valeur)) return 1;
  return Math.min(BATCH_SERIE_MAX, Math.max(1, Math.floor(valeur)));
}

/**
 * Ce lancement doit-il etre refuse ?
 *
 * Interrogee au tout debut du gestionnaire de rendu, AVANT le moindre effet
 * de bord — avant la lecture du solde, avant la capture de l'apercu, avant la
 * composition, avant la creation du post, avant le debit.
 *
 * Elle REFUSE au lieu de normaliser, et c'est voulu : `batchCountAutorise`
 * ramene deja les valeurs a l'entree. Si une valeur hors plafond arrive
 * quand meme jusqu'ici, c'est qu'elle a contourne cette entree — la ramener
 * en silence a 2 lancerait un rendu que personne n'a demande sous cette
 * forme.
 */
export function lotRefuse(batchCount: number): boolean {
  if (!Number.isFinite(batchCount)) return false;
  const n = Math.floor(batchCount);
  if (!BATCH_SERIE_DISPONIBLE) return n > 1;
  return n > BATCH_SERIE_MAX;
}

/**
 * Les nombres proposes par l'ecran.
 *
 * Sous le pilote, cette liste ne contient que `[2]`. Elle est construite ici
 * plutot que dans le JSX pour que l'ecran ne puisse pas proposer autre chose
 * que ce que le lancement accepte.
 */
export function nombresProposes(): number[] {
  const haut = Math.min(BATCH_SERIE_MAX, MAX_BATCH);
  const out: number[] = [];
  for (let n = 2; n <= haut; n += 1) out.push(n);
  return out;
}
