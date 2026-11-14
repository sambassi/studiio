import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { ecrireCorrections, frAplati, langueEditable, lireCorrections, tableTraductions } from '@/lib/i18n/stockage';
import { validerTexte, type Corrections } from '@/lib/i18n/traductions';
import { colonnes, lireCsv } from '@/lib/i18n/csv';

/**
 * Import d'un CSV de traductions (colonnes `cle` et `traduction`, `;` ou `,`) — sans toucher au code.
 *  - une cellule `traduction` VIDE est IGNORÉE (un export contient aussi les textes non traduits :
 *    le réimporter ne doit rien effacer) ; le retrait se fait entrée par entrée dans l'interface ;
 *  - un texte identique à l'actuel est compté « inchangé » ;
 *  - `validees` : le fichier vient d'un relecteur natif → les entrées importées sont marquées validées ;
 *  - une ligne refusée (clé inconnue, variables {x} différentes, balises, trop long) n'arrête pas l'import.
 */
export const dynamic = 'force-dynamic';

const MAX_OCTETS = 2 * 1024 * 1024;
const MAX_LIGNES = 8000;

export async function POST(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { locale?: unknown; csv?: unknown; validees?: unknown } | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'Corps invalide' }, { status: 400 });
  if (!langueEditable(body.locale)) return NextResponse.json({ success: false, error: 'Langue inconnue ou non éditable' }, { status: 400 });
  if (typeof body.csv !== 'string' || !body.csv.trim()) return NextResponse.json({ success: false, error: 'Fichier CSV vide' }, { status: 400 });
  if (body.csv.length > MAX_OCTETS) return NextResponse.json({ success: false, error: 'Fichier trop volumineux (2 Mo maximum)' }, { status: 413 });
  const locale = body.locale;
  const validees = body.validees === true;

  const rows = lireCsv(body.csv);
  const col = rows.length ? colonnes(rows[0]) : null;
  if (!col) return NextResponse.json({ success: false, error: 'En-tête attendu : au minimum les colonnes « cle » et « traduction »' }, { status: 422 });
  if (rows.length - 1 > MAX_LIGNES) return NextResponse.json({ success: false, error: `Trop de lignes (${MAX_LIGNES} maximum)` }, { status: 413 });

  const lecture = await lireCorrections(locale);
  if (!lecture.ok) return NextResponse.json({ success: false, error: 'Lecture des corrections impossible : rien n’a été importé' }, { status: 503 });
  const corrections: Corrections = { ...lecture.corrections };
  const actuel = new Map(tableTraductions(locale, corrections).lignes.map((l) => [l.cle, l]));

  const rapport = { importees: 0, inchangees: 0, vides: 0, refusees: [] as Array<{ cle: string; raison: string }>, refuseesTotal: 0 };
  const maintenant = new Date().toISOString();
  for (const r of rows.slice(1)) {
    const cle = (r[col.cle] || '').trim();
    const texte = (r[col.traduction] || '').trim();
    if (!cle) continue;
    const refuser = (raison: string) => { rapport.refuseesTotal += 1; if (rapport.refusees.length < 100) rapport.refusees.push({ cle, raison }); };
    if (!(cle in frAplati)) { refuser('Clé inconnue'); continue; }
    if (!texte) { rapport.vides += 1; continue; }
    const refus = validerTexte(frAplati[cle], texte);
    if (refus) { refuser(refus); continue; }
    const ligne = actuel.get(cle)!;
    if (ligne.texte === texte && (!validees || ligne.statut === 'validee')) { rapport.inchangees += 1; continue; }
    corrections[cle] = { t: texte, v: validees, par: session!.user!.email!, le: maintenant };
    rapport.importees += 1;
  }

  if (rapport.importees > 0 && !(await ecrireCorrections(locale, corrections))) {
    return NextResponse.json({ success: false, error: 'Échec de l’enregistrement : rien n’a été importé' }, { status: 500 });
  }
  await logAdminAction({ adminEmail: session!.user!.email!, action: 'i18n_import_csv', targetType: 'traduction', targetId: locale, details: { importees: rapport.importees, refusees: rapport.refuseesTotal, validees } });
  return NextResponse.json({ success: true, rapport, compteurs: tableTraductions(locale, corrections).compteurs });
}
