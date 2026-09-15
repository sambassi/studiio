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
import { NextResponse } from 'next/server';
import { demanderConsentementDid, verifierConsentementDid } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../reponse';

export const dynamic = 'force-dynamic';

export async function POST() {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  try {
    return reponseDid(await demanderConsentementDid(c.userId));
  } catch (e) {
    console.error('[Avatar][D-ID] consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Le consentement n’a pas pu être demandé.' }, { status: 500 });
  }
}

export async function GET() {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  try {
    return reponseDid(await verifierConsentementDid(c.userId));
  } catch (e) {
    console.error('[Avatar][D-ID] suivi du consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Le consentement n’a pas pu être vérifié.' }, { status: 500 });
  }
}
