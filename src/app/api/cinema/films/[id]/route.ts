/**
 * CINEMA IA — lecture et modification d'un film (scenes, repliques, casting).
 *
 * Le PATCH ne prend que ce qui a un sens d'etre modifie a la main : les
 * repliques, les durees des plans muets, l'etat d'une scene et l'association
 * des personnages. Il ne recalcule RIEN : les empreintes diront d'elles-memes
 * quelles scenes doivent etre reproduites.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireFilm, enregistrerFilm } from '@/lib/cinema/store';
import { monterFilm } from '@/lib/cinema/montage';
import { scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm } from '@/lib/cinema/couts';
import { ajouterReference } from '@/lib/cinema/personnages';
import { appartientA, mediaAccepte } from '@/lib/cinema/acces';
import type { Film } from '@/lib/cinema/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const racine = () => process.cwd();

/**
 * Le film DU COMPTE, ou 404.
 *
 * Un film qui ne lui appartient pas rend « inconnu », pas « interdit » :
 * distinguer les deux revient a confirmer l'existence d'un film d'autrui a
 * qui connait son identifiant.
 */
async function filmOuErreur(id: string, userId: string) {
  const film = await lireFilm(racine(), id);
  if (!film || !appartientA(film, userId)) {
    return { erreur: NextResponse.json({ ok: false, erreur: 'film inconnu' }, { status: 404 }) };
  }
  return { film };
}

function reponse(film: Film) {
  const aProduire = scenesAReproduire(film).map((s) => s.id);
  return NextResponse.json({
    ok: true,
    film,
    montage: monterFilm(film),
    scenesAProduire: aProduire,
    devis: devisFilm(film, aProduire),
  });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });
  const { film, erreur } = await filmOuErreur(params.id, session.user.id);
  if (erreur) return erreur;
  return reponse(film!);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, erreur: 'non autorise' }, { status: 401 });
  const { film, erreur } = await filmOuErreur(params.id, session.user.id);
  if (erreur) return erreur;

  const corps = await req.json().catch(() => null);
  let suivant = film as Film;

  // Un media REFUSE arrete la requete : l'accepter en silence laisserait
  // croire qu'il a ete pris en compte, et l'URL finirait chargee par
  // Chromium au rendu suivant.
  if (Array.isArray(corps?.plans)) {
    for (const p of corps.plans) {
      if (p?.mediaUrl !== undefined && !mediaAccepte(p.mediaUrl).ok) {
        return NextResponse.json(
          { ok: false, erreur: 'media refuse : seuls les fichiers locaux sous cinema/ sont acceptes' },
          { status: 400 },
        );
      }
    }
  }

  // Repliques et durees : plan par plan, par identifiant.
  if (Array.isArray(corps?.plans)) {
    const patchs = new Map<string, { texte?: string; dureeS?: number; mediaUrl?: string | null }>();
    for (const p of corps.plans) if (typeof p?.id === 'string') patchs.set(p.id, p);
    suivant = {
      ...suivant,
      scenes: suivant.scenes.map((scene) => ({
        ...scene,
        plans: scene.plans.map((plan) => {
          const patch = patchs.get(plan.id);
          if (!patch) return plan;
          const texte = typeof patch.texte === 'string' ? patch.texte.slice(0, 500) : null;
          return {
            ...plan,
            description: texte && !plan.dialogue ? texte : plan.description,
            dialogue: plan.dialogue && texte ? { ...plan.dialogue, texte } : plan.dialogue,
            dureeS: !plan.dialogue && Number.isFinite(patch.dureeS)
              ? Math.min(20, Math.max(0.5, Number(patch.dureeS)))
              : plan.dureeS,
            mediaUrl: patch.mediaUrl === undefined
              ? plan.mediaUrl
              : (mediaAccepte(patch.mediaUrl) as { ok: true; url: string | null }).url,
            origineMedia: patch.mediaUrl ? 'import' : plan.origineMedia,
          };
        }),
      })),
    };
  }

  // Association personnage <-> scene, et etat de la scene.
  if (Array.isArray(corps?.scenes)) {
    const patchs = new Map<string, { personnages?: string[]; etat?: string }>();
    for (const s of corps.scenes) if (typeof s?.id === 'string') patchs.set(s.id, s);
    suivant = {
      ...suivant,
      scenes: suivant.scenes.map((scene) => {
        const patch = patchs.get(scene.id);
        if (!patch) return scene;
        const connus = new Set(suivant.personnages.map((p) => p.id));
        return {
          ...scene,
          personnages: Array.isArray(patch.personnages)
            ? patch.personnages.filter((id) => connus.has(id))
            : scene.personnages,
          etat: patch.etat === 'validee' || patch.etat === 'brouillon' ? patch.etat : scene.etat,
        };
      }),
    };
  }

  // Nouvelle apparence d'un personnage : une VERSION de plus, jamais un
  // ecrasement (cf. `personnages.ts`).
  if (corps?.reference && typeof corps.reference.personnageId === 'string') {
    suivant = {
      ...suivant,
      personnages: suivant.personnages.map((p) => p.id !== corps.reference.personnageId ? p : ajouterReference(p, {
        description: typeof corps.reference.description === 'string' ? corps.reference.description.slice(0, 300) : undefined,
        urlImage: typeof corps.reference.urlImage === 'string' ? corps.reference.urlImage : null,
      })),
    };
  }

  await enregistrerFilm(racine(), suivant);
  return reponse(suivant);
}
