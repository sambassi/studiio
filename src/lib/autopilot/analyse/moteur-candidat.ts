/**
 * La couture entre la route M3-C et le moteur des candidats.
 *
 * Calquée sur `moteur-visuel.ts`, et séparée de lui pour la même raison qui a
 * fait séparer les étapes : `candidat.ts` importe `visuel.ts`, qui tire MinIO.
 * La route n'a aucune raison de le charger.
 *
 * ⚠️ `chargerMoteurCandidats()` rend `null` quand AUCUN fournisseur n'est
 * branché, et ce n'est pas une panne : c'est un déploiement où M3-C n'est pas
 * activé. L'écran l'annonce, et rien d'autre ne change.
 */
// ⚠️ LE CONTRAT, PAS LE MOTEUR.
import { motifCandidatsEtapeValide, motifCandidatsValide } from './candidat-contrat';
import type { DemandeCandidats, ResultatEtapeCandidats } from './candidat';

export type { DemandeCandidats, ResultatEtapeCandidats };

/**
 * Le fournisseur de l'étape `candidats`, tel qu'il s'écrit dans
 * `fournisseurs`.
 *
 * ⚠️ IL VIT ICI, ET PAS DANS LA ROUTE. Le même test que pour M3-B4 vaut :
 * une route qui NOMME un fournisseur est une route qu'on soupçonnera d'en
 * appeler un. L'identité appartient au moteur, la route la recopie.
 *
 * Le modèle est une CONSTANTE d'attente, remplacée à la clôture par celui
 * réellement employé : un modèle qui se nommerait lui-même écrirait dans
 * `fournisseurs` une chaîne qu'il aurait choisie.
 */
export const FOURNISSEUR_CANDIDATS = {
  fournisseur: 'anthropic' as const, modele: 'montage',
};

/** La longueur au-delà de laquelle un diagnostic n'est plus un diagnostic. */
export const DIAGNOSTIC_CANDIDATS_MAX = 160;

/** Le repli, quand rien ne peut être dit sûrement. Un littéral à nous. */
export const DIAGNOSTIC_CANDIDATS_INVALIDE = 'detail_invalide';

/**
 * Un chemin de champ, et rien d'autre : `candidats[2].raison`,
 * `candidats[0].scoreMontage`. Pas d'espace, donc ni saut de ligne ni
 * tabulation ; pas de `/`, donc pas d'URL ; pas de `+` ni de `=`, donc aucun
 * encodage en base 64 ; pas d'échappement, donc pas de séquence ANSI.
 */
const CHEMIN_CHAMP = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[[0-9]+\])*$/;

/**
 * Rend un diagnostic SÛR à journaliser, ou le littéral de repli.
 *
 * Même raisonnement qu'en M3-B4.2, et il vaut ici aussi : `detail` vaut
 * `${motifFin}:${champ}` et vient de notre code, mais `champ` ne l'est pas
 * toujours. `lireReponseCandidats` refuse une clé inconnue en la NOMMANT, et
 * cette clé a été écrite par LE MODÈLE.
 *
 * Le filtre n'est donc pas un jeu de caractères : il exige la FORME entière —
 * un motif de notre vocabulaire fermé, deux-points, un chemin de champ.
 */
export function diagnosticCandidatsSur(detail: unknown): string {
  if (typeof detail !== 'string') return DIAGNOSTIC_CANDIDATS_INVALIDE;
  if (detail.length === 0 || detail.length > DIAGNOSTIC_CANDIDATS_MAX) {
    return DIAGNOSTIC_CANDIDATS_INVALIDE;
  }

  const coupure = detail.indexOf(':');
  if (coupure <= 0) return DIAGNOSTIC_CANDIDATS_INVALIDE;

  const motif = detail.slice(0, coupure);
  const champ = detail.slice(coupure + 1);
  if (!motifCandidatsValide(motif)) return DIAGNOSTIC_CANDIDATS_INVALIDE;
  if (!CHEMIN_CHAMP.test(champ)) return DIAGNOSTIC_CANDIDATS_INVALIDE;

  return `${motif}:${champ}`;
}

export type MoteurCandidats =
  (demande: DemandeCandidats) => Promise<ResultatEtapeCandidats>;

/** Le moteur posé à la main — la couture, pour les tests. */
let moteurInjecte: MoteurCandidats | null = null;

export function definirMoteurCandidats(moteur: MoteurCandidats | null): void {
  moteurInjecte = moteur;
}

