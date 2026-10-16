import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { texteConsentement, VERSION_CONSENTEMENT_IA, consentementValide, type LangueConsentement } from '@/lib/creer/consentement-ia';
import { enregistrerConsentementIA, lireConsentementIA } from '@/lib/creer/analyse-ia-rush';

/**
 * M2-b — Consentement à l'analyse IA des rushes, PAR COMPTE (session).
 *
 *   GET    ?langue=fr|en|de  → le texte à afficher + l'état du consentement ;
 *   POST   { accepte: true, version, langue } → enregistre l'accord, seulement
 *          sur la version COURANTE du texte (un accord sur un autre texte est refusé) ;
 *   DELETE → révoque : plus aucun rush n'est envoyé à partir de cet instant.
 *
 * Registre privé du compte (`fiches-contenu/<uid>/…`, purgé par la suppression RGPD).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const langueDe = (v: unknown): LangueConsentement => (v === 'en' || v === 'de' ? v : 'fr');

async function utilisateur() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await utilisateur();
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const langue = langueDe(new URL(req.url).searchParams.get('langue'));
  const registre = await lireConsentementIA(userId);
  return NextResponse.json({ success: true, texte: texteConsentement(langue), valide: consentementValide(registre) });
}

export async function POST(req: NextRequest) {
  const userId = await utilisateur();
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const corps = await req.json().catch(() => null) as { accepte?: unknown; version?: unknown; langue?: unknown } | null;
  if (corps?.accepte !== true || corps.version !== VERSION_CONSENTEMENT_IA) {
    return NextResponse.json({ success: false, error: 'consentement_explicite_requis' }, { status: 400 });
  }
  try {
    await enregistrerConsentementIA(userId, true, langueDe(corps.langue));
    return NextResponse.json({ success: true, valide: true });
  } catch {
    return NextResponse.json({ success: false, error: 'enregistrement_impossible' }, { status: 503 });
  }
}

export async function DELETE() {
  const userId = await utilisateur();
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  try {
    await enregistrerConsentementIA(userId, false, 'fr');
    return NextResponse.json({ success: true, valide: false });
  } catch {
    return NextResponse.json({ success: false, error: 'enregistrement_impossible' }, { status: 503 });
  }
}
