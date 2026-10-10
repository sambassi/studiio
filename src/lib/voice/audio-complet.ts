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
 * Tarif : 1 crédit Studiio par bloc ENTAMÉ de 1000 caractères du texte
 * soumis, 1 au minimum (1–1000 → 1, 1001–2000 → 2, 2500 → 3). Le serveur
 * recalcule lui-même ce prix à partir du texte reçu ; l'écran n'utilise
 * cette fonction que pour l'annoncer. Administrateur : 0 crédit.
 */

export const MAX_CARACTERES_AUDIO_COMPLET = 5000;
export const CARACTERES_PAR_CREDIT_AUDIO_COMPLET = 1000;

/** Le prix, en crédits Studiio, d'un audio complet de `nbCaracteres` caractères. */
export function coutAudioComplet(nbCaracteres: number): number {
  const n = Number.isFinite(nbCaracteres) ? Math.max(0, Math.floor(nbCaracteres)) : 0;
  return Math.max(1, Math.ceil(n / CARACTERES_PAR_CREDIT_AUDIO_COMPLET));
}

export const libelleCredits = (n: number) => `${n} crédit${n > 1 ? 's' : ''}`;

/** Le libellé du bouton : le prix est toujours annoncé avant le clic. */
export function libelleBoutonAudioComplet(nbCaracteres: number, administrateur: boolean): string {
  if (administrateur) return 'Générer l’audio complet — 0 crédit (administrateur)';
  return `Générer l’audio complet — ${libelleCredits(coutAudioComplet(nbCaracteres))}`;
}

export const MESSAGE_TEXTE_AUDIO_COMPLET_VIDE = 'Le texte à générer est vide.';
export const MESSAGE_TEXTE_AUDIO_COMPLET_TROP_LONG = `L’audio complet est limité à ${MAX_CARACTERES_AUDIO_COMPLET} caractères.`;
export const MESSAGE_GENERATION_EN_COURS = 'Cet audio est déjà en cours de génération.';
export const MESSAGE_AUDIO_COMPLET_ECHEC = 'L’audio complet n’a pas pu être généré. Réessayez — aucun crédit n’a été débité.';
export const MESSAGE_AUDIO_COMPLET_INDISPONIBLE = 'La génération de l’audio complet n’est pas encore disponible.';

export function messageCreditsInsuffisants(cout: number): string {
  return `Crédits insuffisants : cet audio coûte ${libelleCredits(cout)}.`;
}
