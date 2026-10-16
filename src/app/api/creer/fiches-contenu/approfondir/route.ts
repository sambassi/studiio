import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lancerAnalyseIA, lireFicheV2, type StatutLancement } from '@/lib/creer/analyse-ia-rush';

/**
 * M2-b — Analyse visuelle + transcription d'UN rush personnel.
 *
 * `POST /api/creer/fiches-contenu/approfondir` `{ url }` : déclenchement
 * EXPLICITE (jamais automatique, jamais sur les anciennes vidéos), réservé à
 * un administrateur qui a CONSENTI, sur un rush de SON compte (session). La
 * réponse n'attend jamais le fournisseur : l'analyse tourne en tâche de fond.
 *
 * `GET ?url=` : relit la fiche v2 en cache — AUCUN appel fournisseur.
 *
 * Interrupteurs éteints, compte non admin, consentement absent ou révoqué,
 * rush d'un autre compte : rien n'est lu, rien n'est envoyé.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HTTP: Record<StatutLancement, number> = {
  lance: 202, deja_en_cours: 202, en_cache: 200,
  occupe: 429, eteint: 404, config_invalide: 503,
  non_admin: 403, sans_consentement: 403, refuse: 404,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const corps = await req.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof corps?.url === 'string' && corps.url.length <= 2048 ? corps.url : '';
  if (!url) return NextResponse.json({ success: false, statut: 'refuse' }, { status: 400 });
  const r = await lancerAnalyseIA(url, userId, session?.user?.email);
  // ⚠️ JAMAIS attendue : la création et l'export ne dépendent pas de l'IA.
  if (r.tache) void r.tache;
  const corpsReponse = { success: r.statut === 'lance' || r.statut === 'en_cache' || r.statut === 'deja_en_cours', statut: r.statut, ...(r.fiche ? { fiche: r.fiche } : {}) };
  const entetes = r.statut === 'occupe' ? { 'Retry-After': '120' } : undefined;
  return NextResponse.json(corpsReponse, { status: HTTP[r.statut], headers: entetes });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url).searchParams.get('url') ?? '';
  if (!url || url.length > 2048) return NextResponse.json({ success: true, fiche: null });
  const fiche = await lireFicheV2(url, userId).catch(() => null);
  return NextResponse.json({ success: true, fiche });
}
