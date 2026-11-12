/**
 * REPLI PAR CLÉ — la chaîne langue demandée → français → clé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE PASSAIT SANS CE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `useTranslations` rend le CHEMIN DE LA CLÉ quand la traduction manque
 * (`return path`). Un catalogue incomplet n'affichait donc pas la phrase
 * française : il affichait `billing.transactionHistory` à l'écran. Le repli
 * du provider ne jouait qu'à l'échec de CHARGEMENT du fichier — pas à la clé
 * manquante, qui est le cas courant dès qu'une langue est partielle.
 *
 * Conséquence directe : impossible d'ajouter une langue progressivement. Soit
 * elle était complète, soit elle montrait des identifiants techniques.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE FAIT LA FUSION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le français sert de SOCLE, la langue demandée se pose dessus, clé par clé
 * et en profondeur. Une clé absente ou vide retombe sur le français ; une clé
 * traduite gagne. Une langue à trois phrases devient utilisable, et chaque
 * phrase ajoutée apparaît sans rien casser.
 *
 * Fonction PURE.
 */
type Catalogue = Record<string, unknown>;

function estObjet(v: unknown): v is Catalogue {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Fusionne `langue` sur `socle`. Une valeur de `langue` ne remplace celle du
 * socle que si elle est RÉELLEMENT renseignée : une chaîne vide ou faite
 * d'espaces est une traduction manquante, pas une traduction vide.
 */
export function fusionnerMessages(socle: Catalogue, langue: Catalogue | null | undefined): Catalogue {
  if (!estObjet(langue)) return { ...socle };
  const out: Catalogue = { ...socle };
  for (const [cle, valeur] of Object.entries(langue)) {
    if (estObjet(valeur)) {
      out[cle] = fusionnerMessages(estObjet(socle[cle]) ? socle[cle] : {}, valeur);
    } else if (typeof valeur === 'string') {
      if (valeur.trim() !== '') out[cle] = valeur;
    } else if (valeur !== null && valeur !== undefined) {
      out[cle] = valeur;
    }
  }
  return out;
}

/** Les chemins de clés d'un catalogue, à plat — pour mesurer une couverture. */
export function cheminsDeCles(c: Catalogue, prefixe = ''): string[] {
  const out: string[] = [];
  for (const [cle, valeur] of Object.entries(c)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (estObjet(valeur)) out.push(...cheminsDeCles(valeur, chemin));
    else out.push(chemin);
  }
  return out.sort();
}

/**
 * Part des clés du socle réellement traduites dans `langue`, entre 0 et 1.
 * Sert à afficher honnêtement l'état d'une langue partielle.
 */
export function couverture(socle: Catalogue, langue: Catalogue | null | undefined): number {
  const cles = cheminsDeCles(socle);
  if (cles.length === 0) return 1;
  if (!estObjet(langue)) return 0;
  const traduites = cheminsDeCles(langue).filter((c) => cles.includes(c));
  return Math.round((traduites.length / cles.length) * 1000) / 1000;
}