/**
 * Charge le moteur des candidats, ou rend `null` s'il n'y a rien à charger.
 *
 * Trois façons de rendre `null` : le module est absent, il est là mais aucun
 * fournisseur n'y est branché, ou le drapeau M3-C n'est pas posé. Dans les
 * trois cas l'étape n'a pas lieu, et l'écran le dit.
 */
export async function chargerMoteurCandidats(): Promise<MoteurCandidats | null> {
  // A. Le moteur posé par un test gagne toujours, et sans rien charger.
  if (moteurInjecte) return moteurInjecte;

  let module: Record<string, unknown>;
  try {
    module = await import('@/lib/autopilot/analyse/candidat') as Record<string, unknown>;
  } catch {
    return null;
  }

  const disponible = module.moteurCandidatsDisponible;
  const candidat = module.produireCandidats;
  if (typeof disponible !== 'function' || typeof candidat !== 'function') return null;

  // B. Un fournisseur déjà branché — par un test, ou par un appel précédent.
  if (disponible()) return candidat as MoteurCandidats;

  // ── C/D/E. Le branchement de l'adaptateur ────────────────────────────
  //
  // ⚠️ L'IMPORT EST ICI, ET PAS DANS `candidat.ts`.
  //
  // `candidat-anthropic.ts` importe `TIMEOUT_CANDIDATS_MS` et `IMAGES_MAX`
  // DEPUIS `candidat.ts`. Le brancher là-bas fabriquerait un cycle. Ce
  // module-ci n'est importé ni par l'un ni par l'autre : il peut les
  // connaître tous les deux.
  //
  // C'est aussi ce qui fait ENTRER l'adaptateur dans le paquet serveur — la
  // panne muette de M3-B4, où le fichier existait dans l'image sans que le
  // traceur de Next le voie, ne se reproduira pas ici.
  let adaptateur: Record<string, unknown>;
  try {
    adaptateur = await import('@/lib/autopilot/analyse/candidat-anthropic') as Record<string, unknown>;
  } catch {
    return null;
  }

  const actif = adaptateur.candidatsAnthropicActif;
  // C. Drapeau absent, `false`, `"1"`, `"oui"`… — M3-C n'est pas demandé.
  //    Aucune clé n'est lue, aucun réseau n'est touché.
  if (typeof actif !== 'function' || !actif()) return null;

  const construire = adaptateur.fournisseurCandidatsAnthropic;
  if (typeof construire !== 'function') return null;

  // ⚠️ E. AUCUN `catch` ICI, ET C'EST DÉLIBÉRÉ.
  //
  // `fournisseurCandidatsAnthropic()` lève `ConfigurationCandidatsInvalide`
  // quand le drapeau est posé mais que la clé ou le modèle manque. Avaler
  // cette erreur la transformerait en « aucun fournisseur configuré » —
  // exactement l'inverse de ce qu'on veut dire : quelqu'un a DEMANDÉ M3-C et
  // il ne peut pas se faire.
  const fournisseur = (construire as () => unknown)();
  if (typeof fournisseur !== 'function') return null;

  const brancher = module.definirFournisseurCandidats;
  if (typeof brancher !== 'function') return null;
  (brancher as (f: unknown) => void)(fournisseur);

  return candidat as MoteurCandidats;
}

/**
 * Vérifie que ce que le moteur a rendu a bien la forme annoncée.
 *
 * Le moteur est du code à nous, mais il est écrit séparément, et un retour
 * mal formé écrit tel quel en base serait accepté par `jsonb` puis abandonné
 * en silence à la lecture.
 */
export function resultatCandidatsEtapeValide(
  valeur: unknown,
): ResultatEtapeCandidats | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null;
  const r = valeur as Record<string, unknown>;

  if (r.ok === false) {
    // Le vocabulaire est fermé, et il est vérifié : un motif hors liste
    // afficherait le message générique et proposerait de relancer un échec
    // définitif.
    if (!motifCandidatsEtapeValide(r.motif)) return null;
    return {
      ok: false,
      motif: r.motif,
      detail: typeof r.detail === 'string' ? r.detail : undefined,
    };
  }
  if (r.ok !== true) return null;

  if (typeof r.modele !== 'string' || !r.modele) return null;
  if (!Array.isArray(r.candidats) || r.candidats.length === 0) return null;
  if (typeof r.usage !== 'object' || r.usage === null) return null;

  return valeur as ResultatEtapeCandidats;
}
