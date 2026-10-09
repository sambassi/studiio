import { NextRequest, NextResponse } from 'next/server';
import { prendreVerrouSource, libererVerrouSource } from '@/lib/avatar/verrou-traitement';
import { MESSAGES_CREATION, jumeauVideoAutorise } from '@/lib/avatar/fournisseurs';
import { isAdmin } from '@/lib/admin';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  uploadAsset,
  createAvatarFromAsset,
  getAvatarTrainingStatus,
  listVoices,
  pickDefaultVoice,
  HeyGenError,
  HEYGEN_ASSET_MAX_BYTES,
  type AvatarKind,
} from '@/lib/avatar/heygen';
import { CONSENTEMENT_ENROLEMENT, CONSENTEMENT_ENROLEMENT_DID, ETAT_SOURCE_PRETE, SUJET_AVATAR, etatAvatar } from '@/lib/avatar/contrat';
import {
  BUCKET_AVATAR, cleSourceAvatar, retirerSourceAvatar,
} from '@/lib/avatar/source';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { listerIdentites, identitesVideoAvecGroupe, emplacementsVideo } from '@/lib/avatar/versions';
import { lancerVersionCandidate } from '@/lib/avatar/remplacement';
import { versionPublique } from '@/lib/avatar/actions-version';
import { cleSourceAvatarDuCompte, sourceAvatarPresente } from '@/lib/avatar/source';
import { didVideoAvatarDisponible } from '@/lib/providers/did/client';
import {
  FOURNISSEUR_DID, TYPES_VIDEO_DID, MAX_VIDEO_SOURCE_DID_OCTETS, DUREE_VALIDITE_CONSENTEMENT_MS, etapeDid, rafraichirEntrainementDid,
  type AvatarDid,
} from '@/lib/avatar/did';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Formats video. MP4 et WebM sont les seuls documentes comme supportes par
 * HeyGen ; QuickTime (.mov) est accepte ici et transmis tel quel — si HeyGen
 * le refuse, son message reel remonte desormais jusqu'a l'utilisateur.
 */
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/**
 * Textes de consentement stockes avec l'avatar — preuve datee. Les textes
 * vivent dans le contrat (`CONSENTEMENT_ENROLEMENT`), mot pour mot ceux
 * d'origine, avec la version que `consent_version` enregistre.
 */
const CONSENT_TEXT: Record<AvatarKind, string> = CONSENTEMENT_ENROLEMENT.textes;

/**
 * La ligne rendue a la page, sans `source_url` (la source se lit par
 * `/api/avatar/source`) ni les identifiants du consentement fournisseur et de
 * sa video (`provider_consent_id`, `consent_object_key`) — et, pour un avatar
 * D-ID, sans les identifiants fournisseur : ils restent cote serveur. La page
 * recoit l'ETAPE derivee (`etape_did`) et la phrase de consentement, rien d'autre.
 */
function sansSourceUrl(avatar: Record<string, unknown>): Record<string, unknown> {
  const {
    source_url: _sourceUrl, provider_consent_id: _consentId, consent_object_key: _consentKey, ...reste
  } = avatar;
  void _sourceUrl; void _consentId; void _consentKey;
  // L'identifiant de GROUPE fournisseur ne sort jamais vers l'écran.
  delete reste.provider_group_id;
  if (reste.provider === FOURNISSEUR_DID) {
    const { provider_avatar_id: _pa, provider_asset_id: _ps, provider_consent_created_at: creeLe, provider_consent_version: _pcv, ...sansIds } = reste;
    void _pa; void _ps; void _pcv;
    // La fin de validité de la phrase (30 min, D-ID), calculée ici : l'écran n'a pas à
    // connaître la règle. Elle ne concerne que le DÉFI : un consentement validé ne périme pas.
    const t = typeof creeLe === 'string' && reste.provider_consent_status !== 'done' ? new Date(creeLe).getTime() : NaN;
    const consent_expire_le = Number.isFinite(t) ? new Date(t + DUREE_VALIDITE_CONSENTEMENT_MS).toISOString() : null;
    return { ...sansIds, etape_did: etapeDid(avatar as unknown as AvatarDid), consent_expire_le };
  }
  return reste;
}

/** Statuts HeyGen consideres comme « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

/** Ce que les routes lisent d'un avatar vivant. */
interface AvatarVivant {
  id: string;
  version: number;
  source_object_key: string | null;
  source_url: string | null;
  status: string;
  provider_avatar_id: string | null;
  provider_asset_id: string | null;
  training_error: string | null;
  [colonne: string]: unknown;
}

/**
 * L'avatar VIVANT du compte — ou la preuve qu'on ne sait pas.
 *
 * ⚠️ Une erreur de lecture n'est PAS « aucun avatar » : sur cette confusion,
 * le POST enverrait une source, insererait, appellerait le fournisseur —
 * pour un compte qui a peut-etre deja tout cela. On rend donc DEUX choses
 * distinctes : `null` (lu, rien), et `ok: false` (pas lu).
 */
