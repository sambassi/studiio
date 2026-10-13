/**
 * TARIFS API HEYGEN (pay-as-you-go, wallet USD) — pour ESTIMER le coût réel
 * d'une génération, y compris quand elle ne coûte rien en crédits Studiio
 * (admin exempté) : « gratuit pour l'admin » ≠ « gratuit chez HeyGen ».
 *
 * Source : https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained
 * (lue le 2026-10-13, page mise à jour le 2026-09-16) — « Price per 1 minute,
 * charged by actual seconds generated ». HeyGen n'expose AUCUN coût par vidéo
 * dans son API (ni GET /v3/videos/{id}, ni /v3/users/me) : c'est une
 * ESTIMATION, à rapprocher des baisses de `wallet.remaining_balance`.
 *
 * Vérifié en production le 2026-10-13 : 4 vidéos Avatar III / Digital Twin
 * (69,33 s cumulées) = 0,69 $ estimés pour 0,74 $ de baisse du wallet.
 *
 * Fonction PURE.
 */
export type TypeAvatarTarif = 'twin' | 'photo';

/** USD par MINUTE générée, par moteur et type d'avatar. */
export const TARIFS_HEYGEN_USD_PAR_MIN: Record<string, Partial<Record<TypeAvatarTarif, number>>> = {
  avatar_iii: { twin: 0.6, photo: 0.99 },
  avatar_iv: { twin: 4.83, photo: 2.31 },
  avatar_v: { twin: 7.2 },
};

/**
 * Moteur réellement appliqué par HeyGen : sans `engine` dans la requête
 * (`/api/avatar/generate` sans qualité), HeyGen applique Avatar IV — d'après
 * sa documentation « Create Video ».
 */
export function moteurFacture(engine: string | null | undefined): string {
  return engine && TARIFS_HEYGEN_USD_PAR_MIN[engine] ? engine : 'avatar_iv';
}

/** `avatar_type` de `user_avatars` → type tarifaire (vidéo = Digital Twin). */
export function typeTarif(avatarType: string | null | undefined): TypeAvatarTarif {
  return avatarType === 'photo' ? 'photo' : 'twin';
}

/** Coût estimé en USD, ou `null` si la durée ou le tarif manque (jamais 0 par défaut). */
export function coutEstimeHeygenUsd(input: { engine: string | null | undefined; avatarType: string | null | undefined; secondes: number | null | undefined }): number | null {
  const s = Number(input.secondes);
  if (!Number.isFinite(s) || s <= 0) return null;
  const grille = TARIFS_HEYGEN_USD_PAR_MIN[moteurFacture(input.engine)];
  const parMin = grille?.[typeTarif(input.avatarType)] ?? grille?.twin;
  if (typeof parMin !== 'number') return null;
  return Math.round((s / 60) * parMin * 10_000) / 10_000;
}
