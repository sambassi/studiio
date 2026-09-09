import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { cheminFfprobe } from '@/lib/ffmpeg/binaires';
import {
  BUCKET_AVATAR, cleSourceAvatar, argumentsSondeAvatar, lireSondeAvatar,
  retirerSourceAvatar,
} from '@/lib/avatar/source';
import { verdictQualiteSource } from '@/lib/avatar/qualite';
import { ETAT_SOURCE_PRETE, SUJET_AVATAR, VERSION_CONSENTEMENT, TEXTE_CONSENTEMENT } from '@/lib/avatar/contrat';

/**
 * A_8c — L'INSCRIPTION D'UNE VIDEO DE REFERENCE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE FAIT, ET CE QU'ELLE NE FAIT SURTOUT PAS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ELLE FAIT : recevoir une video — filmee, importee, ou choisie dans la
 * mediatheque —, la ranger dans le namespace PRIVE de l'avatar, la mesurer
 * avec ffprobe, et n'enregistrer l'inscription que si la mesure passe.
 *
 * ELLE NE FAIT PAS : appeler un fournisseur. Aucun octet ne quitte Studiio,
 * aucun entrainement n'est lance, aucun credit n'est consomme. L'avatar
 * ressort en `source_ready` avec `provider_avatar_id` a NULL — ce qui dit
 * exactement ce qui est vrai : la source est prete, rien n'a ete envoye.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ UNE VIDEO DE LA MEDIATHEQUE EST COPIEE, PAS REFERENCEE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Ce n'est pas une preference : c'est la seule option sure. Les objets de la
 * mediatheque vivent sous `<userId>/library/…`, que le relais public SERT sans
 * session. Y laisser la source d'un clone reviendrait a rendre publique la
 * video du visage — exactement le defaut qu'A_8b a ferme.
 *
 * La copie a une seconde vertu : le cycle de vie de l'avatar ne peut jamais
 * atteindre le media d'origine. Supprimer un clone ne supprimera jamais la
 * video que la personne avait televersee.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ RIEN N'EST ECRIT EN BASE AVANT QUE LA MESURE PASSE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Une video refusee ne laisse aucune ligne derriere elle. Enregistrer d'abord
 * et corriger ensuite produirait des inscriptions a demi valides que plus rien
 * ne nettoie.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const executer = promisify(execFile);
const TIMEOUT_SONDE_MS = 30_000;

/** Ce qu'un fichier de reference peut etre. L'extension ne decide de rien. */
const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const refus = (message: string, statut = 400) => NextResponse.json(
  { success: false, error: message }, { status: statut },
);

