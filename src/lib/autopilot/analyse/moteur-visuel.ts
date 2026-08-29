/**
 * La couture entre la route et l'étape visuelle.
 *
 * Calqué sur `moteur.ts`, et séparé de lui pour la même raison qui a fait
 * séparer les deux étapes : `moteur.ts` importe statiquement `MOTIFS_EXTRACTION`
 * depuis `extraction.ts`, donc tire `child_process` et `minio` dès qu'on le
 * touche. Le rendre bicéphale ferait payer ffmpeg à qui ne veut que le visuel.
 *
 * ⚠️ `chargerMoteurVisuel()` rend `null` quand AUCUN fournisseur n'est branché,
 * et ce n'est pas une panne : c'est un déploiement où l'analyse s'arrête à
 * l'extraction — exactement ce qu'elle a toujours fait. L'appelant clôt alors
 * `reussie` à l'étape `extraction`, et les analyses déjà en base restent
 * indiscernables des nouvelles.
 */
// ⚠️ LE CONTRAT, PAS LE MOTEUR. `visuel.ts` tire ffmpeg et MinIO ; ce module
// est importé par la route, qui n'a aucune raison de les charger.
import { motifVisuelEtapeValide } from './visuel-contrat';
import type { DemandeVisuel, ResultatEtapeVisuelle } from './visuel';

export type { DemandeVisuel, ResultatEtapeVisuelle };

/**
 * Le fournisseur de l'étape `visuel`, tel qu'il s'écrit dans `fournisseurs`.
 *
 * ⚠️ IL VIT ICI, ET PAS DANS LA ROUTE. Un test de M3-B2 vérifie que la route
 * ne NOMME aucun fournisseur — c'est ce qui garantit qu'elle n'en appelle
 * aucun elle-même. L'identité du fournisseur appartient au moteur, la route se
 * contente de la recopier en base.
 *
 * Le nom du modèle est une CONSTANTE : un modèle qui se nommerait lui-même
 * écrirait dans `fournisseurs` une chaîne qu'il aurait choisie.
 */
export const FOURNISSEUR_VISUEL = { fournisseur: 'anthropic' as const, modele: 'vision' };

/** La signature, en un seul type — c'est le contrat entre les deux morceaux. */
export type MoteurVisuel = (demande: DemandeVisuel) => Promise<ResultatEtapeVisuelle>;

/**
 * Le moteur posé à la main — la couture, pour les tests.
 *
 * Un test qui devrait appeler un vrai modèle pour vérifier qu'une analyse
 * passe à `echouee` ne testerait pas l'orchestration, il testerait le modèle —
 * et il coûterait de l'argent à chaque exécution. Cette injection est donc ce
 * qui rend la route testable SANS fournisseur, et elle ne change rien en
 * production, où personne ne l'appelle.
 */
let moteurInjecte: MoteurVisuel | null = null;

export function definirMoteurVisuel(moteur: MoteurVisuel | null): void {
  moteurInjecte = moteur;
}

/**
 * Charge le moteur visuel, ou rend `null` s'il n'y a rien à charger.
 *
 * Deux façons de rendre `null`, et elles se répondent de la même manière :
 * le module est absent, ou il est là mais aucun fournisseur n'y est branché.
 * Dans les deux cas l'étape visuelle n'a pas lieu et l'analyse se clôt à
 * l'extraction — sans erreur, sans 503, sans rien à diagnostiquer.
 */
export async function chargerMoteurVisuel(): Promise<MoteurVisuel | null> {
  if (moteurInjecte) return moteurInjecte;
  try {
    const module = await import('@/lib/autopilot/analyse/visuel') as Record<string, unknown>;
    const disponible = module.moteurVisuelDisponible;
    if (typeof disponible !== 'function' || !disponible()) return null;
    const candidat = module.analyserVisuelRush;
    return typeof candidat === 'function' ? candidat as MoteurVisuel : null;
  } catch {
    return null;
  }
}

/**
 * Vérifie que ce que le moteur a rendu a bien la forme annoncée.
 *
 * Le moteur est du code à nous, mais il est écrit séparément, et un retour mal
 * formé écrit tel quel dans `rush_analyses` serait accepté par la base
 * (`jsonb`) puis abandonné en silence à la lecture. Le refuser ici le rend
 * bruyant, ce qui est le seul comportement utile.
 */
export function resultatVisuelEtapeValide(valeur: unknown): ResultatEtapeVisuelle | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null;
  const r = valeur as Record<string, unknown>;

  if (r.ok === false) {
    // ⚠️ LE VOCABULAIRE EST FERMÉ, ET IL EST VÉRIFIÉ.
    //
    // Accepter n'importe quelle chaîne ferait entrer en base, via
    // `motif_echec`, un mot que `MESSAGES_ECHEC` ne connaît pas et que
    // `ECHECS_DEFINITIFS` ne sait pas classer : l'écran afficherait le
    // message générique et proposerait de relancer un échec définitif.
    // Un motif hors liste n'est pas un échec mal nommé, c'est un moteur qui
    // ne parle pas le même langage — et ça se refuse.
    if (!motifVisuelEtapeValide(r.motif)) return null;
    return {
      ok: false,
      motif: r.motif,
      detail: typeof r.detail === 'string' ? r.detail : undefined,
    };
  }
  if (r.ok !== true) return null;

  if (typeof r.modele !== 'string' || !r.modele) return null;
  const v = r.visuel;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const visuel = v as Record<string, unknown>;

  // Le CONTENU n'est pas revalidé ici : `lireReponseVisuelle` l'a déjà fait,
  // avec le vocabulaire fermé et les bornes, et le refus qu'il rend nomme le
  // champ. Deux validations du même objet divergeraient au troisième
  // changement. On vérifie seulement que les trois blocs sont présents et de
  // la bonne FORME — ce qui suffit à ne rien écrire d'informe en base.
  if (typeof visuel.resume !== 'string' || !visuel.resume) return null;
  if (!Array.isArray(visuel.textesVisibles)) return null;
  if (typeof visuel.qualite !== 'object' || visuel.qualite === null) return null;
  if (typeof visuel.usage !== 'object' || visuel.usage === null) return null;

  return valeur as ResultatEtapeVisuelle;
}
