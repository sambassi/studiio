/**
 * L'ÉTAPE `signaux` — LE MOTEUR DE L'ENRICHISSEMENT SÉMANTIQUE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAIT, ET CE QU'IL LUI EST STRUCTURELLEMENT IMPOSSIBLE DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il reçoit des candidats DÉJÀ CHOISIS et DÉJÀ VALIDÉS par M3-C, retrouve
 * l'image de chacun, et rend les MÊMES candidats avec leur relevé attaché.
 *
 * Il ne peut pas en ajouter un : il rend un tableau de même longueur, dans le
 * même ordre. Il ne peut pas en déplacer un : il ne touche à aucune borne. Il
 * ne peut pas en renoter un : le contrat de sortie du fournisseur n'a ni
 * `scoreMontage`, ni `raison`, ni `secondeReference`, ni durée. Et un test le
 * vérifie champ par champ, plutôt que de faire confiance à cette phrase.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ NON FATAL, ET C'EST LA PROPRIÉTÉ LA PLUS IMPORTANTE DU FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * TOUT chemin rend les candidats. Fournisseur éteint, clé absente, réponse
 * hors contrat, délai dépassé, image introuvable : les candidats sortent
 * intacts, avec `signaux: null`.
 *
 * Perdre un montage parce qu'un relevé décoratif n'a pas abouti serait
 * échanger la fonction contre l'ornement. L'utilisateur a filmé, payé une
 * analyse et une sélection ; il n'a pas à repartir de zéro parce qu'un
 * second appel a échoué.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'IMAGE EST CELLE DU CANDIDAT, À LA SECONDE PRÈS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `secondeReference` est enfermé, chez M3-C, dans les instants des images
 * RÉELLEMENT envoyées, et `normaliserReference` rend NOTRE valeur, pas celle
 * du modèle. L'appariement se fait donc par égalité EXACTE, jamais par
 * proximité : un décalage de zéro seconde, ou pas de relevé du tout.
 *
 * ⚠️ AUCUN « PLUS PROCHE ». Relever la vignette de 30 s pour un candidat de
 * 34 s produirait un signal faux que rien ne distinguerait d'un vrai — le
 * défaut exact que ce lot existe pour éviter.
 */
import type { CandidatMontage } from './candidat-contrat';
import {
  lireReponseSignaux, usageSignaux, SIGNAUX_MAX,
  type MotifSignauxEtape,
} from './candidat-signaux-contrat';
import {
  fournisseurSignauxAnthropic, signauxAnthropicActif,
  type FournisseurSignaux, type MomentAEnrichir,
} from './candidat-signaux-anthropic';

/** Pourquoi l'enrichissement n'a rien attaché. `null` = il a abouti. */
export type MotifEnrichissement =
  | MotifSignauxEtape
  | 'fournisseur_absent'
  | 'fournisseur_en_erreur'
  | 'aucune_image_appariee'
  | 'trop_de_candidats'
  /**
   * ⚠️ CELUI-CI N'EST PAS UN ECHEC. Il dit que l'appel n'a PAS EU LIEU, parce
   * que l'objectif du compte ne pouvait de toute facon rien changer au
   * montage. Le confondre avec `fournisseur_absent` ferait chercher une
   * configuration manquante la ou il n'y a qu'une economie deliberee.
   */
  | 'objectif_sans_effet_attendu';

export interface DemandeEnrichissement {
  /** Les candidats FIGÉS de M3-C, dans leur ordre. Jamais mutés. */
  candidats: readonly CandidatMontage[];
  /** Les images telles qu'elles ont été envoyées à M3-C, avec leur instant. */
  images: ReadonlyArray<{ seconde: number; mimeType: 'image/jpeg'; data: Buffer }>;
}