async function lireAvatarVivant(
  userId: string,
): Promise<{ ok: true; avatar: AvatarVivant | null } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, erreur: error.message };
  // L'avatar PAR DÉFAUT (plusieurs identités possibles), sinon le plus ancien.
  const lignes = (data ?? []) as AvatarVivant[];
  return { ok: true, avatar: lignes.find((l) => l.is_default === true) ?? lignes[0] ?? null };
}

const estCetteVersionDid = (v: AvatarVivant | null, avatarId: string, version: number, cle: string) =>
  !!v && v.id === avatarId && v.version === version && v.source_object_key === cle;

const erreurServeur = (message: string, code: string) =>
  NextResponse.json({ success: false, error: message, code }, { status: 500 });

const conflit = (code: 'avatar_concurrent' | 'avatar_superseded') =>
  NextResponse.json(
    { success: false, error: 'Un autre envoi vient de remplacer votre avatar. Rechargez la page.', code },
    { status: 409 },
  );

/**
 * ⚠️ NOUVELLE VERSION SANS TOUCHER À L'ACTIVE (incident du 2026-10-09).
 *
 * « Remplacer cet avatar » et « Créer un nouvel avatar » passent ICI, jamais
 * par une réécriture de la ligne active : une VERSION CANDIDATE est créée
 * dans `avatar_versions`, l'avatar actif reste celui de Créer et de
 * l'Autopilote, et la bascule n'a lieu que sur « Utiliser cette version ».
 *
 * Un emplacement vidéo plein est refusé AVANT tout appel fournisseur.
 */
/** Nombre d'avatars (identités vivantes) par compte : `AVATAR_IDENTITES_MAX`, 3 par défaut. */
function identitesMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.AVATAR_IDENTITES_MAX ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? n : 3;
}

const MESSAGE_EMPLACEMENT_PLEIN =
  'Votre emplacement d’avatar vidéo est déjà utilisé. Remplacez votre avatar vidéo existant : il restera actif pendant la préparation de la nouvelle version.';

/**
 * Une seule création de version / d'avatar à la fois PAR COMPTE : les
 * contrôles « emplacement libre », « plafond d'avatars » et « une candidate
 * à la fois » sont des lectures suivies d'écritures — deux requêtes
 * simultanées passeraient sinon toutes les deux (TOCTOU).
 */
async function cheminCandidat(args: Parameters<typeof cheminCandidatSansVerrou>[0]): Promise<NextResponse> {
  const cle = `creation:${args.userId}`;
  if (!prendreVerrouSource(cle)) {
    await args.nettoyer();
    return NextResponse.json({ success: false, error: 'Une création est déjà en cours pour votre compte. Patientez, puis réessayez.', code: 'creation_en_cours' }, { status: 429 });
  }
  try {
    return await cheminCandidatSansVerrou(args);
  } finally {
    libererVerrouSource(cle);
  }
}

