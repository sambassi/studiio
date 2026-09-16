/**
 * Le consentement D-ID de l'avatar vidéo courant.
 *
 *   POST — demande la phrase à lire (idempotent : la même phrase tant qu'elle
 *          n'a pas été refusée) ;
 *   GET  — l'étape courante, en resynchronisant la vérification chez D-ID
 *          quand une vidéo de consentement est en cours d'examen (un poll par
 *          appel ; la page rappelle en boucle).
 *
 * Aucune clé, aucun identifiant fournisseur ne sort : l'écran reçoit une
 * étape, une phrase, un éventuel message.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { demanderConsentementDid, verifierConsentementDid } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../reponse';

export const dynamic = 'force-dynamic';

/**
 * POST { nom?, renouveler? } — `nom` : le nom de la PERSONNE, tel qu'elle le
 * prononcera (saisi à l'écran) ; à défaut, le nom du profil de la session.
 * Jamais le nom de l'avatar. `renouveler` : une nouvelle phrase (expirée,
 * ou nom changé).
 */
export async function POST(req: NextRequest) {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  let corps: { nom?: unknown; renouveler?: unknown } = {};
  try { corps = (await req.json()) ?? {}; } catch { corps = {}; }
  const session = await auth();
  const nom = typeof corps.nom === 'string' && corps.nom.trim() ? corps.nom : session?.user?.name ?? undefined;
  try {
    return reponseDid(await demanderConsentementDid(c.userId, { nom, renouveler: corps.renouveler === true }));
  } catch (e) {
    console.error('[Avatar][D-ID] consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Le consentement n’a pas pu être demandé.' }, { status: 500 });
  }
}

/** GET ?nom=… — l'étape courante ; avec `nom`, dit aussi si un consentement VALIDÉ de la même personne est réutilisable. */
export async function GET(req: NextRequest) {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  const nomReutilisation = req.nextUrl.searchParams.get('nom') ?? undefined;
  try {
    return reponseDid(await verifierConsentementDid(c.userId, { nomReutilisation }));
  } catch (e) {
    console.error('[Avatar][D-ID] suivi du consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Le consentement n’a pas pu être vérifié.' }, { status: 500 });
  }
}
