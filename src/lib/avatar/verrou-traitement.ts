/**
 * UN SEUL envoi ou traitement de source vidéo à la fois PAR COMPTE.
 *
 * Chaque appel stocke jusqu'à 32 Mo ou lance ffmpeg jusqu'à 240 s : sans ce
 * verrou, un seul compte pourrait saturer le serveur en parallélisant.
 * Verrou en mémoire du processus (un conteneur applicatif) — suffisant
 * contre la rafale d'un même navigateur ; jamais bloquant au-delà d'un appel.
 */
const enCours = new Set<string>();

export function prendreVerrouSource(userId: string): boolean {
  if (enCours.has(userId)) return false;
  enCours.add(userId);
  return true;
}

export function libererVerrouSource(userId: string): void {
  enCours.delete(userId);
}

export const MESSAGE_SOURCE_EN_COURS = 'Une vidéo est déjà en cours de traitement. Patientez quelques secondes, puis réessayez.';

/**
 * UNE création de version / d'avatar à la fois PAR COMPTE, TOUS CONTENEURS
 * CONFONDUS — le verrou en mémoire ci-dessus ne voit pas l'autre conteneur
 * d'un déploiement progressif. Un bail en base (`prendre_verrou_creation_avatar`,
 * migration identités/versions) : pris et rendu chacun en une instruction,
 * jamais une transaction tenue pendant l'appel au fournisseur. Il expire seul
 * si le conteneur meurt en plein appel.
 *
 * Fermé par défaut : base injoignable = pas de création (jamais un appel
 * fournisseur payant sans le bail).
 */
export const DUREE_BAIL_CREATION_S = 600; // > maxDuration (300 s) de la route

export type BailCreation =
  | { ok: true; rendre: () => Promise<void> }
  | { ok: false; motif: 'occupe' | 'base' };

export async function prendreBailCreation(userId: string): Promise<BailCreation> {
  const { supabaseAdmin } = await import('@/lib/db/supabase');
  const jeton = globalThis.crypto.randomUUID();
  const { data, error } = await supabaseAdmin.rpc('prendre_verrou_creation_avatar', {
    p_user_id: userId, p_jeton: jeton, p_secondes: DUREE_BAIL_CREATION_S,
  });
  if (error) {
    console.error('[Avatar][verrou] bail de création illisible :', error.message);
    return { ok: false, motif: 'base' };
  }
  if (data !== true) return { ok: false, motif: 'occupe' };
  return {
    ok: true,
    rendre: async () => {
      const r = await supabaseAdmin.rpc('liberer_verrou_creation_avatar', { p_user_id: userId, p_jeton: jeton });
      // Non rendu : il expirera seul. Jamais bloquant pour la réponse.
      if (r.error) console.warn('[Avatar][verrou] bail non rendu (expirera seul) :', r.error.message);
    },
  };
}
