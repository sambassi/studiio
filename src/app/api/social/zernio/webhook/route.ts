import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sansPreuveZernio, resultatsParReseau, motifPartiel, etatPreuveZernio } from '@/lib/social/publishViaZernio';

/**
 * Webhook Zernio — un seul point d'entrée, routage interne.
 *
 * ⚠️ CETTE ROUTE EST PUBLIQUE : n'importe qui sur Internet peut l'appeler.
 * C'est la SIGNATURE qui fait foi, rien d'autre. Sans elle, il suffirait de
 * poster un `account.connected` bien formé pour rattacher un compte au profil
 * d'un autre utilisateur.
 *
 * Zernio signe le corps BRUT en HMAC-SHA256 et le pose dans
 * `X-Zernio-Signature` (spécification OpenAPI publique). La signature y est
 * *optionnelle* — elle ne s'active qu'en configurant un secret côté Zernio.
 * D'où la règle ci-dessous, qui n'est pas une commodité :
 *
 * ⚠️ SANS `ZERNIO_WEBHOOK_SECRET`, ON REFUSE TOUT. Accepter les événements non
 * signés « en attendant » laisserait une porte ouverte que personne ne
 * penserait à refermer — et elle ne se verrait dans aucun test.
 *
 * ⚠️ ET LE CORPS SE LIT EN TEXTE, PAS EN JSON. `req.json()` reformate ; le
 * HMAC porte sur les octets exacts. Un espace de différence et toute
 * signature valide serait rejetée.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Comparaison à temps constant — une comparaison naïve fuit la signature. */
