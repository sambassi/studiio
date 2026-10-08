import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { comptesConnectes } from '@/lib/social/publishing';
import { getTiktokCreatorInfo } from '@/lib/social/zernio';
import { CONFIDENTIALITES_TIKTOK, CONFIDENTIALITE_SECURITE } from '@/lib/social/couverture';

/**
 * Ce que le compte TikTok CONNECTÉ de l'utilisateur autorise : niveaux de
 * confidentialité et réglages d'interaction (lecture seule, Zernio
 * `GET /v1/accounts/{id}/tiktok/creator-info`).
 *
 * ⚠️ LE COMPTE EST RÉSOLU ICI, depuis `zernio_accounts` de la session — jamais
 * un identifiant fourni par le navigateur.
 *
 * Zernio injoignable ou réponse inexploitable : `fiable: false` et le seul
 * niveau `SELF_ONLY` — l'écran dit alors « TikTok sera publié en Moi
 * uniquement », jamais un public supposé.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const repli = {
    success: true, fiable: false, nickname: null,
    confidentialites: [CONFIDENTIALITE_SECURITE],
    interactions: null as null | Record<string, { enabled: boolean; default: boolean | null }>,
  };
  const compte = (await comptesConnectes(session.user.id)).find((c) => c.platform === 'tiktok');
  if (!compte) return NextResponse.json({ ...repli, connecte: false });
  try {
    const info = await getTiktokCreatorInfo(compte.accountId);
    const confidentialites = (info.privacyLevels ?? [])
      .map((p) => p.value)
      .filter((v): v is typeof CONFIDENTIALITES_TIKTOK[number] => (CONFIDENTIALITES_TIKTOK as readonly string[]).includes(v));
    if (confidentialites.length === 0) return NextResponse.json({ ...repli, connecte: true });
    const brut: Partial<NonNullable<NonNullable<typeof info.postingLimits>['interactionSettings']>> = info.postingLimits?.interactionSettings ?? {};
    const interactions = Object.fromEntries((['allow_comment', 'allow_duet', 'allow_stitch'] as const).map((k) => [k, {
      enabled: brut[k]?.enabled !== false,
      default: typeof brut[k]?.default === 'boolean' ? brut[k]!.default! : null,
    }]));
    return NextResponse.json({
      success: true, fiable: true, connecte: true,
      nickname: info.creator?.nickname ?? null,
      confidentialites,
      interactions,
    });
  } catch (err) {
    console.warn('[Zernio/TikTok] reglages du compte illisibles :', err instanceof Error ? err.message : err);
    return NextResponse.json({ ...repli, connecte: true });
  }
}
