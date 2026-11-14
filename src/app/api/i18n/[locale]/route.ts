import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { langueEditable, lireCorrections, propositionsDe } from '@/lib/i18n/stockage';
import { textesDesCorrections } from '@/lib/i18n/traductions';

/**
 * Corrections de traductions d'une langue, lues par le navigateur au changement de langue.
 * PUBLIC (les textes d'interface le sont déjà) : ne renvoie que `{ clé: texte }` — ni auteur,
 * ni statut de validation. Ne peut JAMAIS casser l'application : sur toute panne, aucune
 * correction n'est renvoyée et le catalogue livré avec le code s'applique.
 */
export const dynamic = 'force-dynamic';

const MEMO_MS = 20_000;
const memo = new Map<string, { a: number; c: Record<string, string> }>();

export async function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  const locale = params.locale;
  if (!langueEditable(locale)) return NextResponse.json({ corrections: {} }, { status: 404 });
  // APERÇU des propositions IA : réservé aux administrateurs (jamais en cache, jamais pour un visiteur).
  // Les corrections de l'administration (approuvées ou non) priment sur les propositions.
  if (new URL(req.url).searchParams.get('apercu') === '1') {
    const { error } = await requireAdmin();
    if (!error) {
      const { ok, corrections } = await lireCorrections(locale);
      const c = { ...propositionsDe(locale), ...(ok ? textesDesCorrections(corrections) : {}) };
      return NextResponse.json({ corrections: c, apercu: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
  }
  const m = memo.get(locale);
  if (m && Date.now() - m.a < MEMO_MS) {
    return NextResponse.json({ corrections: m.c }, { headers: { 'Cache-Control': 'public, max-age=20, stale-while-revalidate=120' } });
  }
  const { ok, corrections } = await lireCorrections(locale);
  if (!ok) return NextResponse.json({ corrections: {} }, { headers: { 'Cache-Control': 'no-store' } });
  const c = textesDesCorrections(corrections);
  memo.set(locale, { a: Date.now(), c });
  return NextResponse.json({ corrections: c }, { headers: { 'Cache-Control': 'public, max-age=20, stale-while-revalidate=120' } });
}

/** Pour les tests et pour l'administration : une écriture invalide le cache de cette instance. */
export function viderMemo(locale?: string) { if (locale) memo.delete(locale); else memo.clear(); }
