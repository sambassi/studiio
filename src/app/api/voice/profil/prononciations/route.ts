/**
 * PUT /api/voice/profil/prononciations — la liste complète, validée entrée
 * par entrée (vide, trop long, identique, doublon, trop nombreuses → 400,
 * rien n'est enregistré). Le texte source des scripts n'est jamais touché :
 * seules ces paires (affiché → prononcé) sont stockées.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { enregistrerPrononciations } from '@/lib/voice/profil';
import { ajouterPrononciation, MESSAGES_PRONONCIATION, type Prononciation } from '@/lib/voice/prononciations';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let corps: { prononciations?: unknown } = {};
  try { corps = (await req.json()) ?? {}; } catch { corps = {}; }
  if (!Array.isArray(corps.prononciations)) {
    return NextResponse.json({ success: false, error: 'Liste de prononciations manquante.' }, { status: 400 });
  }
  // Validation STRICTE : chaque entrée est ajoutée à une liste vide avec les
  // mêmes règles que l'écran ; le premier refus arrête tout.
  let liste: Prononciation[] = [];
  for (let i = 0; i < corps.prononciations.length; i += 1) {
    const r = ajouterPrononciation(liste, corps.prononciations[i]);
    if (!r.ok) {
      const motif = r.motif === 'introuvable' ? 'vide' : r.motif;
      return NextResponse.json({ success: false, error: MESSAGES_PRONONCIATION[motif], code: motif, index: i }, { status: 400 });
    }
    liste = r.liste;
  }
  const r = await enregistrerPrononciations(session.user.id, liste);
  if (!r.ok) {
    console.error('[Voice][profil] prononciations non enregistrées :', r.erreur);
    return NextResponse.json({ success: false, error: 'Vos prononciations n’ont pas pu être enregistrées.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { prononciations: r.profil.prononciations } });
}
