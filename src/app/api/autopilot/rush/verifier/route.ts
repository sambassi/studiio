import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { rushEncorePresent } from '@/lib/autopilot/poster';
import { mediaLisiblePar } from '@/lib/creer/analyse-rush-serveur';
import { etatsRushesServeur } from '@/lib/autopilot/validite-rush';

/**
 * Hygiène de la banque de rushes — `POST /api/autopilot/rush/verifier`.
 *
 * L'écran demande, au chargement de la configuration, si chaque rush de la
 * banque est TOUJOURS accessible. Un rush vit dans `media/`, sous la rétention
 * de 24 h ; supprimé, son adresse reste écrite dans `rush_urls`, et
 * l'utilisateur croit qu'« il ne sert pas » alors qu'il a expiré. Cette route
 * répond, par URL, « accessible » ou « expiré ».
 *
 * ⚠️ ELLE NE HEAD QUE LES RUSHES DU COMPTE. Le corps peut porter n'importe
 * quelle URL ; on n'interroge que celles réellement présentes dans le
 * `rush_urls` de l'utilisateur (relu en base). Toute autre est REFUSÉE sans
 * être contactée : sans ce garde, la route deviendrait un sondeur d'URL
 * arbitraire au nom du serveur (SSRF).
 *
 * ⚠️ ELLE NE MODIFIE RIEN. Un rush expiré est SIGNALÉ, pas retiré : c'est le
 * clic de l'utilisateur (via `PUT /api/autopilot/config`) qui nettoie la
 * banque. Le cron, lui, retire un rush mort qu'il rencontre en produisant —
 * ce sont deux chemins distincts, et aucun n'efface silencieusement.
 *
 * ⚠️ MÊME VÉRITÉ QUE LE MONTAGE (`validite-rush.ts`, `etatAccesRush`). Par URL :
 *   - `resultats[url]` (booléen, contrat d'avant) : `true` = utilisable ;
 *   - `etats[url]` : `utilisable` | `introuvable` (404/410) | `expire`
 *     (400/401/403 : signature expirée, refus du stockage) | `refuse`.
 * Un 500, un délai, une coupure laissent le rush « utilisable » (le doute lui
 * profite) : l'écran ne marque jamais un rush valide comme expiré à cause
 * d'un hoquet du stockage.
 *
 * ⚠️ GARDE DE PROPRIÉTÉ (#546) AVANT TOUT HEAD. Un rush de la banque qui
 * désigne l'objet d'un autre compte (ou un namespace privé) est `refuse` sans
 * être contacté — ni sondé, ni lu, ni signé. Il n'est pas « réparable » :
 * l'écran ne propose pas de le réimporter et ne le retire pas en lot.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Les URL demandées — dédoublonnées, seules les chaînes non vides comptent.
  const corps = await req.json().catch(() => ({}));
  const demandees = Array.isArray((corps as { urls?: unknown }).urls)
    ? Array.from(new Set(
      ((corps as { urls: unknown[] }).urls).filter((u): u is string => typeof u === 'string' && !!u),
    ))
    : [];

  // La banque RÉELLE du compte : c'est elle qui autorise un HEAD, pas le corps.
  const { data } = await supabaseAdmin
    .from('autopilot_config')
    .select('rush_urls')
    .eq('user_id', userId)
    .limit(1);
  const banque = new Set(
    Array.isArray((data?.[0] as { rush_urls?: unknown } | undefined)?.rush_urls)
      ? ((data?.[0] as { rush_urls: unknown[] }).rush_urls).filter((u): u is string => typeof u === 'string')
      : [],
  );

  // Hors compte : refusé, jamais contacté.
  const refusees = demandees.filter((u) => !banque.has(u));
  const aVerifier = demandees.filter((u) => banque.has(u));

  // Les HEAD en parallèle : chacun est borné par le délai de `rushEncorePresent`.
  // Refus de propriété : `refuse`, sans aucun appel réseau.
  const etats = await etatsRushesServeur(aVerifier, (u) => mediaLisiblePar(u, userId), rushEncorePresent);
  const resultats: Record<string, boolean> = {};
  for (const [url, etat] of Object.entries(etats)) resultats[url] = etat === 'utilisable';

  return NextResponse.json({ success: true, resultats, etats, refusees });
}
