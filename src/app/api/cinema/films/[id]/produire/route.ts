/**
 * CINEMA IA — produire le film (voix, rendu scene par scene, recollage).
 *
 * ⚠️ RENDU SYNCHRONE, ASSUME COMME TEL. Remotion prend des minutes : cette
 * route n'est tenable qu'en local. Le passage en service exige une file de
 * travaux comme celle des rendus existants (`lib/rendus/service`,
 * `moteur-export-serveur`) — c'est une etape identifiee du dossier, pas un
 * detail d'implementation.
 *
 * `rendre: false` (defaut) s'arrete apres les voix et le montage : c'est ce
 * que l'aperçu demande, et il ne coute ni Chromium ni minutes.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { copyFile, mkdir } from 'fs/promises';
import { auth } from '@/lib/auth/config';
import { lireFilm } from '@/lib/cinema/store';
import { produireFilm } from '@/lib/cinema/atelier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });

  const racine = process.cwd();
  const film = await lireFilm(racine, params.id);
  if (!film) return NextResponse.json({ ok: false, erreur: 'film inconnu' }, { status: 404 });

  const corps = await req.json().catch(() => ({}));
  const rendre = corps?.rendre === true;
  const scenesDemandees = Array.isArray(corps?.scenes)
    ? corps.scenes.filter((s: unknown): s is string => typeof s === 'string')
    : undefined;

  try {
    const resultat = await produireFilm(film, { racine, rendre, scenesDemandees });

    // Le MP4 est rendu hors de `public/` (c'est un artefact, pas un asset) :
    // il n'est recopie que pour etre lu et telecharge depuis l'interface.
    let urlPublique: string | null = null;
    if (resultat.mp4) {
      const dossier = path.join(racine, 'public', 'cinema', film.id);
      await mkdir(dossier, { recursive: true });
      const cible = path.join(dossier, 'film.mp4');
      await copyFile(resultat.mp4.fichier, cible);
      urlPublique = `/cinema/${film.id}/film.mp4`;
    }

    return NextResponse.json({
      ok: true,
      film: resultat.film,
      montage: resultat.montage,
      devis: resultat.devis,
      voix: { moteur: resultat.voix.moteur, motifRepli: resultat.voix.motifRepli, produites: resultat.voix.details.length, echecs: resultat.voix.echecs },
      scenesRendues: resultat.scenesRendues,
      scenesReutilisees: resultat.scenesReutilisees,
      mp4: resultat.mp4 ? { ...resultat.mp4, urlPublique } : null,
      avertissements: resultat.avertissements,
    });
  } catch (e) {
    // L'echec est RENDU tel quel : un rendu qui echoue en silence coute plus
    // cher a diagnostiquer qu'un message brut.
    return NextResponse.json(
      { ok: false, erreur: e instanceof Error ? e.message : 'echec de production' },
      { status: 500 },
    );
  }
}
