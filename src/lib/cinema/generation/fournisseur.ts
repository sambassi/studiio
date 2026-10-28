/**
 * FOURNISSEURS DE GENERATION IA — le contrat, et un registre fermé.
 *
 * Lot 3 : preparer la generation d'images et de videos par IA, SANS en
 * brancher une seule qui coute un centime. Ce module ne decide de RIEN sur
 * le cout ni sur l'autorisation — ca, c'est `couts.ts` et `atelier.ts` — il
 * ne fait que DECRIRE ce qu'un fournisseur sait faire, dans une forme assez
 * etroite pour qu'un faux et un vrai fournisseur s'y glissent a l'identique.
 *
 * ⚠️ UN FOURNISSEUR REND UN FICHIER LOCAL, JAMAIS UNE URL DISTANTE. Le jour
 * ou un vrai fournisseur (Replicate, par ex. — deja utilise ailleurs dans
 * Studiio pour `generate-bg` et `image-to-video`, voir
 * `src/app/api/ai/image/route.ts`) sera branche, SON wrapper devra
 * telecharger la sortie et la faire passer par les MEMES controles qu'un
 * import manuel (`medias.signatureConnue`, extension, conteneur autorise)
 * AVANT de rendre ce chemin local — exactement ce que `atelier.ts` fait deja
 * pour le resultat du fournisseur simule. Aucun wrapper reseau n'est ecrit
 * dans ce lot : le construire sans ce controle serait reintroduire le SSRF
 * deja corrige sur l'import manuel (`medias.ts`, revue du 2026-10-26).
 *
 * ⚠️ LE REGISTRE EST FERME. `fournisseurGeneration(id)` ne rend QUE les
 * fournisseurs ici déclarés : un `id` libre envoye par un appelant ne peut
 * jamais designer un fournisseur improvise.
 */
import type { FormatFilm } from '@/lib/cinema/types';

/** Operation demandee a un fournisseur de generation. */
export type OperationGenerationIA = 'image' | 'video';

/** Apparence d'un personnage, telle qu'un fournisseur la recoit. */
export interface ApparencePersonnageGeneration {
  id: string;
  nom: string;
  /** Texte stable de reference (`ReferencePersonnage.description`). */
  description: string;
  /** Visuel de reference, si le personnage en a un. */
  urlImage: string | null;
}

export interface DemandeImageGeneration {
  /** Ce que le plan montre (`PlanCinema.description`), en francais, tel quel. */
  promptPlan: string;
  /**
   * Prompt ANGLAIS deja construit par le systeme existant
   * (`lib/ai/prompt-image.ts`, utilise par `/api/ai/image` pour Replicate) :
   * ce que recevra un vrai fournisseur. Le fournisseur simule l'ignore (il
   * dessine, il ne « comprend » rien) ; un wrapper reel n'aura rien a
   * reconstruire.
   */
  promptConstruit: string;
  /** Personnages PRESENTS dans le plan — pour la coherence visuelle. */
  personnages: ApparencePersonnageGeneration[];
  format: FormatFilm;
  /** Graine de reproductibilite — deux appels avec la meme graine rendent le meme resultat. */
  graine: number;
}

export interface DemandeVideoGeneration {
  /** Image SOURCE, deja sur le disque (generee ou importee) — image-vers-video. */
  fichierImageSource: string;
  /**
   * Mouvement attendu, en ANGLAIS — comme `promptConstruit` pour l'image. Les
   * modeles image-vers-video de la famille Wan EXIGENT ce champ : une image
   * seule, sans texte, est refusee par le fournisseur (422).
   */
  prompt: string;
  /** Duree visee, bornee par le fournisseur. */
  dureeS: number;
  format: FormatFilm;
  graine: number;
}

export type ResultatGenerationIA =
  | { ok: true; fichier: string; nomSuggere: string }
  | {
    ok: false; erreur: string;
    /**
     * `true` SEULEMENT quand la preuve existe qu'aucun appel reseau n'est
     * jamais parti (ex. validation locale refusee avant toute requete) —
     * jamais devine : par defaut (absent), on suppose que l'appel a pu
     * atteindre le fournisseur et etre facture.
     */
    jamaisEnvoye?: boolean;
    /**
     * `true` quand le delai D'ATTENTE a expire pendant l'appel : le
     * fournisseur a pu demarrer — et facturer — une prediction qui continue
     * sans nous, ou a pu ne jamais la recevoir. Ni confirme ni ecarte :
     * reste compte comme depense jusqu'a reconciliation.
     */
    incertain?: boolean;
    /**
     * `true` quand l'appel EST parti, a bien echoue, et que le fournisseur
     * DOCUMENTE que cette issue n'est pas facturee (Higgsfield : « Failed and
     * NSFW requests are not charged; any reserved amount is refunded », et une
     * annulation avant traitement est remboursee).
     *
     * Ce n'est donc pas `jamaisEnvoye` — quelque chose est bien parti — mais la
     * consequence financiere est la meme : la reservation de depense est
     * LIBEREE au lieu d'etre comptee. Absent par defaut : sans engagement
     * ecrit du fournisseur, un echec reste suppose facture.
     */
    nonFacture?: boolean;
  };

/**
 * Le contrat. `actif: false` = DECLARE mais jamais appele : c'est la garde
 * qui tient « aucune generation payante » au niveau du TYPE, pas seulement
 * de la documentation — `atelier.ts` refuse tout fournisseur `actif: false`
 * avant meme de construire une demande.
 */
export interface FournisseurGenerationIA {
  id: string;
  libelle: string;
  actif: boolean;
  genererImage(demande: DemandeImageGeneration): Promise<ResultatGenerationIA>;
  genererVideo(demande: DemandeVideoGeneration): Promise<ResultatGenerationIA>;
}

const REGISTRE = new Map<string, FournisseurGenerationIA>();

/** Un seul point d'enregistrement — appele par chaque module de fournisseur a son chargement. */
export function enregistrerFournisseur(f: FournisseurGenerationIA): void {
  REGISTRE.set(f.id, f);
}

/** `null` si l'id ne correspond a aucun fournisseur declare — jamais un fournisseur improvise. */
export function fournisseurGeneration(id: string): FournisseurGenerationIA | null {
  return REGISTRE.get(id) ?? null;
}

export function fournisseursDeclares(): readonly FournisseurGenerationIA[] {
  return [...REGISTRE.values()];
}

/** Remise a zero du registre — tests uniquement, pour composer un registre isole. */
export function reinitialiserRegistrePourTests(): void {
  REGISTRE.clear();
}
