import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { empreinteValide, nomLutValide } from '@/lib/luts/bibliotheque';
import { lutDuCompte, renommerLut, supprimerLut, type MotifStore } from '@/lib/luts/store';
import { BUCKET_NAMESPACE_LUT } from '@/lib/storage/acces-objet';
import { lecteurMinio } from '@/lib/storage/minio-client';

/**
 * A2 — UNE LUT DU COMPTE : lire ses octets, la renommer, la supprimer.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ 404 POUR AUTRUI, JAMAIS 403
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Inconnue ou appartenant à un autre compte : même réponse. Un 403
 * confirmerait qu'une LUT existe sous cette empreinte chez quelqu'un d'autre.
 * Le store filtre TOUJOURS par `user_id` ; cette route n'a donc jamais en
 * main une fiche qui ne soit pas au compte.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ C'EST LE SEUL ACCÈS AUX OCTETS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le relais public refuse le namespace `lut` (A1). L'aperçu et le compositeur
 * liront la LUT par cette route, authentifiée, `no-store`. Aucune URL de
 * stockage ne sort d'ici.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ SUPPRESSION : LA FICHE D'ABORD, L'OBJET ENSUITE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * L'ordre inverse laisserait une fiche qui pointe sur rien — un lien mort
 * servi à l'utilisateur. Dans cet ordre, l'échec de la suppression de l'objet
 * ne laisse qu'un orphelin privé, inaccessible, journalisé. Et la clé est
 * celle de LA fiche du compte : aucune suppression croisée n'est possible.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const MESSAGE: Record<MotifStore, string> = {
  socle_absent: 'La bibliothèque de LUT n’est pas encore disponible sur ce serveur.',
  ecriture_impossible: 'Une erreur interne est survenue.',
};

const introuvable = () =>
  NextResponse.json({ ok: false, error: 'LUT introuvable' }, { status: 404, headers: NO_STORE });

const panne = (motif: MotifStore) =>
  NextResponse.json(
    { ok: false, motif, error: MESSAGE[motif] },
    { status: motif === 'socle_absent' ? 503 : 500, headers: NO_STORE },
  );

const nonAuth = () => NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

const empreinteInvalide = () =>
  NextResponse.json(
    { ok: false, error: 'Empreinte invalide.', motif: 'empreinte_invalide' },
    { status: 422, headers: NO_STORE },
  );

type Ctx = { params: { empreinte: string } | Promise<{ empreinte: string }> };

/** Nom de fichier proposé au téléchargement — jamais de guillemet ni de retour à la ligne. */
function nomDeFichier(nom: string): string {
  const propre = nom.replace(/["\\\r\n\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'look';
  return `${propre}.cube`;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return nonAuth();
  const { empreinte } = await ctx.params;
  if (!empreinteValide(empreinte)) return empreinteInvalide();

  const lecture = await lutDuCompte(session.user.id, empreinte);
  if (!lecture.ok) return panne(lecture.motif);
  const lut = lecture.valeur;
  if (!lut) return introuvable();

  let flux: NodeJS.ReadableStream;
  try {
    flux = await lecteurMinio().getObject(BUCKET_NAMESPACE_LUT, lut.cle);
  } catch (e: unknown) {
    // La fiche existe, l'objet manque : journalisé, et « introuvable » pour
    // l'appelant — il n'y a rien de plus à lui dire.
    console.error('[luts] Objet illisible :', lut.cle, e instanceof Error ? e.message : e);
    return introuvable();
  }

  return new NextResponse(Readable.toWeb(Readable.from(flux)) as ReadableStream, {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(lut.octets),
      'Content-Disposition': `attachment; filename="${nomDeFichier(lut.nom)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return nonAuth();
  const { empreinte } = await ctx.params;
  if (!empreinteValide(empreinte)) return empreinteInvalide();

  let corps: unknown;
  try { corps = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 });
  }
  const nom = nomLutValide((corps as { nom?: unknown } | null)?.nom);
  if (nom === null) {
    return NextResponse.json(
      { ok: false, error: 'Le nom ne peut pas être vide.', motif: 'nom_invalide' },
      { status: 422, headers: NO_STORE },
    );
  }

  const ecriture = await renommerLut(session.user.id, empreinte, nom);
  if (!ecriture.ok) return panne(ecriture.motif);
  if (!ecriture.valeur) return introuvable();
  return NextResponse.json({ ok: true, lut: ecriture.valeur }, { headers: NO_STORE });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return nonAuth();
  const { empreinte } = await ctx.params;
  if (!empreinteValide(empreinte)) return empreinteInvalide();

  const suppression = await supprimerLut(session.user.id, empreinte);
  if (!suppression.ok) return panne(suppression.motif);
  const lut = suppression.valeur;
  if (!lut) return introuvable();

  // L'objet ensuite, en meilleur effort. La clé vient de LA fiche du compte
  // que la base vient de supprimer — jamais de la requête.
  const { error } = await supabaseAdmin.storage.from(BUCKET_NAMESPACE_LUT).remove([lut.cle]);
  if (error) {
    console.warn('[luts] Fiche supprimée, objet orphelin conservé :', lut.cle, error.message);
  }

  return NextResponse.json({ ok: true, empreinte }, { headers: NO_STORE });
}
