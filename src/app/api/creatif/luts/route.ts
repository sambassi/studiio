import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  lireLutUtilisateur, nomParDefaut, AVERTISSEMENT_COLORIMETRIE,
  MESSAGES_IMPORT_LUT, type MotifImportLut,
} from '@/lib/luts/import-utilisateur';
import {
  cleLutUtilisateur, nomLutValide, lutParEmpreinte,
  LUTS_UTILISATEUR_MAX, OCTETS_LUT_MAX, type LutUtilisateur,
} from '@/lib/creatif/lut-utilisateur';
import {
  lireBibliothequeUtilisateur, ajouterLutUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';
import { BUCKET_NAMESPACE_LUT } from '@/lib/storage/acces-objet';

/**
 * A_9b — IMPORTER SON PROPRE LOOK.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE FAIT, ET CE QU'ELLE NE FAIT SURTOUT PAS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ELLE FAIT : recevoir des octets, les mesurer, refuser ce qui n'est pas une
 * LUT 3D, calculer leur empreinte, ranger le fichier dans le namespace PRIVE
 * du compte, et ecrire une fiche dans son catalogue — sans jamais perdre une
 * fiche voisine ecrite au meme instant.
 *
 * ELLE NE FAIT PAS : appliquer la LUT, en produire un apercu, la proposer a
 * l'Autopilote. Le rendu et l'apercu appartiennent aux lots suivants, et une
 * LUT qui apparaitrait dans les rendus avant d'avoir ete regardee une fois
 * serait une surprise, pas une fonctionnalite.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ LE CLIENT N'ECRIT NI LA CLE NI LE COMPTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le compte vient de la session. La cle est faite ici, de l'empreinte des
 * octets — pas du nom de fichier. `../../etc/passwd.cube` n'est donc qu'un
 * libelle a nettoyer, jamais un chemin a atteindre.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Un `.cube` de 4 Mio arrive vite ; le decodage, lui, prend un instant. */
export const maxDuration = 60;

const MESSAGE: Record<string, string> = {
  ...MESSAGES_IMPORT_LUT,
  bibliotheque_pleine:
    `Votre bibliothèque contient déjà ${LUTS_UTILISATEUR_MAX} LUT. Supprimez-en une pour en importer une autre.`,
  ecriture_impossible: 'Votre LUT n’a pas pu être enregistrée. Réessayez.',
};

const refus = (
  motif: MotifImportLut | 'bibliotheque_pleine' | 'ecriture_impossible', statut: number,
) => NextResponse.json({ ok: false, motif, error: MESSAGE[motif] }, { status: statut });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const biblio = await lireBibliothequeUtilisateur(session.user.id);
  return NextResponse.json({ ok: true, luts: biblio.luts, limite: LUTS_UTILISATEUR_MAX });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 });
  }

  const fichier = form.get('fichier');
  if (!(fichier instanceof File)) return refus('fichier_absent', 400);
  /* ⚠️ LE POIDS EST REFUSE AVANT LA LECTURE. Charger quatre megaoctets en
     memoire pour decouvrir qu'il y en a six serait payer le prix du refus. */
  if (fichier.size > OCTETS_LUT_MAX) return refus('trop_volumineux', 413);

  const octets = Buffer.from(await fichier.arrayBuffer());
  const lecture = lireLutUtilisateur(octets);
  if (!lecture.ok) {
    // 422 : la requete est bien formee, c'est le fichier qui ne convient pas.
    const statut = lecture.motif === 'trop_volumineux' ? 413 : 422;
    return refus(lecture.motif, statut);
  }
  const { mesure } = lecture;

  /* ⚠️ LE DOUBLON EST TRANCHE AVANT TOUT ENVOI. Deux noms pour les memes
     octets sont LA MEME LUT : reteleverser produirait un second objet
     identique, et la fiche existante garderait le nom que la personne lui a
     donne — ce qui est voulu, le renommage viendra avec son propre geste. */
  const biblio = await lireBibliothequeUtilisateur(userId);
  const dejaLa = lutParEmpreinte(biblio.luts, mesure.empreinte);
  if (dejaLa) {
    return NextResponse.json({
      ok: true, issue: 'existante', lut: dejaLa,
      avertissement: AVERTISSEMENT_COLORIMETRIE,
    });
  }
  if (biblio.luts.length >= LUTS_UTILISATEUR_MAX) return refus('bibliotheque_pleine', 409);

  const cle = cleLutUtilisateur(userId, mesure.empreinte);
  /* `upsert` : la meme empreinte donne la meme cle. Reecrire les memes octets
     est sans effet, et c'est ce qui rend deux imports simultanes inoffensifs. */
  const { error: erreurEnvoi } = await supabaseAdmin.storage
    .from(BUCKET_NAMESPACE_LUT)
    .upload(cle, octets, { contentType: 'text/plain', upsert: true });
  if (erreurEnvoi) return refus('ecriture_impossible', 500);

  const lut: LutUtilisateur = {
    empreinte: mesure.empreinte,
    cle,
    nom: nomLutValide(form.get('nom')) ?? nomParDefaut(mesure.titre, fichier.name),
    titre: mesure.titre,
    octets: mesure.octets,
    taille: mesure.taille,
    domainMin: mesure.domainMin,
    domainMax: mesure.domainMax,
    importeeLe: new Date().toISOString(),
  };

  const ecriture = await ajouterLutUtilisateur(userId, lut, LUTS_UTILISATEUR_MAX);
  if (!ecriture.ok) {
    /* ⚠️ L'OBJET RESTE. Il porte le nom de son empreinte : personne d'autre ne
       peut le designer, il ne coute que quelques kilo-octets, et le supprimer
       ici detruirait celui d'un import concurrent qui vient de reussir avec les
       memes octets. Un orphelin silencieux vaut mieux qu'une suppression
       croisee. */
    return refus(
      ecriture.motif === 'pleine' ? 'bibliotheque_pleine' : 'ecriture_impossible',
      ecriture.motif === 'pleine' ? 409 : 500,
    );
  }

  return NextResponse.json({
    ok: true,
    issue: ecriture.issue,
    lut: lutParEmpreinte(ecriture.luts, mesure.empreinte) ?? lut,
    avertissement: AVERTISSEMENT_COLORIMETRIE,
  });
}
