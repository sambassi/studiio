/**
 * « Générer l'audio complet » — le tarif et les bornes, communs à l'écran et
 * au serveur (module pur, sans dépendance serveur).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE OPÉRATION À PART, ET SEULEMENT ELLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La pré-écoute (≈ 5 s, `preecoute.ts`) reste gratuite et ne se télécharge
 * pas. L'audio complet est une opération AUTONOME de la page « Ma voix » :
 * il n'est branché ni sur `/api/tts/*`, ni sur Créer, l'Autopilote, le
 * Jumeau ou l'avatar — ces parcours ont leur propre tarif et ne paient
 * jamais deux fois la voix.
 *
 * Tarif : `audio.full_1000_chars` de la grille centrale (1 sans
 * configuration admin) crédit(s) Studiio par bloc ENTAMÉ de 1000 caractères
 * du texte soumis, 1 bloc au minimum (au tarif 1 : 1–1000 → 1,
 * 1001–2000 → 2, 2500 → 3). La TRANCHE reste fixe (1000) ; seul le prix
 * d'une tranche se configure — à 0, l'audio complet est gratuit. Le serveur
 * recalcule lui-même ce prix à partir du texte reçu et de la grille ;
 * l'écran n'utilise cette fonction que pour l'annoncer. Administrateur : 0.
 */

export const MAX_CARACTERES_AUDIO_COMPLET = 5000;
export const CARACTERES_PAR_CREDIT_AUDIO_COMPLET = 1000;

/** Le nombre de tranches facturées : blocs entamés de 1000 caractères, 1 au minimum. */
export function tranchesAudioComplet(nbCaracteres: number): number {
  const n = Number.isFinite(nbCaracteres) ? Math.max(0, Math.floor(nbCaracteres)) : 0;
  return Math.max(1, Math.ceil(n / CARACTERES_PAR_CREDIT_AUDIO_COMPLET));
}

/**
 * Le prix, en crédits Studiio, d'un audio complet de `nbCaracteres`
 * caractères, au tarif `creditsParTranche` (grille centrale ; 1 par défaut,
 * le prix d'avant).
 */
export function coutAudioComplet(nbCaracteres: number, creditsParTranche = 1): number {
  const prix = Number.isInteger(creditsParTranche) && creditsParTranche >= 0 ? creditsParTranche : 1;
  return tranchesAudioComplet(nbCaracteres) * prix;
}

/** La phrase d'explication du tarif, au prix de la grille. */
export function explicationTarifAudioComplet(creditsParTranche = 1): string {
  return `${libelleCredits(creditsParTranche)} par tranche de ${CARACTERES_PAR_CREDIT_AUDIO_COMPLET} caractères entamée.`;
}

export const libelleCredits = (n: number) => `${n} crédit${n > 1 ? 's' : ''}`;

/** Le bouton reste court : le prix est annoncé au-dessus, toujours avant le clic. */
export const LIBELLE_BOUTON_AUDIO_COMPLET = 'Générer l’audio complet';

/**
 * Les lignes du bloc prix posé au-dessus du bouton (même présentation que
 * « Générer la vidéo » de Mon avatar). Utilisateur : « Prix : N crédits ».
 * Administrateur : le prix public puis « Votre coût : 0 crédit ».
 * (Avant : un seul libellé de bouton insécable, qui débordait sur mobile.)
 */
export function lignesPrixAudioComplet(nbCaracteres: number, administrateur: boolean, creditsParTranche = 1): string[] {
  const prix = libelleCredits(coutAudioComplet(nbCaracteres, creditsParTranche));
  return administrateur ? [`Prix public : ${prix}`, 'Votre coût : 0 crédit'] : [`Prix : ${prix}`];
}

export const MESSAGE_TEXTE_AUDIO_COMPLET_VIDE = 'Le texte à générer est vide.';
export const MESSAGE_TEXTE_AUDIO_COMPLET_TROP_LONG = `L’audio complet est limité à ${MAX_CARACTERES_AUDIO_COMPLET} caractères.`;
export const MESSAGE_GENERATION_EN_COURS = 'Cet audio est déjà en cours de génération.';
export const MESSAGE_AUDIO_COMPLET_ECHEC = 'L’audio complet n’a pas pu être généré. Réessayez — aucun crédit n’a été débité.';
export const MESSAGE_AUDIO_COMPLET_INDISPONIBLE = 'La génération de l’audio complet n’est pas encore disponible.';

export function messageCreditsInsuffisants(cout: number): string {
  return `Crédits insuffisants : cet audio coûte ${libelleCredits(cout)}.`;
}
