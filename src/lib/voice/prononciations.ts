/**
 * A_8d — LES PRONONCIATIONS CHOISIES PAR LA PERSONNE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE LE NORMALISEUR NE PEUT PAS SAVOIR
 * ═════════════════════════════════════════════════════════════════════════
 *
 * « 25 % » se dit « vingt-cinq pour cent » : c'est une regle, elle vaut pour
 * tout le monde. « Afroboost » se dit... comme son proprietaire le decide.
 * Aucune regle ne peut le deviner, et un modele de langage ne ferait que
 * proposer une opinion differente a chaque appel.
 *
 * D'ou une table, tenue par la personne elle-meme.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ APPLIQUEES APRES LA NORMALISATION, ET C'EST DELIBERE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Avant, un alias contenant un chiffre ou un symbole serait repasse dans les
 * regles : quelqu'un qui ecrit « Studiio 2 » -> « Studio deux » verrait son
 * « deux » relu, et « CHF » dans un alias deviendrait « francs suisses ». La
 * table dit le mot FINAL ; plus rien ne doit le retoucher ensuite.
 *
 * ⚠️ ET LE REMPLACEMENT EST LITTERAL, JAMAIS UNE EXPRESSION REGULIERE. Une
 * regex fournie par un utilisateur peut se rendre exponentielle sur une
 * entree bien choisie (ReDoS) et bloquer le serveur. Ce qui est saisi est
 * cherche tel quel, echappe, et rien d'autre.
 */

export interface Prononciation {
  /** Le mot tel qu'il est ECRIT. Jamais modifie a l'affichage. */
  display: string;
  /** Le mot tel qu'il doit etre DIT. */
  spoken: string;
}

/**
 * Combien de regles un compte peut poser.
 *
 * Cent noms propres couvrent une marque, ses produits et son entourage. Au-dela,
 * ce n'est plus un dictionnaire de prononciation : c'est une reecriture du
 * texte, et elle n'a pas sa place ici.
 */
export const PRONONCIATIONS_MAX = 100;
export const PRONONCIATION_LONGUEUR_MAX = 80;

/** Une regle relue — TOUT OU RIEN, comme partout ailleurs dans le depot. */
export function prononciationValide(brut: unknown): Prononciation | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  const display = typeof o.display === 'string' ? o.display.trim() : '';
  const spoken = typeof o.spoken === 'string' ? o.spoken.trim() : '';
  if (display.length === 0 || spoken.length === 0) return null;
  if (display.length > PRONONCIATION_LONGUEUR_MAX) return null;
  if (spoken.length > PRONONCIATION_LONGUEUR_MAX) return null;
  /* Un saut de ligne dans une regle casserait la lecture sans qu'on voie
     pourquoi ; il n'a aucun usage ici. */
  if (/[\r\n]/.test(display) || /[\r\n]/.test(spoken)) return null;
  return { display, spoken };
}

/** La table relue. Bornee, dedoublonnee, ordre d'ecriture preserve. */
export function prononciationsValides(brut: unknown): readonly Prononciation[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const sorties: Prononciation[] = [];
  for (const e of brut) {
    const p = prononciationValide(e);
    if (!p) continue;
    const cle = p.display.toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    sorties.push(p);
    if (sorties.length >= PRONONCIATIONS_MAX) break;
  }
  return sorties;
}

function echapper(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applique la table a un texte DEJA normalise.
 *
 * ⚠️ LES REGLES LES PLUS LONGUES D'ABORD. Sans cela, une regle « Studiio »
 * mangerait le debut de « Studiio Pro » et la seconde regle ne trouverait plus
 * rien — l'ordre de saisie deciderait du resultat, ce qui est exactement ce
 * qu'on ne veut pas.
 *
 * La recherche ignore la casse mais le remplacement, lui, est exactement ce
 * que la personne a ecrit : c'est elle qui sait si sa marque se dit avec une
 * emphase.
 */
export function appliquerPrononciations(
  texte: string, regles: readonly Prononciation[],
): string {
  if (typeof texte !== 'string' || texte.length === 0 || regles.length === 0) return texte ?? '';
  const ordonnees = [...regles].sort((a, b) => b.display.length - a.display.length);
  let sortie = texte;
  for (const r of ordonnees) {
    sortie = sortie.replace(new RegExp(echapper(r.display), 'gi'), r.spoken);
  }
  return sortie;
}