/** La cle de mediatheque appartient-elle bien au compte, et est-ce une video ? */
function cheminMediathequeValide(chemin: unknown, userId: string): chemin is string {
  if (typeof chemin !== 'string' || chemin.length === 0) return false;
  if (chemin.includes('..') || chemin.includes('://') || chemin.includes('\\')) return false;
  /* ⚠️ LE PREFIXE EST LA PREUVE DE PROPRIETE. Le navigateur envoie un chemin ;
     il ne peut designer que ce qui commence par son propre compte. C'est la
     meme primitive que `cleAudioValide` et `cleSourceAvatarDuCompte`. */
  if (!chemin.startsWith(`${userId}/`)) return false;
  return /\.(mp4|webm|mov)$/i.test(chemin);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let form: FormData;
  try { form = await req.formData(); } catch { return refus('Requête invalide.'); }

  /* ⚠️ LE CONSENTEMENT AVANT TOUT LE RESTE. Sans lui, rien n'est televerse,
     rien n'est mesure, rien n'est ecrit : on ne manipule pas le visage de
     quelqu'un « en attendant » sa certification. */
  if (form.get('consentement') !== 'true') {
    return refus(
      'Vous devez certifier être la personne visible dans cette vidéo.',
    );
  }

  let octets: Buffer;
  let extension: string;

  const fichier = form.get('fichier');
  const cheminMediatheque = form.get('cheminMediatheque');

  if (fichier instanceof File) {
    extension = EXTENSIONS[fichier.type] ?? '';
    if (!extension) return refus('Formats acceptés : MP4, WebM ou MOV.');
    if (fichier.size <= 0) return refus('Ce fichier est vide.');
    octets = Buffer.from(await fichier.arrayBuffer());
  } else if (cheminMediathequeValide(cheminMediatheque, userId)) {
    const bucket = cheminMediatheque.startsWith(`${userId}/`) ? 'media' : 'media';
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(cheminMediatheque);
    if (error || !data) return refus('Cette vidéo est introuvable dans votre bibliothèque.', 404);
    octets = Buffer.from(await data.arrayBuffer());
    extension = (cheminMediatheque.split('.').pop() ?? 'mp4').toLowerCase();
  } else {
    return refus('Aucune vidéo fournie.');
  }

  let dossier: string | null = null;
  try {
    // ── La mesure, sur le fichier REEL ─────────────────────────────────
    //
    // ⚠️ NI L'EXTENSION NI LE TYPE MIME NE SONT CRUS. Un `.txt` renomme
    // `.mp4` arrive ici avec `video/mp4` ; c'est le decodeur qui tranche.
    dossier = await mkdtemp(join(tmpdir(), 'avatar-source-'));
    const local = join(dossier, `source.${extension}`);
    await writeFile(local, octets);

    let mesure;
    try {
      const { stdout } = await executer(cheminFfprobe(), argumentsSondeAvatar(local), {
        timeout: TIMEOUT_SONDE_MS, maxBuffer: 1024 * 1024,
      });
      mesure = lireSondeAvatar(stdout);
    } catch {
      mesure = lireSondeAvatar('');
    }

    const verdict = verdictQualiteSource(mesure);
    if (!verdict.acceptable) {
      // 422 : la requete est bien formee, c'est la video qui ne convient pas.
      return NextResponse.json(
        { success: false, verdict, mesure }, { status: 422 },
      );
    }

    // ── Le rangement, dans le namespace prive ──────────────────────────
    const cle = cleSourceAvatar(userId, extension, Date.now());
    const { error: erreurEnvoi } = await supabaseAdmin.storage
      .from(BUCKET_AVATAR)
      .upload(cle, octets, { contentType: fichier instanceof File ? fichier.type : `video/${extension}`, upsert: true });
    if (erreurEnvoi) {
      return refus('Votre vidéo n’a pas pu être enregistrée. Réessayez.', 500);
    }

    /* ── L'inscription ──────────────────────────────────────────────────
       Une identite principale : la precedente inscription est remplacee.
       ⚠️ MAIS LES GENERATIONS SURVIVENT — la cle etrangere est `set null`
       depuis A_8b, precisement pour que refaire sa source n'efface pas les
       videos deja produites. */
    /* ⚠️ L'ANCIENNE SOURCE EST RELUE AVANT D'ETRE OUBLIEE — A_8e. Sans cela,
       remplacer sa video laissait le fichier precedent dans le stockage : pas
       une fuite (le namespace est prive), mais un orphelin que plus rien ne
       designait et que personne ne pouvait retrouver. */
    const { data: precedents } = await supabaseAdmin
      .from('user_avatars')
      .select('source_object_key')
      .eq('user_id', userId);
    const anciennesCles = (precedents ?? [])
      .map((p) => (p as { source_object_key?: unknown }).source_object_key);

    await supabaseAdmin.from('user_avatars').delete().eq('user_id', userId);

    const { data: ligne, error: erreurInsert } = await supabaseAdmin
      .from('user_avatars')
      .insert({
        user_id: userId,
        provider: 'heygen',
        avatar_type: 'video',
        /* ⚠️ NULL, ET C'EST LE SENS MEME DE CE LOT. Aucun avatar n'existe chez
           le fournisseur ; y ecrire un identifiant invente ferait mentir la
           donnee et lancerait des interrogations vers une ressource absente. */
        provider_avatar_id: null,
        name: 'Mon clone vidéo',
        status: ETAT_SOURCE_PRETE,
        source_object_key: cle,
        subject_type: SUJET_AVATAR,
        consent_at: new Date().toISOString(),
        consent_text: TEXTE_CONSENTEMENT,
        consent_version: VERSION_CONSENTEMENT,
      })
      .select()
      .single();

    if (erreurInsert) {
      return refus('Votre vidéo a été enregistrée mais l’inscription a échoué. Réessayez.', 500);
    }

    /* ⚠️ LE NETTOYAGE VIENT APRES LE SUCCES, JAMAIS AVANT. Si l'insertion
       avait echoue, on serait sorti plus haut — et l'ancienne source serait
       restee, intacte, seule reference encore valable. Supprimer d'abord
       aurait laisse un compte sans aucune video en cas d'echec. */
    for (const ancienne of anciennesCles) {
      await retirerSourceAvatar(userId, ancienne, cle);
    }

    return NextResponse.json({ success: true, avatar: ligne, verdict, mesure });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin serveur.
    return refus('Votre vidéo n’a pas pu être analysée.', 500);
  } finally {
    if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}
