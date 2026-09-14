import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  lireLutAsset, AVERTISSEMENT_COLORIMETRIE, MESSAGES_IMPORT_LUT, type MotifImportLut,
} from '@/lib/luts/import-utilisateur';
import { cleLutAsset, nomLutValide, nomParDefaut, LUTS_MAX } from '@/lib/luts/bibliotheque';
import { listerLuts, ajouterLut, type MotifStore } from '@/lib/luts/store';
import { MAX_LUT_BYTES, type OrigineLut } from '@/lib/luts/types';
import { BUCKET_NAMESPACE_LUT } from '@/lib/storage/acces-objet';

/**
 * A2 — LA BIBLIOTHÈQUE DE LUT DU COMPTE : lister, importer.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE FAIT, ET CE QU'ELLE NE FAIT PAS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ELLE FAIT : recevoir des octets, les mesurer avec le socle A1 (l'autorité),
 * les canonicaliser, calculer leur empreinte, ranger l'objet dans le
 * namespace PRIVÉ du compte, et écrire une fiche — dédoublonnée et plafonnée
 * PAR LA BASE, atomiquement.
 *
 * ELLE NE FAIT PAS : appliquer la LUT, en produire un aperçu, la proposer à
 * un montage. Ce sont les lots suivants.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ LE CLIENT N'ÉCRIT NI LA CLÉ NI LE COMPTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le compte vient de la session. La clé est faite ici, de l'empreinte des
 * octets canoniques — pas du nom de fichier. `../../etc/passwd.cube` n'est
 * qu'un libellé à nettoyer, jamais un chemin à atteindre. La base vérifie la
 * même chose de son côté (`lut_assets_cle_du_compte`).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ OBJET PUIS FICHE — et ce que ça implique
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le stockage et PostgreSQL ne partagent pas de transaction. L'objet est
 * écrit AVANT la fiche : une fiche sans objet serait un lien mort servi à
 * l'utilisateur ; un objet sans fiche est un orphelin PRIVÉ, inaccessible
 * (le relais public refuse le namespace), de quelques kilo-octets, que
 * personne d'autre ne peut désigner. Même empreinte = même clé = `upsert`
 * idempotent : deux imports simultanés des mêmes octets écrivent le même
 * objet, et aucun ne supprime celui de l'autre — on ne supprime JAMAIS ici.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Un `.cube` de 8 Mio arrive vite ; la canonicalisation prend un instant. */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const MESSAGE: Record<string, string> = {
  ...MESSAGES_IMPORT_LUT,
  bibliotheque_pleine:
    `Votre bibliothèque contient déjà ${LUTS_MAX} LUT. Supprimez-en une pour en importer une autre.`,
  ecriture_impossible: 'Votre LUT n’a pas pu être enregistrée. Réessayez.',
  socle_absent: 'La bibliothèque de LUT n’est pas encore disponible sur ce serveur.',
};

const refus = (
  motif: MotifImportLut | MotifStore | 'bibliotheque_pleine', statut: number,
) => NextResponse.json({ ok: false, motif, error: MESSAGE[motif] }, { status: statut, headers: NO_STORE });

const ORIGINES: readonly OrigineLut[] = ['cube', 'png'];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const lecture = await listerLuts(session.user.id);
  if (!lecture.ok) return refus(lecture.motif, lecture.motif === 'socle_absent' ? 503 : 500);
  return NextResponse.json(
    { ok: true, luts: lecture.valeur, limite: LUTS_MAX },
    { headers: NO_STORE },
  );
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
  /* ⚠️ LE POIDS EST REFUSÉ AVANT LA LECTURE. Charger huit mégaoctets en
     mémoire pour découvrir qu'il y en a dix serait payer le prix du refus. */
  if (fichier.size > MAX_LUT_BYTES) return refus('trop_volumineux', 413);

  const octets = Buffer.from(await fichier.arrayBuffer());
  const lecture = lireLutAsset(octets);
  if (!lecture.ok) {
    // 422 : la requête est bien formée, c'est le fichier qui ne convient pas.
    return refus(lecture.motif, lecture.motif === 'trop_volumineux' ? 413 : 422);
  }
  const { mesure } = lecture;

  // Ce que la personne a déposé. Un PNG arrive déjà canonicalisé en `.cube`
  // par le navigateur (PR B) ; le serveur ne fait que le noter.
  const origineBrute = form.get('origine');
  const origine: OrigineLut = ORIGINES.includes(origineBrute as OrigineLut)
    ? (origineBrute as OrigineLut)
    : 'cube';

  const cle = cleLutAsset(userId, mesure.empreinte);

  /* `upsert` : la même empreinte donne la même clé. Réécrire les mêmes octets
     est sans effet, et c'est ce qui rend deux imports simultanés inoffensifs. */
  const { error: erreurEnvoi } = await supabaseAdmin.storage
    .from(BUCKET_NAMESPACE_LUT)
    .upload(cle, mesure.canonique, { contentType: 'text/plain', upsert: true });
  if (erreurEnvoi) {
    console.error('[luts] Écriture de l’objet :', erreurEnvoi.message);
    return refus('ecriture_impossible', 500);
  }

  const ajout = await ajouterLut(userId, {
    empreinte: mesure.empreinte,
    cle,
    nom: nomLutValide(form.get('nom')) ?? nomParDefaut(mesure.titre, fichier.name),
    titre: mesure.titre,
    kind: mesure.kind,
    origine,
    taille: mesure.taille,
    octets: mesure.octets,
    domainMin: mesure.domainMin,
    domainMax: mesure.domainMax,
  });
  if (!ajout.ok) {
    /* ⚠️ L'OBJET RESTE — voir l'en-tête. Le supprimer ici détruirait celui
       d'un import concurrent qui vient de réussir avec les mêmes octets. */
    if (ajout.motif === 'pleine') return refus('bibliotheque_pleine', 409);
    return refus(ajout.motif, ajout.motif === 'socle_absent' ? 503 : 500);
  }

  return NextResponse.json(
    { ok: true, issue: ajout.issue, lut: ajout.lut, avertissement: AVERTISSEMENT_COLORIMETRIE },
    { status: ajout.issue === 'creee' ? 201 : 200, headers: NO_STORE },
  );
}