async function cheminCandidatSansVerrou(args: {
  userId: string;
  email: string | null | undefined;
  mode: 'remplacer' | 'nouveau';
  avatarIdCible: string | null;
  kind: AvatarKind;
  nom: string;
  cleSource: string;
  cleOriginal: string | null;
  viaDid: boolean;
  consentement: { consent_at: string; consent_text: string; consent_version: string; subject_type: string };
  /** Retire la source déposée par CETTE requête si rien ne s'est lancé. */
  nettoyer: () => Promise<void>;
}): Promise<NextResponse> {
  const { userId, kind } = args;
  const refuser = async (status: number, code: string, error: string) => {
    await args.nettoyer();
    return NextResponse.json({ success: false, error, code }, { status });
  };
  if (args.viaDid) return refuser(409, 'remplacement_indisponible', 'Le remplacement n’est pas disponible pour cet avatar.');
  if (kind === 'video' && !jumeauVideoAutorise(isAdmin(args.email))) {
    return refuser(403, 'jumeau_video_indisponible', MESSAGES_CREATION.videoIndisponible);
  }
  const l = await listerIdentites(userId);
  if (!l.ok) return refuser(500, 'avatar_read_failed', 'Vos avatars n’ont pas pu être lus. Réessayez.');
  const emplacementPlein = kind === 'video' && identitesVideoAvecGroupe(l.identites) >= emplacementsVideo();

  let avatarId: string;
  let groupeExistant: string | null = null;
  if (args.mode === 'nouveau') {
    if (emplacementPlein) return refuser(409, 'emplacement_plein', MESSAGE_EMPLACEMENT_PLEIN);
    // Plafond d'identités par compte, AVANT toute écriture ou tout fournisseur :
    // chaque identité consomme un avatar chez le fournisseur (quota partagé).
    if (l.identites.length >= identitesMax()) {
      return refuser(409, 'identites_max', `Vous avez atteint le nombre maximal d’avatars (${identitesMax()}). Remplacez un avatar existant.`);
    }
    // Nouvelle IDENTITÉ : jamais par défaut s'il en existe déjà une — créer
    // un second avatar ne change pas celui qu'utilisent Créer et l'Autopilote.
    const { data, error } = await supabaseAdmin
      .from('user_avatars')
      .insert({
        user_id: userId, provider: 'heygen', avatar_type: kind, provider_avatar_id: null, provider_asset_id: null,
        name: args.nom, status: ETAT_SOURCE_PRETE, source_object_key: null, source_url: null, validated_at: null,
        version: 1, deleted_at: null, training_error: null, is_default: l.identites.length === 0, ...args.consentement,
      })
      .select('id')
      .single();
    if (error || !data) return refuser(500, 'avatar_insert_failed', 'Votre nouvel avatar n’a pas pu être enregistré. Réessayez.');
    avatarId = (data as { id: string }).id;
  } else {
    const lu = await avatarVivantDuCompte(userId, args.avatarIdCible ?? undefined);
    if (!lu.ok) return refuser(500, 'avatar_read_failed', 'Votre avatar n’a pas pu être lu. Réessayez.');
    if (!lu.avatar) return refuser(404, 'avatar_absent', 'Avatar introuvable.');
    const ident = lu.avatar as typeof lu.avatar & { provider?: string | null; provider_group_id?: string | null };
    if (ident.provider === FOURNISSEUR_DID) {
      return refuser(409, 'remplacement_indisponible', 'Le remplacement n’est pas disponible pour cet avatar.');
    }
    avatarId = ident.id;
    // ⚠️ REMPLACER ne crée JAMAIS de nouveau groupe fournisseur (= un nouvel
    // emplacement de jumeau). Même nature d'avatar, et pour un jumeau vidéo
    // la nouvelle vidéo rejoint le GROUPE EXISTANT (nouveau look, l'ancien
    // reste utilisable). Sinon : refus avant tout fournisseur.
    const typeActuel = ident.avatar_type === 'video' ? 'video' : 'photo';
    if (kind !== typeActuel) {
      return refuser(409, 'type_different', kind === 'video'
        ? 'Remplacer garde le même type d’avatar. Pour un avatar à partir d’une vidéo, utilisez « Créer un nouvel avatar ».'
        : 'Remplacer garde le même type d’avatar : envoyez une vidéo, ou utilisez « Créer un nouvel avatar ».');
    }
    if (kind === 'video') {
      if (!ident.provider_group_id) {
        return refuser(409, 'groupe_absent', 'Cet avatar vidéo ne peut pas recevoir de nouvelle version. Utilisez « Créer un nouvel avatar ».');
      }
      groupeExistant = ident.provider_group_id;
    }
  }

  const r = await lancerVersionCandidate({
    userId, avatarId, kind, nom: args.nom, cleSource: args.cleSource, cleOriginal: args.cleOriginal,
    mode: args.mode, groupeExistant, consentement: args.consentement,
  });
  if (!r.ok) {
    return refuser(r.motif === 'candidate_en_cours' || r.motif === 'groupe_absent' ? 409 : r.motif === 'introuvable' ? 404 : r.motif === 'source_invalide' ? 400 : 500, r.motif, r.message);
  }
  if (r.groupeId && kind === 'video') {
    // Le groupe d'une identité SANS version active (nouvel avatar) — jamais réécrit sur une identité utilisée.
    await supabaseAdmin.from('user_avatars').update({ provider_group_id: r.groupeId, provider_group_consent: null })
      .eq('id', avatarId).eq('user_id', userId).is('active_version_id', null).is('provider_group_id', null);
  }
  return NextResponse.json({
    success: true,
    data: { avatarId, mode: args.mode, candidate: versionPublique(r.version), etat: r.etat, message: r.message ?? null },
  });
}

