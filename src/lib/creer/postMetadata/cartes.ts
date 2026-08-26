/**
 * Les cartes du parcours guide, ECRITES SANS PERTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLEME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `creer-avance` persiste SEPT champs par carte (`creer-avance/page.tsx:5202`) :
 *
 *   emoji · label · value · description · color · position · textOnly
 *
 * L'Assistant n'en porte que CINQ a l'ecran (`GeneratedCard`) : il ne sait ni
 * afficher ni regler `position` et `textOnly`, et sa palette est globale.
 * Reconstruire la carte a partir de ce que l'ecran porte revenait donc a
 * SUPPRIMER ce qu'il ignore — et comme le tableau `cards` part en bloc et que
 * la fusion serveur remplace une cle de premier niveau entiere, une seule
 * carte modifiee effacait `position` et `textOnly` de TOUTES.
 *
 * Pire : `color` etant repeint avec l'accent global, un simple changement de
 * couleur d'accent — sans toucher a aucune carte — suffisait a declencher la
 * perte. Colonne `jsonb` sans historique : definitif et silencieux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ON PART DE LA CARTE D'ORIGINE, ET ON N'APPLIQUE QUE CE QUE L'ECRAN REGLE.
 *
 * Tout le reste — les champs connus qu'il ignore, comme les cles qu'aucun
 * code ne declare — traverse par construction, sans avoir a l'enumerer.
 *
 * Trois consequences voulues :
 *
 *   1. APPARIEMENT PAR `id`, JAMAIS PAR INDEX. Une suppression, un ajout ou un
 *      reordonnancement decalent les index : apparier par rang recollerait la
 *      `position` d'une carte sur une autre. Les identifiants relus sont
 *      deterministes (`to-wizard.ts`, `card-lu-N`) et survivent a
 *      l'hydratation, ce qui rend l'identite fiable.
 *   2. UNE CARTE NEUVE GARDE LE COMPORTEMENT ACTUEL, mot pour mot. La creation
 *      est le parcours majoritaire : elle ne doit rien voir changer.
 *   3. L'ACCENT NE REPEINT QUE CE QUI LE SUIVAIT DEJA. Un post de l'Assistant
 *      a ses cartes a la couleur d'accent et doit continuer de suivre le
 *      selecteur ; un post de l'editeur avance a des couleurs PROPRES, que
 *      l'accent n'a jamais eu vocation a ecraser.
 *
 * Ce module ne fait aucun appel reseau, ne declenche aucun rendu, et ne modifie
 * ni la metadata recue ni les cartes de l'ecran.
 */

/** Une carte telle que le parcours guide la porte a l'ecran. */
export interface CarteEcran {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly value: string;
  readonly description: string;
}

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * L'identifiant que `to-wizard` donne a la carte de rang `index`.
 *
 * Duplique volontairement la convention plutot que de l'importer : `to-wizard`
 * importe le resolveur et le brouillon, et le faire dependre d'ici creerait un
 * couplage inutile entre lecture et ecriture. La constante est figee par le
 * test `« l'index d'origine est retrouve »`.
 */
const ID_CARTE_LUE = (index: number) => `card-lu-${index}`;

/**
 * Table `id de l'ecran -> carte D'ORIGINE`, batie a l'hydratation.
 *
 * C'est le seul moment ou l'index est encore fiable : ensuite l'utilisateur
 * peut ajouter, retirer ou deplacer des cartes.
 */
export function indexerCartesOrigine(metadata: unknown): ReadonlyMap<string, Record<string, unknown>> {
  const table = new Map<string, Record<string, unknown>>();
  if (!estObjet(metadata)) return table;
  const cartes = metadata.cards;
  if (!Array.isArray(cartes)) return table;
  cartes.forEach((carte, i) => {
    if (estObjet(carte)) table.set(ID_CARTE_LUE(i), carte);
  });
  return table;
}

/**
 * Les cartes a envoyer au serveur.
 *
 * @param cartes        ce que l'ecran porte maintenant
 * @param origines      la table produite par `indexerCartesOrigine`
 * @param accent        la couleur d'accent courante
 * @param accentCharge  celle qui etait en place AU CHARGEMENT — c'est elle qui
 *                      dit si une carte « suivait l'accent » ou avait une
 *                      couleur choisie a la main
 */
export function cartesPourEnregistrement(
  cartes: readonly CarteEcran[],
  origines: ReadonlyMap<string, Record<string, unknown>>,
  accent: string,
  accentCharge: string | undefined,
): Record<string, unknown>[] {
  return cartes.map((c) => {
    const reglesParLEcran = {
      emoji: c.icon,
      label: c.title,
      value: c.value,
      description: c.description,
    };

    const origine = origines.get(c.id);
    if (!origine) {
      // Carte NEUVE — regeneree, dupliquee ou creee. Comportement historique.
      return { ...reglesParLEcran, color: accent };
    }

    // Carte RELUE : l'original fait foi pour tout ce que l'ecran ne regle pas.
    const suivaitAccent = origine.color === undefined || origine.color === accentCharge;
    return {
      ...origine,
      ...reglesParLEcran,
      ...(suivaitAccent ? { color: accent } : null),
    };
  });
}
