/**
 * M3-H — CE QUE LE NAVIGATEUR A LE DROIT DE VOIR.
 *
 * ⚠️ UNE PROJECTION, JAMAIS LA LIGNE. Rendre l'objet de domaine tel quel
 * exposerait `montagePlanId`, `montagePlanVersion`, `methodeRendu` et le
 * relevé d'exécution — dont `orphelins`, qui nomme des objets du stockage.
 * Rien de tout cela n'aide un écran, et tout cela renseigne qui n'a pas à
 * l'être.
 *
 * ⚠️ ET AUCUNE PROGRESSION INVENTÉE. M3-H ne sait pas qu'il est à 43 % : il
 * sait quelle ÉTAPE il traverse. Fabriquer un pourcentage à partir du nom de
 * l'étape serait une mesure sans mesure.
 */
import type { EtapeRendu, EtatRendu, MotifRendu } from './rendu-contrat';
import { motifRenduValide } from './rendu-contrat';
import type { RenduMontage } from './rendu-service';

export interface RenduPublic {
  id: string;
  etat: EtatRendu;
  etape: EtapeRendu | null;
  /** Renseigné pour un échec seulement, et pris dans le vocabulaire fermé. */
  motif: MotifRendu | null;
  /** Renseigné pour une réussite seulement. */
  video: {
    dureeSecondes: number;
    largeur: number;
    hauteur: number;
    fps: number | null;
    octets: number;
    /**
     * Le chemin de l'application qui sert les octets — PAS une URL signée.
     *
     * ⚠️ LE DÉPÔT N'A AUCUN SIGNEUR DE LECTURE ATTEIGNABLE PAR UN NAVIGATEUR.
     * `signeurInterne` produit une adresse sur le nom INTERNE du stockage,
     * dont sa propre documentation dit qu'elle « ne doit JAMAIS sortir du
     * serveur » ; `signeurPublic` ne sait que signer un dépôt, pas une
     * lecture. Le relais public existant, lui, répond SANS session — par
     * nécessité, puisque Meta et TikTok viennent chercher les fichiers
     * eux-mêmes — et bloque déjà le domaine des vignettes d'analyse pour
     * cette raison précise.
     *
     * La convention du dépôt pour servir un octet privé est donc la route
     * authentifiée qui le relaie, comme le fait déjà la lecture des
     * vignettes. C'est celle-là qui est suivie : un chemin relatif, aucune
     * signature, rien à faire expirer, et le contrôle de propriété refait à
     * chaque requête plutôt que gelé dans un jeton.
     */
    chemin: string;
  } | null;
  creeLe: string;
  termineLe: string | null;
}

export function renduPublic(rendu: RenduMontage): RenduPublic {
  const echoue = rendu.etat === 'echouee' || rendu.etat === 'annulee';
  const reussi = rendu.etat === 'reussie' && rendu.resultat !== null;
  return {
    id: rendu.id,
    etat: rendu.etat,
    etape: rendu.etape,
    // Un motif hors vocabulaire ne ressort pas : c'est par là qu'un message
    // interne s'échapperait si une écriture ancienne en portait un.
    motif: echoue && motifRenduValide(rendu.motifEchec) ? rendu.motifEchec : null,
    video: reussi ? {
      dureeSecondes: rendu.resultat!.dureeMesureeSecondes,
      largeur: rendu.resultat!.largeur,
      hauteur: rendu.resultat!.hauteur,
      fps: rendu.resultat!.fpsMesure,
      octets: rendu.resultat!.octets,
      chemin: `/api/autopilot/rendus-montage/${rendu.id}/fichier`,
    } : null,
    creeLe: rendu.createdAt,
    termineLe: rendu.completedAt,
  };
}