function signatureValide(brut: string, entete: string | null, secret: string): boolean {
  if (!entete) return false;
  const attendu = createHmac('sha256', secret).update(brut, 'utf8').digest('hex');
  // Zernio peut préfixer (`sha256=…`) : on compare la partie hexadécimale.
  const recu = entete.includes('=') ? entete.split('=').pop()!.trim() : entete.trim();
  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(recu.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** L'utilisateur derrière un profil Zernio. */
async function utilisateurDuProfil(profileId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users').select('id').eq('zernio_profile_id', profileId).limit(1);
  return (data?.[0] as { id?: string } | undefined)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error(
      '[Zernio/Webhook] ZERNIO_WEBHOOK_SECRET absente — evenements REFUSES. '
      + 'Configurer le secret cote Zernio (Settings → Webhooks) et dans Coolify.',
    );
    return NextResponse.json({ success: false }, { status: 503 });
  }

  const brut = await req.text();
  if (!signatureValide(brut, req.headers.get('x-zernio-signature'), secret)) {
    console.warn('[Zernio/Webhook] Signature invalide — evenement ignore.');
    return NextResponse.json({ success: false }, { status: 401 });
  }

  let evenement: Record<string, unknown>;
  try {
    evenement = JSON.parse(brut) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  // ⚠️ ON REPOND 200 QUOI QU'IL ARRIVE ENSUITE. Un 5xx ferait rejouer
  // l'evenement en boucle chez Zernio pour une erreur qui vient de NOTRE base :
  // le traitement est journalisé, la livraison acquittée.
  try {
    await traiter(evenement);
  } catch (err) {
    console.error('[Zernio/Webhook] Traitement echoue :', err);
  }
  return NextResponse.json({ success: true });
}

/**
 * Motif affiché quand Zernio annonce `post.cancelled`. Non exporté : un
 * fichier de route Next n'exporte que ses handlers et réglages.
 */
const MOTIF_ANNULE = 'Publication annulée côté service de publication.';

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function traiter(evenement: Record<string, unknown>): Promise<void> {
  const type = String(evenement.event ?? evenement.type ?? '');
  // ⚠️ ENVELOPPE DOCUMENTÉE PAR ZERNIO (OpenAPI `WebhookPayloadPost` /
  // `WebhookPayloadAccountConnected`) : `post: {…, metadata}` et
  // `account: {accountId, profileId, platform, username}`, SANS `data`.
  // L'ancienne forme `data` reste lue en repli : elle n'a jamais été
  // documentée, nos premières fixtures l'avaient inventée d'après le code.
  const data = (estObjet(evenement.data) ? evenement.data : evenement) as Record<string, unknown>;
  // ⚠️ UNE SEULE SOURCE PAR ÉVÉNEMENT POST. Si `post` est un objet, metadata,
  // platforms ET id se lisent dans `post` seulement ; sinon tout vient de
  // l'ancienne forme `data`. Jamais `post.metadata` avec `data.platforms` :
  // un mélange appliquerait au post A les résultats réseau d'un post B.
  // L'id n'est lu dans `data` que si `data` est un vrai objet : à plat,
  // `evenement.id` est l'identifiant de l'ÉVÉNEMENT, pas celui du post.
  const sourcePost = (estObjet(evenement.post) ? evenement.post
    : estObjet(evenement.data) ? evenement.data : null) as Record<string, unknown> | null;
  const sourceMeta = (sourcePost ?? data) as Record<string, unknown>;

  if (type === 'account.connected' || type === 'account.disconnected') {
    const compte = (estObjet(evenement.account) ? evenement.account : data) as Record<string, unknown>;
    const accountId = String(compte.accountId ?? compte._id ?? '');
    const profileId = String(compte.profileId ?? '');
    if (!accountId || !profileId) return;

    if (type === 'account.disconnected') {
      // Pas de `user_id` a retrouver : la ligne existe deja, on ne touche
      // qu'au statut. L'ecran proposera « Reconnecter ».
      await supabaseAdmin
        .from('zernio_accounts')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('account_id', accountId);
      return;
    }

    const userId = await utilisateurDuProfil(profileId);
    if (!userId) {
      console.warn(`[Zernio/Webhook] Profil ${profileId} sans utilisateur — evenement ignore.`);
      return;
    }
    await supabaseAdmin.from('zernio_accounts').upsert(
      {
        user_id: userId,
        profile_id: profileId,
        account_id: accountId,
        platform: String(compte.platform ?? 'inconnu'),
        username: typeof compte.username === 'string' ? compte.username : null,
        status: 'connected',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    );
    return;
  }

  if (type === 'post.published' || type === 'post.failed' || type === 'post.partial' || type === 'post.cancelled') {
    // ⚠️ ON RETROUVE LE POST PAR L'IDENTIFIANT QU'ON A ECRIT A LA CREATION,
    // range dans `metadata.studiioPostId`. Se fier a un rapprochement par
    // date ou par contenu confondrait deux montages du meme cycle.
    const metaEvenement = (estObjet(sourceMeta.metadata) ? sourceMeta.metadata : {}) as Record<string, unknown>;
    const postId = typeof metaEvenement.studiioPostId === 'string' ? metaEvenement.studiioPostId : null;
    if (!postId) return;
    // `post.cancelled` → `failed` (statut EXISTANT, jamais `scheduled` ni
    // `publishing`) : le cron ne reprend que `scheduled`, le reset des posts
    // bloqués que `publishing` — aucune republication automatique.
    const statut = type === 'post.published' ? 'published' : 'failed';

    // Le post est lu UNE fois : propriétaire, anti-rejeu et fusion de
    // metadata partent de cette ligne. Lecture en erreur : on garde le
    // comportement d'avant (pas de contrôle, chemins « metadata illisible »).
    const { data: lignes, error: lectureErr } = await supabaseAdmin
      .from('scheduled_posts').select('id, user_id, metadata').eq('id', postId).limit(1);
    const lisible = !lectureErr && Array.isArray(lignes);
    if (lisible && lignes.length === 0) {
      console.warn(`[Zernio/Webhook] post ${postId} introuvable — evenement ignore.`);
      return;
    }
    const ligne = lisible
      ? (lignes[0] as { user_id?: string | null; metadata?: Record<string, unknown> | null })
      : null;

    // Lecture du post en erreur (`ligne` nul) : contrôle propriétaire SAUTÉ
    // délibérément — fail-open, la charge utile est signée par Zernio.
    // ⚠️ PROPRIÉTAIRE : l'événement doit venir d'un compte / profil Zernio de
    // l'auteur du post. Identifiants lus dans la MÊME enveloppe que la
    // metadata (`platforms[].accountId`) et dans `profiles[].id` (racine,
    // documenté). Sans identifiant dans l'événement, ou auteur sans compte
    // Zernio enregistré (ancien cas) : accepté comme avant.
    if (ligne?.user_id && !(await evenementDuProprietaire(evenement, sourceMeta, ligne.user_id))) {
      console.warn(`[Zernio/Webhook] post ${postId} : evenement d’un autre proprietaire — ignore.`);
      return;
    }

    // ⚠️ ÉVÉNEMENT PÉRIMÉ OU REJOUÉ : il doit viser le post Zernio COURANT.
    // Après « Réessayer », un ancien `post.failed` redélivré effacerait la
    // preuve du nouvel envoi et ouvrirait une republication. Sans identifiant
    // dans l'événement (ancienne forme), sans preuve en base, ou preuve d'un
    // autre post : comme avant.
    const idZernio = !sourcePost ? null
      : typeof sourcePost.id === 'string' ? sourcePost.id
        : typeof sourcePost._id === 'string' ? sourcePost._id : null;
    if (idZernio && ligne) {
      const meta = ligne.metadata ?? {};
      // Seule une preuve qui appartient À CE POST compte : une copie
      // (« Dupliquer ») porte la preuve de l'original, étrangère ici.
      const courant = etatPreuveZernio(meta, postId) === 'valide' ? meta.zernioPostId : undefined;
      if (typeof courant === 'string' && courant !== idZernio) {
        console.warn(`[Zernio/Webhook] post ${postId} : ${type} vise ${idZernio}, envoi courant ${courant} — evenement perime ignore.`);
        return;
      }
    }

    // ⚠️ `post.failed` ET `post.cancelled` EFFACENT LA PREUVE D'ENVOI.
    // Sinon, un post reprogramme serait pris pour « deja envoye » par le cron
    // et resterait a `publishing` sans webhook — et le reset des posts
    // bloques epargne les preuves valides : bloque pour toujours.
    // `cancelled` (doc Zernio : job annule, ou toutes les entrees retirees
    // par unpublish) : plus rien n'est en ligne ; statut `failed` + motif
    // explicite. Aucune republication automatique (le cron ne prend que
    // `scheduled`) : seul « Reessayer » de l'utilisateur renvoie.
    // Relecture puis fusion : un `update` direct de `metadata` ecraserait
    // sequences, design et URLs. `post.partial` GARDE la preuve : une partie
    // des reseaux a publie, et republier en doublerait certains.
    if (type === 'post.failed' || type === 'post.cancelled') {
      if (ligne) {
        const sans = sansPreuveZernio(ligne.metadata);
        await supabaseAdmin
          .from('scheduled_posts')
          .update({ status: statut, metadata: type === 'post.cancelled' ? { ...sans, error: MOTIF_ANNULE } : sans })
          .eq('id', postId);
        return;
      }
      // Lecture impossible : on ne reecrit PAS `metadata` a l'aveugle (ce
      // serait tout effacer). Le statut passe quand meme a `failed`.
      console.error(`[Zernio/Webhook] post ${postId} : metadata illisible, preuve d'envoi conservee.`);
    }

    // ⚠️ `post.partial` : état PARTIEL explicite, résultats par réseau gardés
    // (`zernioResultatsReseaux` survit à « Réessayer », qui vide
    // `cron_publish_results`). Le cron le lit : un « Réessayer » finit en
    // échec expliqué, jamais bloqué à `publishing`. La preuve reste.
    if (type === 'post.partial') {
      if (ligne) {
        const actuelle = ligne.metadata ?? {};
        // Docs Zernio (webhooks/posts) : résultats sous `post.platforms[]`.
        const resultats = resultatsParReseau(sourceMeta.platforms);
        await supabaseAdmin
          .from('scheduled_posts')
          .update({
            status: statut,
            metadata: {
              ...actuelle,
              zernioPartiel: true,
              zernioResultatsReseaux: resultats,
              ...(resultats.length ? { cron_publish_results: resultats } : {}),
              error: motifPartiel(resultats),
            },
          })
          .eq('id', postId);
        return;
      }
      console.error(`[Zernio/Webhook] post ${postId} : metadata illisible, etat partiel non memorise.`);
    }

    await supabaseAdmin
      .from('scheduled_posts')
      .update({ status: statut })
      .eq('id', postId);
  }
}

const chainesNonVides = (v: unknown[]): string[] =>
  v.filter((x): x is string => typeof x === 'string' && x.length > 0);

/**
 * L'événement vient-il d'un compte / profil Zernio de l'auteur du post ?
 * Comptes (`platforms[].accountId` ↔ `zernio_accounts.account_id`, tous
 * statuts) OU profils (`profiles[].id` ↔ `zernio_accounts.profile_id` +
 * `users.zernio_profile_id`). Rien à comparer d'un côté ou de l'autre :
 * accepté (ancienne forme, auteur sans compte enregistré).
 */
async function evenementDuProprietaire(
  evenement: Record<string, unknown>,
  source: Record<string, unknown>,
  userId: string,
): Promise<boolean> {
  const evComptes = chainesNonVides(
    (Array.isArray(source.platforms) ? source.platforms : []).map((p) => (estObjet(p) ? p.accountId : null)),
  );
  const evProfils = chainesNonVides(
    (Array.isArray(evenement.profiles) ? evenement.profiles : []).map((p) => (estObjet(p) ? p.id : null)),
  );
  if (evComptes.length === 0 && evProfils.length === 0) return true;

  // Lecture en erreur → traitée comme « rien d'enregistré » (journalisée) :
  // l'événement est signé par Zernio, le perdre bloquerait le post.
  const { data: comptes, error: errComptes } = await supabaseAdmin
    .from('zernio_accounts').select('account_id, profile_id').eq('user_id', userId);
  if (errComptes) console.error('[Zernio/Webhook] comptes du proprietaire illisibles :', errComptes.message);
  const { data: users, error: errUsers } = await supabaseAdmin
    .from('users').select('zernio_profile_id').eq('id', userId).limit(1);
  if (errUsers) console.error('[Zernio/Webhook] profil du proprietaire illisible :', errUsers.message);

  const lignesComptes = (Array.isArray(comptes) ? comptes : []) as Array<{ account_id?: unknown; profile_id?: unknown }>;
  const ownComptes = new Set(chainesNonVides(lignesComptes.map((c) => c.account_id)));
  const ownProfils = new Set(chainesNonVides([
    ...lignesComptes.map((c) => c.profile_id),
    ...((Array.isArray(users) ? users : []) as Array<{ zernio_profile_id?: unknown }>).map((u) => u.zernio_profile_id),
  ]));

  // Règle OU : un compte commun OU un profil commun suffit. Refus seulement
  // si au moins un côté était comparable et qu'aucun ne correspond.
  const comptesComparables = evComptes.length > 0 && ownComptes.size > 0;
  const profilsComparables = evProfils.length > 0 && ownProfils.size > 0;
  if (!comptesComparables && !profilsComparables) return true;
  return (comptesComparables && evComptes.some((a) => ownComptes.has(a)))
    || (profilsComparables && evProfils.some((p) => ownProfils.has(p)));
}