/**
 * GET /api/avatar/create — avatar courant de l'utilisateur + voix disponibles.
 * Sert a l'affichage initial de la page : premiere visite (aucun avatar) vs
 * utilisateur deja equipe.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: avatars } = await supabaseAdmin
      .from('user_avatars')
      .select('*')
      .eq('user_id', session.user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    let avatar = avatars?.[0] ?? null;

    // Entrainement en cours ? On rafraichit le statut depuis HeyGen a chaque
    // consultation, ce qui permet a l'UI de simplement re-interroger cette
    // route pour suivre l'avancement — sans route supplementaire.
    // ⚠️ Sans `provider_avatar_id` (source enregistree, fournisseur jamais
    // sollicite ou en echec), il n'y a RIEN a interroger : on n'appelle pas
    // HeyGen avec `null` dans l'URL.
    if (avatar && avatar.provider === FOURNISSEUR_DID) {
      // D-ID : la resynchronisation de l'entrainement vit dans `lib/avatar/did`
      // (memes garde-fous : ecriture sur la version et l'identifiant interroges).
      const rafraichi = await rafraichirEntrainementDid(avatar as AvatarDid);
      if (rafraichi) avatar = rafraichi;
    } else if (avatar && avatar.provider_avatar_id && !READY_STATUSES.includes(avatar.status)) {
      const training = await getAvatarTrainingStatus(avatar.provider_avatar_id);
      if (training && training.status !== avatar.status) {
        const patch: Record<string, unknown> = { status: training.status };
        if (training.status === 'failed' && training.error) {
          patch.training_error = training.error;
        }
        // ⚠️ LE RESULTAT N'EST ECRIT QUE SUR LA VERSION INTERROGEE. Le
        // remplacement conserve `id` : pendant l'appel HeyGen, le compte a pu
        // passer en version+1 (fournisseur NULL, `source_ready`). Un
        // « completed » pour l'ancien identifiant ne doit jamais se poser sur
        // la nouvelle version. Zero ligne = instantane perime : on relit.
        const { data: touchees, error: erreurSync } = await supabaseAdmin
          .from('user_avatars')
          .update(patch)
          .eq('id', avatar.id)
          .eq('version', avatar.version)
          .eq('provider_avatar_id', avatar.provider_avatar_id)
          .is('deleted_at', null)
          .select();
        if (erreurSync) {
          console.warn(`[Avatar][HeyGen] Statut non resynchronise pour ${avatar.provider_avatar_id} : ${erreurSync.message}`);
        } else if (touchees && touchees.length === 1) {
          avatar = touchees[0];
          console.log(
            `[Avatar][HeyGen] Statut d'entrainement resynchronise pour ${avatar.provider_avatar_id}: ${training.status}`,
          );
        } else {
          console.log(`[Avatar][HeyGen] Instantane perime pour ${avatar.provider_avatar_id} : une version plus recente existe, relecture.`);
          const relu = await lireAvatarVivant(session.user.id);
          if (relu.ok) avatar = relu.avatar;
        }
      }
    }

    // Voix : non bloquant pour l'affichage, mais on renvoie explicitement une
    // voix par defaut. L'UI ne doit jamais proposer un choix "vide" : un
    // voice_id absent ou vide fait echouer /v3/videos en 400.
    const allVoices = await listVoices();

    const rank = (v: { language?: string }) => {
      const l = (v.language || '').toLowerCase();
      if (l.startsWith('fr') || l.includes('french')) return 0;
      if (l.startsWith('en') || l.includes('english')) return 1;
      return 2;
    };

    // Voix francaises en tete, puis anglaises, puis le reste : l'utilisateur
    // trouve immediatement une voix pertinente dans le selecteur.
    const voices = [...allVoices].sort((a, b) => rank(a) - rank(b)).slice(0, 80);

    const defaultVoiceId = pickDefaultVoice(voices)?.voiceId ?? null;
    console.log(
      `[Avatar][HeyGen] ${allVoices.length} voix chargees, ${voices.length} exposees, defaut=${defaultVoiceId ?? 'aucun'}`,
    );

    // ⚠️ `source_url` n'est plus renvoyé : c'est un localisateur interne
    // (relais public fermé aux sources), la page lit `/api/avatar/source`.
    // Le seul consommateur de cette réponse est `/dashboard/avatar`.
    if (avatar) {
      // L'état DÉRIVÉ (entrainement | entraine_non_valide | valide | echec…),
      // calculé au même endroit que la validation : l'écran ne le devine pas.
      avatar = {
        ...sansSourceUrl(avatar),
        etat: etatAvatar({
          status: avatar.status, provider_avatar_id: avatar.provider_avatar_id ?? null,
          validated_at: avatar.validated_at ?? null, deleted_at: avatar.deleted_at ?? null,
        }),
      };
    }

    // `didVideoActif` : l'ecran ouvre « A partir d'une video » seulement si le
    // serveur le dit — drapeau ET cle presents. Jamais la cle elle-meme.
    // `nomProfil` : le nom du compte, pour PRÉ-REMPLIR le nom de consentement D-ID à l'écran. Rien d'autre du profil.
    return NextResponse.json({ success: true, data: { avatar, voices, defaultVoiceId, didVideoActif: didVideoAvatarDisponible(), jumeauVideoActif: jumeauVideoAutorise(isAdmin(session.user.email)), nomProfil: session.user.name ?? null } });
  } catch (error) {
    console.error('[Avatar] GET create failed:', error);
    return NextResponse.json(
      { success: false, error: "Impossible de charger l'avatar." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/avatar/create — cree l'avatar HeyGen a partir d'une photo OU d'une
 * video.
 *
 * Le type de fichier determine la nature de l'avatar :
 *   image/* → avatar photo (talking photo), rendu rapide
 *   video/* → avatar video (digital twin), entrainement plus long, plus realiste
 *
 * Consentement OBLIGATOIRE dans les deux cas : sans `consent=true`, la requete
 * est refusee avant tout appel a HeyGen. On ne cree un avatar que de sa propre
 * personne.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const consent = formData.get('consent');
    const name = (formData.get('name') as string | null) || 'Mon avatar';
    // Le fournisseur DEMANDE : 'heygen' (defaut, inchange) ou 'did' (avatar
    // video). Pour D-ID, cette route ne fait que deposer la source et poser la
    // version : le consentement fournisseur, la creation et l'entrainement
    // passent ensuite par `/api/avatar/did/*`. Aucun repli silencieux : un
    // fournisseur inconnu ou inactif est refuse ici, avant tout depot.
    const providerDemande = (formData.get('provider') as string | null) || 'heygen';
    if (providerDemande !== 'heygen' && providerDemande !== FOURNISSEUR_DID) {
      return NextResponse.json({ success: false, error: 'Fournisseur inconnu.', code: 'provider_unknown' }, { status: 400 });
    }
    const viaDid = providerDemande === FOURNISSEUR_DID;
    if (viaDid && !didVideoAvatarDisponible()) {
      return NextResponse.json({ success: false, error: 'Avatar vidéo temporairement indisponible.', code: 'did_unavailable' }, { status: 503 });
    }

    if (consent !== 'true') {
      return NextResponse.json(
        {
          success: false,
          error:
            "Le consentement est obligatoire : vous devez certifier etre la personne sur le fichier envoye.",
        },
        { status: 400 },
      );
    }

    // Remplacer / nouveau : le choix VIENT de l'écran, l'identité du compte est relue ici.
    const modeBrut = formData.get('mode');
    const modeDemande = modeBrut === 'remplacer' || modeBrut === 'nouveau' ? modeBrut : null;
    const avatarIdBrut = formData.get('avatarId');
    const avatarIdCible = typeof avatarIdBrut === 'string' && /^[0-9a-f-]{36}$/i.test(avatarIdBrut) ? avatarIdBrut : null;
    const cleSourceRecue = formData.get('cleSource');
    const cleOriginalRecue = formData.get('cleOriginal');
    const consentementCandidat = (k: AvatarKind) => ({
      consent_at: new Date().toISOString(),
      consent_text: CONSENT_TEXT[k],
      consent_version: CONSENTEMENT_ENROLEMENT.version,
      subject_type: SUJET_AVATAR,
    });

    // Source PRÉPARÉE (enregistrée / recadrée / coupée, déjà en stockage privé) :
    // toujours une version candidate — jamais l'avatar actif réécrit.
    if (!file && typeof cleSourceRecue === 'string') {
      if (!cleSourceAvatarDuCompte(cleSourceRecue, userId)) {
        return NextResponse.json({ success: false, error: 'Source invalide.', code: 'avatar_source_invalid' }, { status: 400 });
      }
      // La source préparée doit EXISTER au compte avant toute ligne ou tout fournisseur.
      if (!(await sourceAvatarPresente(userId, cleSourceRecue))) {
        return NextResponse.json({ success: false, error: 'La vidéo préparée est introuvable. Recommencez la préparation.', code: 'avatar_source_absente' }, { status: 400 });
      }
      const cleOriginal = typeof cleOriginalRecue === 'string' && cleSourceAvatarDuCompte(cleOriginalRecue, userId) ? cleOriginalRecue : null;
      const kindSource: AvatarKind = /\.(mp4|webm|mov)$/i.test(cleSourceRecue) ? 'video' : 'photo';
      const lu = await lireAvatarVivant(userId);
      if (!lu.ok) return erreurServeur("Votre avatar n'a pas pu etre lu. Reessayez.", 'avatar_read_failed');
      return cheminCandidat({
        userId, email: session.user.email, mode: modeDemande ?? (lu.avatar ? 'remplacer' : 'nouveau'), avatarIdCible,
        kind: kindSource, nom: name, cleSource: cleSourceRecue, cleOriginal, viaDid,
        consentement: consentementCandidat(kindSource),
        // La source préparée appartient au parcours de l'écran : on ne la retire pas ici.
        nettoyer: async () => {},
      });
    }

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni.' },
        { status: 400 },
      );
    }

    const isVideo = file.type.startsWith('video/');
    const kind: AvatarKind = isVideo ? 'video' : 'photo';
    // Jumeau VIDÉO hors D-ID legacy : réservé à l'admin (consentement externe,
    // niveau 1). Refusé AVANT tout dépôt et tout appel fournisseur.
    if (isVideo && !viaDid && !jumeauVideoAutorise(isAdmin(session.user.email))) {
      return NextResponse.json({ success: false, error: MESSAGES_CREATION.videoIndisponible, code: 'jumeau_video_indisponible' }, { status: 403 });
    }

    if (viaDid) {
      // D-ID : une VIDEO obligatoirement, MP4 ou MOV (ce que le fournisseur
      // accepte en `source_url` ; WebM n'en fait pas partie), 50 Mo maximum.
      if (!isVideo || !TYPES_VIDEO_DID[file.type]) {
        return NextResponse.json(
          { success: false, error: 'Format vidéo non supporté pour l’avatar vidéo. Utilisez MP4 ou MOV.', code: 'did_bad_format' },
          { status: 400 },
        );
      }
      if (file.size > MAX_VIDEO_SOURCE_DID_OCTETS) {
        return NextResponse.json(
          { success: false, error: `Vidéo trop lourde (${Math.round(file.size / 1024 / 1024)} Mo). 50 Mo maximum — réduisez la durée ou la qualité.`, code: 'did_too_large' },
          { status: 413 },
        );
      }
      if (file.size === 0) {
        return NextResponse.json({ success: false, error: 'Le fichier est vide.', code: 'did_empty' }, { status: 400 });
      }
    } else if (isVideo) {
      if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: 'Format video non supporte. Utilisez MP4 ou WebM.' },
          { status: 400 },
        );
      }
      // Limite imposee par HeyGen sur POST /v3/assets. Au-dela, HeyGen exige un
      // upload direct par URL presignee, non implemente ici.
      if (file.size > HEYGEN_ASSET_MAX_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `Video trop lourde (${Math.round(file.size / 1024 / 1024)} Mo). L'envoi est limite a 32 Mo — reduisez la duree ou la qualite.`,
          },
          { status: 413 },
        );
      }
    } else {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: 'Format non supporte. Utilisez JPG, PNG ou WebP.' },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_SIZE) {
        return NextResponse.json(
          { success: false, error: 'Image trop lourde (10 Mo maximum).' },
          { status: 413 },
        );
      }
    }

    console.log(
      `[Avatar][${viaDid ? 'D-ID' : 'HeyGen'}] Creation demandee par ${userId} — nature=${kind} type=${file.type} taille=${Math.round(file.size / 1024)} Ko`,
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const extByType: Record<string, string> = {
      'image/png': 'png',
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    };
    const ext = extByType[file.type] ?? (isVideo ? 'mp4' : 'jpg');

    /* ─────────────────────────────────────────────────────────────────────
       AVATAR-2A — REMPLACER SANS EFFACER.

       L'ordre est le contrat :
         C. lire l'avatar VIVANT du compte (et sa source actuelle) ;
         D. construire la nouvelle cle, ici et nulle part ailleurs ;
         E. deposer la nouvelle source — BLOQUANT : sans objet, rien d'autre ;
         F. la transition en base : premiere inscription = insert version 1,
            sinon compare-and-set version -> version+1 sur la MEME ligne
            (`user_avatars.id` conserve, generations conservees) ;
         G. transition refusee (une autre requete a gagne) : retirer MA
            source seulement — jamais celle relue, qui est la gagnante ;
         H. transition reussie : retirer l'ANCIENNE source, apres seulement ;
         I. le fournisseur, APRES la base ; son resultat n'est ecrit que sur
            la version qu'il concerne (`where version = nouvelle`) — une
            reponse tardive ne peut pas ecraser une version plus recente.
       ───────────────────────────────────────────────────────────────────── */

    // C. L'avatar vivant, et la source qu'il designe aujourd'hui.
    //    ⚠️ Une lecture en echec ARRETE tout, avant la moindre ecriture :
    //    « je n'ai pas pu lire » n'est pas « il n'y a rien ».
    const lecture = await lireAvatarVivant(userId);
    if (!lecture.ok) {
      console.error(`[Avatar] Lecture de l'avatar impossible pour ${userId} : ${lecture.erreur}`);
      return erreurServeur("Votre avatar n'a pas pu etre lu. Reessayez.", 'avatar_read_failed');
    }
    const actuel = lecture.avatar;

    // D + E. La nouvelle source, sous sa cle privee.
    const nouvelleCle = cleSourceAvatar(userId, ext);
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET_AVATAR)
      .upload(nouvelleCle, buffer, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('[Avatar] Source upload failed:', upErr.message);
      return NextResponse.json(
        { success: false, error: "Votre fichier n'a pas pu etre enregistre. Reessayez." },
        { status: 500 },
      );
    }

    // Le texte certifie nomme le fournisseur qui recoit reellement la video.
    const consentement = {
      consent_at: new Date().toISOString(),
      consent_text: viaDid ? CONSENTEMENT_ENROLEMENT_DID.texte : CONSENT_TEXT[kind],
      consent_version: viaDid ? CONSENTEMENT_ENROLEMENT_DID.version : CONSENTEMENT_ENROLEMENT.version,
      subject_type: SUJET_AVATAR,
    };

    // Le compte a déjà un avatar (ou demande un NOUVEL avatar) : version
    // CANDIDATE, l'active n'est pas touchée. L'ancien chemin qui réécrivait
    // la ligne active (version+1 avant que le fournisseur ait répondu) a été
    // supprimé : c'est lui qui a coupé le jumeau v3 le 2026-10-09.
    if (actuel) {
      return cheminCandidat({
        userId, email: session.user.email, mode: modeDemande ?? 'remplacer', avatarIdCible,
        kind, nom: name, cleSource: nouvelleCle, cleOriginal: null, viaDid,
        consentement,
        nettoyer: async () => { await retirerSourceAvatar(userId, nouvelleCle, actuel.source_object_key ?? null); },
      });
    }

    /* ── Le nettoyage de MA source, et de rien d'autre ─────────────────────
       `cleConservee` est la cle que la ligne vivante designe MAINTENANT. Si
       on ne peut pas la relire, on ne sait pas laquelle proteger : on ne
       retire RIEN. Un objet orphelin se retrouve ; une source active
       supprimee ne se retrouve pas. */
    const retirerMaSource = async (vivant: AvatarVivant | null): Promise<void> => {
      await retirerSourceAvatar(userId, nouvelleCle, vivant?.source_object_key ?? null);
    };
    const abandonner = async (code: 'avatar_concurrent' | 'avatar_superseded' = 'avatar_concurrent') => {
      const relu = await lireAvatarVivant(userId);
      if (!relu.ok) {
        console.warn(`[Avatar] Nettoyage differe pour ${nouvelleCle} : gagnant inconnu (${relu.erreur}).`);
        return conflit(code);
      }
      await retirerMaSource(relu.avatar);
      return conflit(code);
    };

    // F. La transition.
    let avatarId: string;
    let nouvelleVersion: number;
    if (!actuel) {
      // Première identité du compte : elle devient l'avatar par défaut.
      const { data: inseree, error: insertError } = await supabaseAdmin
        .from('user_avatars')
        .insert({
          user_id: userId,
          provider: providerDemande,
          avatar_type: kind,
          provider_avatar_id: null,
          provider_asset_id: null,
          name,
          status: ETAT_SOURCE_PRETE,
          source_object_key: nouvelleCle,
          source_url: null,
          validated_at: null,
          version: 1,
          deleted_at: null,
          training_error: null,
          is_default: true,
          ...consentement,
        })
        .select('id, version')
        .single();
      if (inseree && !insertError) {
        avatarId = inseree.id;
        nouvelleVersion = inseree.version;
      } else if (insertError?.code === '23505') {
        // L'index « un seul avatar vivant par compte » : une autre premiere
        // inscription a gagne pendant qu'on deposait la source. Certain.
        return abandonner();
      } else {
        // ⚠️ ERREUR INCERTAINE : le serveur a pu commiter avant que la
        // reponse ne se perde. On relit AVANT de toucher au stockage.
        console.error('[Avatar] Insert incertain :', insertError?.message ?? 'reponse vide');
        const relu = await lireAvatarVivant(userId);
        if (!relu.ok) {
          console.warn(`[Avatar] Nettoyage differe pour ${nouvelleCle} : relecture impossible (${relu.erreur}).`);
          return erreurServeur("Votre avatar n'a pas pu etre enregistre. Reessayez.", 'avatar_insert_failed');
        }
        if (relu.avatar && relu.avatar.source_object_key === nouvelleCle && relu.avatar.version === 1) {
          // L'insertion est bien la : on continue comme si elle avait repondu.
          avatarId = relu.avatar.id;
          nouvelleVersion = relu.avatar.version;
        } else if (relu.avatar) {
          return abandonner();
        } else {
          await retirerMaSource(null);
          return erreurServeur("Votre avatar n'a pas pu etre enregistre. Reessayez.", 'avatar_insert_failed');
        }
      }
    } else {
      // Inatteignable : un compte qui a déjà un avatar passe par `cheminCandidat`.
      return erreurServeur("Votre avatar n'a pas pu etre enregistre. Reessayez.", 'avatar_insert_failed');
    }

    // I bis. D-ID : la source est deposee, la version posee — on s'arrete la.
    //    Le fournisseur n'est PAS sollicite ici : il exige d'abord un
    //    consentement lu a la camera (`/api/avatar/did/consentement`).
    if (viaDid) {
      const relu = await lireAvatarVivant(userId);
      if (!relu.ok || !estCetteVersionDid(relu.avatar, avatarId, nouvelleVersion, nouvelleCle)) return conflit('avatar_superseded');
      return NextResponse.json({ success: true, data: { avatar: sansSourceUrl(relu.avatar!) } });
    }

    // I. Le fournisseur, a partir des octets recus (jamais d'une URL).
    //    Son resultat — succes comme echec — n'est ecrit QUE sur la version
    //    qu'il concerne : `where id and version and source_object_key and
    //    deleted_at is null`. Trois issues, tenues STRICTEMENT a part :
    //      - ecrit, 1 ligne          → cette version, a jour ;
    //      - pas d'erreur, 0 ligne   → une version plus recente existe :
    //                                  cette reponse est perimee, 409 ;
    //      - ERREUR de la base       → on ne sait pas : on relit et on
    //                                  reconcilie. Une panne n'est pas une
    //                                  concurrence, et ne se deguise pas en 409.
    const estCetteVersion = (v: AvatarVivant | null) =>
      !!v && v.id === avatarId && v.version === nouvelleVersion && v.source_object_key === nouvelleCle;

    const fallbackName = isVideo ? 'video.mp4' : 'photo.jpg';
    let chezFournisseur: { avatarId: string; assetId: string; status: string; groupId: string | null };
    try {
      const asset = await uploadAsset(new Blob([buffer], { type: file.type }), file.name || fallbackName);
      const cree = await createAvatarFromAsset(asset.assetId, name, kind);
      chezFournisseur = { avatarId: cree.avatarId, assetId: asset.assetId, status: cree.status, groupId: cree.avatarGroupId ?? null };
    } catch (erreurFournisseur) {
      // Fournisseur INVISIBLE : brut aux journaux, message Studiio en base
      // (`training_error` est relu par l'écran).
      console.error('[Avatar] creation refusee chez le fournisseur :', erreurFournisseur instanceof Error ? erreurFournisseur.message : erreurFournisseur);
      const message = MESSAGES_CREATION.echec;
      const { data: marquees, error: erreurMarque } = await supabaseAdmin
        .from('user_avatars')
        .update({ status: 'failed', training_error: message })
        .eq('id', avatarId)
        .eq('version', nouvelleVersion)
        .eq('source_object_key', nouvelleCle)
        .is('deleted_at', null)
        .select('id');
      if (erreurMarque) {
        console.error(`[Avatar] Echec fournisseur non persiste pour ${avatarId} v${nouvelleVersion} : ${erreurMarque.message}`);
        const relu = await lireAvatarVivant(userId);
        if (relu.ok && relu.avatar && !estCetteVersion(relu.avatar)) return conflit('avatar_superseded');
        if (relu.ok && estCetteVersion(relu.avatar) && relu.avatar!.status === 'failed') throw erreurFournisseur;
        return erreurServeur(
          "La source de votre avatar a été refusée et l'échec n'a pas pu être enregistré. Réessayez.",
          'avatar_failure_persistence_failed',
        );
      }
      if (!marquees || marquees.length === 0) {
        console.warn(`[Avatar] Echec fournisseur perime pour ${avatarId} v${nouvelleVersion} : une version plus recente existe.`);
        return conflit('avatar_superseded');
      }
      throw erreurFournisseur;
    }

    const attendu = {
      provider_avatar_id: chezFournisseur.avatarId,
      provider_asset_id: chezFournisseur.assetId,
      status: chezFournisseur.status,
      training_error: null,
      // Jumeau vidéo : le groupe sert au consentement filmé et à son suivi.
      ...(kind === 'video' ? { provider_group_id: chezFournisseur.groupId, provider_group_consent: null } : {}),
    };
    const { data: rows, error: erreurProvider } = await supabaseAdmin
      .from('user_avatars')
      .update(attendu)
      .eq('id', avatarId)
      .eq('version', nouvelleVersion)
      .eq('source_object_key', nouvelleCle)
      .is('deleted_at', null)
      .select();
    let row: AvatarVivant | undefined = rows?.[0];
    if (erreurProvider) {
      // Le fournisseur a bien cree l'avatar ; la base n'a pas repondu. On
      // relit : ecrit malgre tout, perime, ou vraiment non persiste.
      console.error(`[Avatar] Fournisseur non persiste pour ${avatarId} v${nouvelleVersion} : ${erreurProvider.message}`);
      const relu = await lireAvatarVivant(userId);
      if (!relu.ok) {
        return erreurServeur(
          "Votre avatar a été créé mais n'a pas pu être enregistré. Réessayez.",
          'avatar_provider_persistence_failed',
        );
      }
      if (relu.avatar && !estCetteVersion(relu.avatar)) return conflit('avatar_superseded');
      if (
        estCetteVersion(relu.avatar)
        && relu.avatar!.provider_avatar_id === attendu.provider_avatar_id
        && relu.avatar!.provider_asset_id === attendu.provider_asset_id
      ) {
        row = relu.avatar!;
      } else {
        return erreurServeur(
          "Votre avatar a été créé mais n'a pas pu être enregistré. Réessayez.",
          'avatar_provider_persistence_failed',
        );
      }
    } else if (!row) {
      console.warn(`[Avatar] Reponse fournisseur perimee pour ${avatarId} v${nouvelleVersion} : une version plus recente existe.`);
      return conflit('avatar_superseded');
    }

    return NextResponse.json({ success: true, data: { avatar: sansSourceUrl(row) } });
  } catch (error) {
    if (error instanceof HeyGenError) {
      console.error(
        `[Avatar][HeyGen] Creation refusee — code=${error.code} http=${error.httpStatus} : ${error.message}`,
      );
      return NextResponse.json(
        { success: false, error: MESSAGES_CREATION.indisponible, code: 'avatar_service' },
        { status: error.httpStatus },
      );
    }
    console.error('[Avatar] Create failed:', error);
    return NextResponse.json(
      { success: false, error: "La creation de l'avatar a echoue." },
      { status: 500 },
    );
  }
}
