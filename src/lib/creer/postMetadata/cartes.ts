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
 *      `position` d'une carte sur une autre.
 *   2. L'`id` EST PERSISTE. Chaque carte ecrite porte son `id` (`idsCartesLues`
 *      le relit, repli `card-lu-N` pour les posts qui n'en ont pas). Sans cela,
 *      la relecture renumerotait les cartes par POSITION alors que
 *      `cardGroups` gardait les identifiants de la session : apres une
 *      suppression, un groupe designait une AUTRE carte. Les lecteurs de
 *      `metadata.cards` (Calendrier, compositeur, rendu serveur, editeur
 *      avance) ignorent cette cle, ou la relisent (`c.id || …`).
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

/** Repli pour une carte relue SANS `id` enregistre (posts anterieurs). */
const ID_CARTE_LUE = (index: number) => `card-lu-${index}`;

/**
 * Les identifiants des cartes RELUES — LA source unique, partagee par
 * `to-wizard` (l'ecran) et `indexerCartesOrigine` (l'enregistrement). Deux
 * derivations divergentes recolleraient une carte sur une autre.
 *
 * - l'`id` enregistre fait foi (chaine non vide, pas deja pris) ;
 * - sinon `card-lu-N`, le repli historique — rendu unique s'il est deja pris.
 */
export function idsCartesLues(cartes: readonly unknown[]): string[] {
  const vus = new Set<string>();
  return cartes.map((carte, i) => {
    const enregistre = estObjet(carte) && typeof carte.id === 'string' && carte.id ? carte.id : null;
    let id = enregistre && !vus.has(enregistre) ? enregistre : ID_CARTE_LUE(i);
    let n = 1;
    while (vus.has(id)) { id = `${ID_CARTE_LUE(i)}-${n}`; n += 1; }
    vus.add(id);
    return id;
  });
}

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
  const ids = idsCartesLues(cartes);
  cartes.forEach((carte, i) => {
    if (estObjet(carte)) table.set(ids[i], carte);
  });
  return table;
}

/**
 * Table `id de l'ecran -> RANG d'origine`, batie a l'hydratation.
 *
 * Sert aux donnees rangees par POSITION dans la metadata — aujourd'hui
 * `design.cardCustomIcons` (`{'0': url}`), lu ainsi par le Calendrier.
 */
export function indexerRangsOrigine(metadata: unknown): ReadonlyMap<string, number> {
  const table = new Map<string, number>();
  if (!estObjet(metadata) || !Array.isArray(metadata.cards)) return table;
  idsCartesLues(metadata.cards).forEach((id, i) => table.set(id, i));
  return table;
}

/**
 * `design.cardCustomIcons`, REALIGNE sur les cartes de l'ecran — et SEULEMENT
 * si la structure des cartes a change.
 *
 * L'objet est range par POSITION (`{'0': url, '1': url}`), lu ainsi par le
 * Calendrier : supprimer ou inserer une carte decalait les icones sur la carte
 * voisine.
 *
 * Regles :
 * - STRUCTURE INCHANGEE (memes cartes, meme ordre qu'au chargement) →
 *   `undefined` : rien n'est envoye, la metadata reste EXACTEMENT celle de la
 *   base. Sans cette garde, l'empreinte de chargement (prise trop tot, defaut
 *   anterieur) faisait reecrire l'objet a chaque enregistrement.
 * - Une cle « attachee a une carte » est EXACTEMENT `String(i)` pour une carte
 *   d'origine `i` : sa valeur — quel que soit son type — suit SA carte ;
 *   celle d'une carte supprimee disparait ; une carte neuve n'en recoit aucune.
 * - Tout le reste (cle numerique orpheline, cle inconnue, `'01'`, valeur non
 *   textuelle hors carte) est conserve TEL QUEL.
 * - Seule exception, sans perte : une orpheline dont la position est desormais
 *   occupee par une carte (une carte neuve en herite sinon). Elle est gardee
 *   sous `orphelin-<cle>`, qu'aucun lecteur ne lit.
 *
 * `undefined` aussi s'il n'y avait pas d'icones : rien a envoyer, rien a creer.
 */
export function iconesPersoRealignees(
  icones: unknown,
  cartes: readonly { id: string }[],
  rangsOrigine: ReadonlyMap<string, number>,
): Record<string, unknown> | undefined {
  if (!estObjet(icones)) return undefined;

  const idsOrigine = [...rangsOrigine.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const structureInchangee = idsOrigine.length === cartes.length
    && cartes.every((c, j) => c.id === idsOrigine[j]);
  if (structureInchangee) return undefined;

  const clesDeCartes = new Set(idsOrigine.map((_, i) => String(i)));
  const out: Record<string, unknown> = {};
  // 1. Tout ce qui n'est attache a AUCUNE carte d'origine traverse tel quel.
  for (const [cle, valeur] of Object.entries(icones)) {
    if (!clesDeCartes.has(cle)) out[cle] = valeur;
  }
  // 2. Une position desormais occupee par une carte ne peut garder une
  //    orpheline : elle deviendrait l'icone de cette carte. On la met de cote.
  cartes.forEach((_, j) => {
    const cle = String(j);
    if (!(cle in out)) return;
    let abri = `orphelin-${cle}`;
    let n = 1;
    while (abri in out) { abri = `orphelin-${cle}-${n}`; n += 1; }
    out[abri] = out[cle];
    delete out[cle];
  });
  // 3. Les valeurs attachees aux cartes suivent LEUR carte.
  cartes.forEach((c, j) => {
    const rang = rangsOrigine.get(c.id);
    if (rang === undefined) return;
    const cle = String(rang);
    if (cle in icones) out[String(j)] = (icones as Record<string, unknown>)[cle];
  });
  return out;
}

/**
 * Les cartes (par identifiant) qui ont une IMAGE personnalisee d'origine dans
 * `design.cardCustomIcons` — le Calendrier l'affiche a la place de l'icone.
 * Retrouvees par leur rang d'origine : une carte deplacee garde son image
 * (`iconesPersoRealignees`), une carte neuve n'en a pas.
 */
export function cartesAvecImagePerso(
  cartes: readonly { id: string }[],
  icones: unknown,
  rangsOrigine: ReadonlyMap<string, number>,
): Set<string> {
  const out = new Set<string>();
  if (!estObjet(icones)) return out;
  for (const c of cartes) {
    const rang = rangsOrigine.get(c.id);
    if (rang === undefined) continue;
    const url = icones[String(rang)];
    if (typeof url === 'string' && url.length > 0) out.add(c.id);
  }
  return out;
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
      // L'identifiant PERSISTE : voir la regle 2 en tete de module.
      id: c.id,
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
    // Icone CHANGEE depuis l'ecran (choix lucide, PR 3) : l'editeur avance ne
    // dessine un SVG que si `iconType === 'svg'`, et afficherait sinon le nom
    // (« Rocket ») en texte — un `iconType: 'emoji'` d'origine survivait au
    // spread. Inchangee : la carte d'origine traverse telle quelle.
    const iconeChangee = c.icon !== origine.emoji;
    return {
      ...origine,
      ...reglesParLEcran,
      ...(suivaitAccent ? { color: accent } : null),
      ...(iconeChangee ? { iconType: 'svg' } : null),
    };
  });
}
