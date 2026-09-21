/**
 * /api/creer/jumeau — « Utiliser mon jumeau », vu par le serveur.
 *
 * GET  : l'état (prêt / motif) pour l'étape Sujet.
 * POST : la vérification COMPLÈTE avant génération, avec les textes de la
 *        vidéo : le serveur relit avatar (version, validation, fournisseur)
 *        et voix (propriété, choix, identifiant), puis rend les textes
 *        DISPLAY intacts et SPOKEN (prononciations du compte) — et dit si
 *        le moteur vidéo du jumeau existe. Le navigateur n'apporte que son
 *        intention et ses textes ; jamais un identifiant.
 * Aucun identifiant fournisseur ne sort d'ici.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  resoudreJumeauDuCompte, scriptsDuJumeau, moteurJumeauDisponible, moteurJumeauDisponiblePour, MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE,
} from '@/lib/avatar/jumeau';

export const dynamic = 'force-dynamic';

const MAX_TEXTES = 20;
const MAX_TEXTE = 2000;

function reponse(r: Awaited<ReturnType<typeof resoudreJumeauDuCompte>>, extra: Record<string, unknown> = {}) {
  const MOTEUR_JUMEAU_DISPONIBLE = moteurJumeauDisponible();
  if (r.ok) {
    // Le moteur se juge POUR cet avatar : un avatar D-ID est « prêt » (voix
    // utilisable) mais le moteur vidéo ne sait pas encore l'animer.
    const moteur = moteurJumeauDisponiblePour(r.jumeau.avatar.fournisseur);
    return NextResponse.json({
      success: true,
      data: { pret: true, motif: null, message: null, jumeau: r.jumeau, moteurDisponible: moteur.disponible, messageMoteur: moteur.message, ...extra },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if ('motif' in r) {
    return NextResponse.json({
      success: true,
      data: { pret: false, motif: r.motif, message: r.message, jumeau: null, moteurDisponible: MOTEUR_JUMEAU_DISPONIBLE, messageMoteur: MOTEUR_JUMEAU_DISPONIBLE ? null : MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  console.error('[Creer][jumeau] lecture impossible :', r.erreur);
  return NextResponse.json({ success: false, error: 'Votre jumeau n’a pas pu être vérifié. Réessayez.' }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  return reponse(await resoudreJumeauDuCompte(session.user.id));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let textes: string[] = [];
  try {
    const corps = (await req.json()) as { textes?: unknown } | null;
    if (Array.isArray(corps?.textes)) {
      textes = corps!.textes.filter((t): t is string => typeof t === 'string').slice(0, MAX_TEXTES).map((t) => t.slice(0, MAX_TEXTE));
    }
  } catch { textes = []; }
  const r = await resoudreJumeauDuCompte(session.user.id);
  if (!r.ok) return reponse(r);
  return reponse(r, { scripts: scriptsDuJumeau(textes, r.prive.prononciations) });
}