export interface ResultatEnrichissement {
  /** TOUJOURS rendus, enrichis ou non. Même longueur, même ordre. */
  candidats: CandidatMontage[];
  applique: boolean;
  motif: MotifEnrichissement | null;
  detail: string | null;
  modele: string | null;
  usage: ReturnType<typeof usageSignaux> | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Le fournisseur — posé à la main pour les tests, sinon construit à la demande
// ───────────────────────────────────────────────────────────────────────────

let fournisseurInjecte: FournisseurSignaux | null = null;

export function definirFournisseurSignaux(f: FournisseurSignaux | null): void {
  fournisseurInjecte = f;
}

/**
 * Le fournisseur du moment, ou `null`.
 *
 * ⚠️ AUCUN `catch` AUTOUR DE LA CONSTRUCTION. `fournisseurSignauxAnthropic`
 * lève quand le drapeau est posé mais que la clé ou le modèle manque ; avaler
 * cette erreur la transformerait en « aucun fournisseur configuré », soit
 * l'inverse de ce qu'elle dit. C'est `enrichirCandidats` qui l'attrape, et
 * qui la traduit en `fournisseur_en_erreur` — sans jamais perdre un candidat.
 */
function fournisseurCourant(): FournisseurSignaux | null {
  if (fournisseurInjecte) return fournisseurInjecte;
  if (!signauxAnthropicActif()) return null;
  return fournisseurSignauxAnthropic();
}

/** Masque ce qui ne doit jamais sortir d'un message d'erreur. */
function messageSur(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  return brut.replace(/https?:\/\/\S+/g, '[url]').slice(0, 120);
}

/** Les candidats rendus tels quels, sans relevé. Le repli de tout échec. */
function sansEnrichissement(
  candidats: readonly CandidatMontage[],
  motif: MotifEnrichissement,
  detail: string | null = null,
): ResultatEnrichissement {
  return {
    candidats: candidats.map((c) => ({ ...c, signaux: null })),
    applique: false,
    motif,
    detail,
    modele: null,
    usage: null,
  };
}

/**
 * Attache un relevé sémantique à des candidats déjà figés.
 *
 * ⚠️ NE LÈVE JAMAIS. Voir l'en-tête : tout chemin rend des candidats.
 */
export async function enrichirCandidats(
  demande: DemandeEnrichissement,
): Promise<ResultatEnrichissement> {
  const { candidats, images } = demande;

  const fournisseur = fournisseurCourant();
  if (!fournisseur) return sansEnrichissement(candidats, 'fournisseur_absent');

  if (candidats.length === 0) {
    return sansEnrichissement(candidats, 'aucune_image_appariee', 'aucun candidat');
  }
  if (candidats.length > SIGNAUX_MAX) {
    // M3-C borne déjà à six ; si davantage arrive, c'est que quelque chose a
    // changé en amont, et on ne devine pas lesquels enrichir.
    return sansEnrichissement(
      candidats, 'trop_de_candidats', `${candidats.length} > ${SIGNAUX_MAX}`,
    );
  }

  // ── L'appariement image ↔ candidat, par égalité EXACTE ─────────────────
  const parSeconde = new Map<number, { mimeType: 'image/jpeg'; data: Buffer }>();
  for (const img of images) parSeconde.set(img.seconde, img);

  const moments: MomentAEnrichir[] = [];
  /** `positions[i]` = l'index, dans `candidats`, du moment `i`. */
  const positions: number[] = [];
  for (const [i, c] of candidats.entries()) {
    const img = parSeconde.get(c.secondeReference);
    if (!img) continue;
    positions.push(i);
    moments.push({
      indice: moments.length,
      seconde: c.secondeReference,
      mimeType: img.mimeType,
      data: img.data,
    });
  }
  if (moments.length === 0) {
    return sansEnrichissement(candidats, 'aucune_image_appariee');
  }

  // ── L'appel ─────────────────────────────────────────────────────────────
  let sortie;
  try {
    sortie = await fournisseur({ moments });
  } catch (e: unknown) {
    return sansEnrichissement(candidats, 'fournisseur_en_erreur', messageSur(e));
  }

  // ── La lecture stricte ──────────────────────────────────────────────────
  const lu = lireReponseSignaux(sortie.reponse, moments.length);
  if (!lu.ok) {
    // Le champ fautif est un nom de NOTRE contrat, jamais une valeur du
    // modèle — `lireReponseSignaux` ne nomme que ses propres clés.
    return sansEnrichissement(candidats, lu.motif, `${lu.motif}:${lu.champ}`);
  }

  // ── L'attache — le seul endroit où les candidats changent ──────────────
  //
  // ⚠️ `...c` D'ABORD, `signaux` ENSUITE, ET RIEN D'AUTRE. Aucune autre clé
  // n'est écrite : `secondeReference`, `dureeCibleSecondes`, `scoreMontage`,
  // `raison` et `rang` traversent par copie, et un test compare les deux
  // listes champ à champ.
  const enrichis = candidats.map((c) => ({ ...c, signaux: null as CandidatMontage['signaux'] }));
  for (const [m, index] of positions.entries()) {
    enrichis[index] = { ...enrichis[index], signaux: lu.valeur[m] };
  }

  return {
    candidats: enrichis,
    applique: true,
    motif: null,
    detail: null,
    modele: sortie.modele,
    usage: usageSignaux({
      images: moments.length,
      inputTokens: sortie.usage?.inputTokens,
      outputTokens: sortie.usage?.outputTokens,
    }),
  };
}
