/**
 * POST /api/avatar/did/consentement/reutiliser { nom } — rattache à la version
 * courante un consentement D-ID déjà VALIDÉ de la même personne (même nom,
 * exactement) : aucun POST /consents, aucune phrase, aucune vidéo. Le
 * fournisseur est relu d'abord ; s'il ne tient plus le consentement pour
 * validé, 409 `consentement_non_reutilisable` — la personne repasse par
 * « Obtenir ma phrase ». Rien de silencieux.
 */
import { NextRequest, NextResponse } from 'next/server';
import { reutiliserConsentementDid } from '@/lib/avatar/did';
import { compteCourant, reponseDid } from '../../reponse';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const c = await compteCourant();
  if ('reponse' in c) return c.reponse;
  let corps: { nom?: unknown } = {};
  try { corps = (await req.json()) ?? {}; } catch { corps = {}; }
  try {
    return reponseDid(await reutiliserConsentementDid(c.userId, { nom: corps.nom }));
  } catch (e) {
    console.error('[Avatar][D-ID] réutilisation du consentement :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Le consentement n’a pas pu être réutilisé.' }, { status: 500 });
  }
}
