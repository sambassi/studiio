import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { localeStatus } from '@/i18n/config';
import { ecrireCorrections, frAplati, langueEditable, lireCorrections, tableTraductions } from '@/lib/i18n/stockage';
import { LIBELLES_STATUT, validerTexte, type Corrections } from '@/lib/i18n/traductions';
import { ecrireCsv } from '@/lib/i18n/csv';

/**
 * Administration des traductions : lecture (JSON ou CSV) et correction / validation d'UNE entrée.
 * Admin seulement. Jamais d'écriture si la lecture des corrections existantes a échoué.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const url = new URL(req.url);
  const locale = url.searchParams.get('locale');
  if (!langueEditable(locale)) return NextResponse.json({ success: false, error: 'Langue inconnue ou non éditable' }, { status: 400 });
  const { ok, corrections } = await lireCorrections(locale);
  if (!ok) return NextResponse.json({ success: false, error: 'Lecture des corrections impossible (base indisponible)' }, { status: 503 });
  const { lignes, compteurs } = tableTraductions(locale, corrections);
  if (url.searchParams.get('format') === 'csv') {
    const csv = ecrireCsv(
      ['cle', 'francais', 'traduction', 'statut', 'confiance', 'source'],
      lignes.map((l) => [l.cle, l.fr, l.texte, LIBELLES_STATUT[l.statut], l.confiance, l.source]),
    );
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="traductions-${locale}.csv"` } });
  }
  return NextResponse.json({ success: true, locale, statutAffiche: localeStatus[locale], compteurs, lignes });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { locale?: unknown; cle?: unknown; texte?: unknown; valider?: unknown } | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Corps invalide' }, { status: 400 });
  const { locale, cle } = body;
  if (!langueEditable(locale)) return NextResponse.json({ success: false, error: 'Langue inconnue ou non éditable' }, { status: 400 });
  if (typeof cle !== 'string' || !(cle in frAplati)) return NextResponse.json({ success: false, error: 'Clé inconnue' }, { status: 400 });
  if (body.texte !== undefined && typeof body.texte !== 'string') return NextResponse.json({ success: false, error: 'Texte invalide' }, { status: 400 });
  if (body.valider !== undefined && typeof body.valider !== 'boolean') return NextResponse.json({ success: false, error: 'Valeur de validation invalide' }, { status: 400 });
  if (body.texte === undefined && body.valider === undefined) return NextResponse.json({ success: false, error: 'Rien à faire' }, { status: 400 });

  const lecture = await lireCorrections(locale);
  if (!lecture.ok) return NextResponse.json({ success: false, error: 'Lecture des corrections impossible : rien n’a été modifié' }, { status: 503 });
  const corrections: Corrections = { ...lecture.corrections };
  const courant = tableTraductions(locale, corrections).lignes.find((l) => l.cle === cle)!;

  const texte = body.texte !== undefined ? body.texte.trim() : courant.texte;
  if (body.texte !== undefined) {
    const refus = validerTexte(frAplati[cle], texte);
    if (refus) return NextResponse.json({ success: false, error: refus }, { status: 422 });
  }
  if (body.valider === true && !texte) return NextResponse.json({ success: false, error: 'Impossible de valider une traduction vide' }, { status: 422 });

  corrections[cle] = {
    t: texte,
    // Toute modification de texte REDEVIENT non validée, sauf si l'administrateur valide dans le même geste.
    v: body.valider === true,
    par: session!.user!.email!,
    le: new Date().toISOString(),
  };
  if (!(await ecrireCorrections(locale, corrections))) return NextResponse.json({ success: false, error: 'Échec de l’enregistrement' }, { status: 500 });
  await logAdminAction({ adminEmail: session!.user!.email!, action: 'i18n_correction', targetType: 'traduction', targetId: `${locale}:${cle}`, details: { valider: body.valider ?? null, retrait: texte === '' } });
  const { lignes, compteurs } = tableTraductions(locale, corrections);
  return NextResponse.json({ success: true, ligne: lignes.find((l) => l.cle === cle), compteurs });
}
