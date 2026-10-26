/**
 * CINEMA IA — importer l'image de reference d'un personnage.
 *
 * Octets seulement, jamais une URL. Image uniquement (jpg, png, webp), 10 Mo
 * au plus, contenu reconnu par ses octets AVANT toute ecriture. Elle devient
 * une VERSION de plus de la reference du personnage (jamais un ecrasement) et
 * vit dans le stockage prive du compte.
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { contexteCinema } from '@/lib/cinema/contexte';
import { filmInconnu, sessionCinema } from '@/lib/cinema/routes-aide';
import { extensionAcceptee, signatureConnue } from '@/lib/cinema/medias';
import { ajouterReference, referenceActive } from '@/lib/cinema/personnages';
import { cleReference } from '@/lib/cinema/stockage/cles';
import { modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAILLE_MAX_REFERENCE = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await sessionCinema();
  if ('refus' in s) return s.refus;
  const ctx = contexteCinema();
  const lu = await ctx.films.lire(params.id, s.userId);
  if (!lu) return filmInconnu();

  const annonce = req.headers.get('content-length');
  const octets = annonce === null ? null : Number(annonce);
  if (octets === null || !Number.isFinite(octets)) return NextResponse.json({ ok: false, erreur: 'taille du corps non annoncee' }, { status: 411 });
  if (octets > TAILLE_MAX_REFERENCE + 64 * 1024) return NextResponse.json({ ok: false, erreur: 'image trop volumineuse (10 Mo maximum)' }, { status: 413 });

  let formulaire: FormData;
  try { formulaire = await req.formData(); }
  catch { return NextResponse.json({ ok: false, erreur: 'corps multipart attendu' }, { status: 400 }); }
  const personnageId = formulaire.get('personnageId');
  const fichier = formulaire.get('fichier');
  if (typeof personnageId !== 'string' || !(fichier instanceof File)) {
    return NextResponse.json({ ok: false, erreur: 'personnageId et fichier sont requis' }, { status: 400 });
  }
  if (!lu.film.personnages.some((p) => p.id === personnageId)) {
    return NextResponse.json({ ok: false, erreur: 'personnage inconnu' }, { status: 404 });
  }
  if (fichier.size === 0 || fichier.size > TAILLE_MAX_REFERENCE) {
    return NextResponse.json({ ok: false, erreur: 'image vide ou trop volumineuse (10 Mo maximum)' }, { status: 413 });
  }

  const ext = extensionAcceptee(path.basename(fichier.name || 'reference'));
  if (!ext.ok || ext.genre !== 'image') return NextResponse.json({ ok: false, erreur: 'extension refusee (jpg, png, webp)' }, { status: 400 });
  const donnees = new Uint8Array(await fichier.arrayBuffer());
  // Le contenu doit etre ce qu'il pretend : une « image » qui n'en est pas n'est jamais ecrite.
  if (signatureConnue(donnees) !== 'image') return NextResponse.json({ ok: false, erreur: 'contenu non reconnu : ce n\'est pas une image' }, { status: 400 });

  const logique = `cinema/${lu.film.id}/references/${personnageId}-${randomBytes(4).toString('hex')}${ext.ext}`;
  const cle = cleReference(s.userId, lu.film.id, logique);
  if (!cle) return NextResponse.json({ ok: false, erreur: 'chemin de reference refuse' }, { status: 400 });
  await ctx.objets.deposerOctets(cle, donnees, typeContenuDepuisCle(cle));

  const film = await modifierFilm(ctx.films, params.id, s.userId, (f) => ({
    ...f,
    personnages: f.personnages.map((p) => p.id !== personnageId ? p : ajouterReference(p, {
      description: referenceActive(p)?.description, urlImage: logique,
    })),
  })).catch(() => null);
  if (!film) {
    await ctx.objets.supprimer(cle).catch(() => {});
    return NextResponse.json({ ok: false, erreur: 'film modifie en parallele, reessayez' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, film });
}
