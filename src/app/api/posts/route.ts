import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import {
  collectStorageUrlsFromPost, deleteStorageFiles, autopilotRushKeys, storageKey,
} from '@/lib/storage/cleanup';
import { mergePostMetadata } from '@/lib/creer/postMetadata';
import { PUT_ALLOWED_COLUMNS, parsePutPostPayload } from '@/lib/posts/put-payload';

// GET /api/posts?month=2026-03
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // format: YYYY-MM

    let query = supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', session.user.id)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (month) {
      const [year, m] = month.split('-').map(Number);
      const startDate = `${year}-${String(m).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(m + 1 > 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      query = query.gte('scheduled_date', startDate).lt('scheduled_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, posts: data || [] });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch posts' }, { status: 500 });
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { title, caption, media_url, media_type, format, platforms, scheduled_date, scheduled_time, status, metadata } = body;

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert({
        user_id: session.user.id,
        title: title || '',
        caption: caption || '',
        media_url,
        media_type: media_type || 'video',
        format: format || 'reel',
        platforms: platforms || [],
        scheduled_date,
        scheduled_time: scheduled_time || '12:00',
        status: status || 'draft',
        ...(metadata ? { metadata } : {}),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, post: data });
  } catch (error) {
    console.error('Error creating post:', error);
    return NextResponse.json({ success: false, error: 'Failed to create post' }, { status: 500 });
  }
}

/**
 * PUT /api/posts — mise a jour d'un post du Calendrier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A CHANGE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le gestionnaire faisait `const { id, ...updates } = body` puis
 * `.update(updates)` : tout ce qui n'etait pas `id` partait en base. Trois
 * consequences, par ordre de gravite :
 *
 *  1. **`user_id` etait reecrivable.** Le `WHERE` portait sur l'ancien
 *     proprietaire, donc l'ecriture passait, et le `SET` designait le
 *     nouveau. Un compte pouvait ainsi CEDER un post programme a un tiers ;
 *     le cron (`api/cron/publish/route.ts`) selectionne ensuite les comptes
 *     sociaux PAR `post.user_id` et publiait le contenu de l'attaquant avec
 *     les jetons OAuth de la victime.
 *  2. **`metadata` etait remplace en entier** — la meme perte silencieuse que
 *     `PATCH /api/posts/[id]` avant sa correction, mais sur la route que
 *     l'edition de post utilise reellement.
 *  3. **Toute colonne etait injectable** : `approved_by`, `published_at`,
 *     `agent_generated`, `created_at`…
 *
 * Desormais un objet NEUF est construit depuis une liste blanche, `metadata`
 * est fusionne au lieu d'etre ecrase, et le proprietaire est verifie avant
 * l'ecriture puis re-contraint dans le `WHERE`.
 *
 * Ce que cette route ne fait toujours pas, et ne doit jamais faire : publier,
 * composer une video, debiter des credits, creer un post.
 */
export async function PUT(req: NextRequest) {
  try {
    // ── 1. Authentification ────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Corps JSON invalide' }, { status: 400 });
    }

    // ── 2. Liste blanche ───────────────────────────────────────────
    // Avant toute requete : un corps refuse ne doit rien couter ni rien
    // reveler de la ligne visee.
    const payload = parsePutPostPayload(raw);
    if (!payload.ok) {
      return NextResponse.json(
        {
          success: false,
          error: payload.error,
          ...(payload.ignored.length > 0
            ? { message: `Champs ignores (non modifiables) : ${payload.ignored.join(', ')}` }
            : {}),
        },
        { status: payload.status },
      );
    }

    // ── 3. Chargement et controle du proprietaire ──────────────────
    // Sans filtre `user_id` sur la LECTURE : c'est ce qui distingue « le post
    // n'existe pas » (404) de « il ne vous appartient pas » (403). L'ancienne
    // version confondait les deux dans un 500.
    const { data: existing, error: readError } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, metadata, updated_at')
      .eq('id', payload.id)
      .maybeSingle();

    if (readError) {
      console.error('[API] Post read error:', readError);
      return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
    }
    if (!existing) {
      // Aucune creation implicite : un identifiant inconnu est une erreur.
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }
    // L'identite vient de la SESSION, jamais d'un `user_id`, `owner_id`,
    // `email` ou `role` fourni par le client — que la liste blanche a de
    // toute facon deja ecartes.
    if (existing.user_id !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // ── 4. Fusion des metadonnees ──────────────────────────────────
    const updates: Record<string, unknown> = { ...payload.updates };
    if (payload.hasMetadata) {
      updates.metadata = mergePostMetadata(existing.metadata ?? {}, payload.updates.metadata);
    }

    // ── 5. Ecriture, sous controle optimiste ───────────────────────
    //
    // `.eq('user_id', session.user.id)` est REDONDANT avec le controle
    // ci-dessus, et c'est voulu : entre la lecture et l'ecriture, la ligne
    // pourrait changer de main. Le `WHERE` garantit qu'aucune ecriture ne
    // touche jamais la ligne d'un autre, meme sur un decalage.
    //
    // La garde de version reprend la strategie validee sur
    // `PATCH /api/posts/[id]` : `scheduled_posts` porte un declencheur
    // `BEFORE UPDATE` qui remet `updated_at` a `NOW()`
    // (`002_complete_schema.sql`), ce qui en fait un jeton de version sans
    // migration. Elle ne s'applique qu'aux requetes portant `metadata` —
    // elles seules sont des lire-modifier-ecrire. Si `updated_at` n'est pas
    // exploitable, on se degrade vers le comportement d'avant, jamais vers un
    // faux conflit.
    const versionToken =
      typeof existing.updated_at === 'string' && existing.updated_at.length > 0
        ? existing.updated_at
        : null;
    const guarded = payload.hasMetadata && versionToken !== null;

    let query = supabase
      .from('scheduled_posts')
      .update(updates)
      .eq('id', payload.id)
      .eq('user_id', session.user.id);
    if (guarded) query = query.eq('updated_at', versionToken);

    const { data, error } = await query.select();

    if (error) {
      console.error('[API] Post update error:', error);
      return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      if (guarded) {
        return NextResponse.json(
          {
            success: false,
            error: 'Le post a ete modifie entre-temps. Rechargez-le et reessayez.',
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }

    // Meme forme de reponse qu'avant : `{ success: true, post: <ligne> }`.
    // `message` n'apparait que si des champs ont ete ecartes.
    return NextResponse.json({
      success: true,
      post: data[0],
      ...(payload.ignored.length > 0
        ? {
            message: `Champs ignores (non modifiables) : ${payload.ignored.join(
              ', ',
            )}. Modifiables : ${PUT_ALLOWED_COLUMNS.join(', ')}.`,
          }
        : {}),
    });
  } catch (error) {
    console.error('Error updating post:', error);
    return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
  }
}

// DELETE /api/posts?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Post ID required' }, { status: 400 });
    }

    // Fetch the post first to collect every Supabase Storage URL stored in
    // its metadata (rush, montage, audio, thumbnail, poster, character,
    // ...). The row delete cascades to the helper below — fire-and-forget,
    // so a slow / failing storage call doesn't block the user's UI.
    const { data: postRow } = await supabase
      .from('scheduled_posts')
      .select('metadata')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();

    const { error } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);

    if (error) throw error;

    // Cascade delete the post's storage files. Wrapped in setImmediate so
    // the response goes back to the client without waiting on the storage
    // round-trips. Errors land in the server logs.
    if (postRow?.metadata) {
      const toutes = collectStorageUrlsFromPost(postRow.metadata as Record<string, unknown>);
      // ⚠️ LE RUSH N'APPARTIENT PAS AU POST. Chaque montage de l'Autopilote
      // porte dans ses metadonnees le rush de la BANQUE, partage par tous les
      // cycles. Supprimer un brouillon emportait donc le rush, et
      // l'Autopilote se retrouvait sans source — 404 au cycle suivant. C'est
      // ce qui a vide la mediatheque.
      // `null` = banque illisible : on épargne TOUS les rushes du post
      // plutôt que de risquer d'emporter celui de la banque.
      const banque = await autopilotRushKeys();
      const rushesDuPost = new Set(
        (Array.isArray((postRow.metadata as Record<string, unknown>)?.rushUrls)
          ? ((postRow.metadata as Record<string, unknown>).rushUrls as unknown[])
          : []
        ).map((u) => storageKey(typeof u === 'string' ? u : null)).filter(Boolean) as string[],
      );
      const urls = toutes.filter((u) => {
        const k = storageKey(u);
        if (k && (banque ? banque.has(k) : rushesDuPost.has(k))) {
          console.log(`[POST DELETE id=${id}] rush de la banque Autopilote conserve : ${k}`);
          return false;
        }
        return true;
      });
      if (urls.length > 0) {
        deleteStorageFiles(urls, `[POST DELETE id=${id}]`)
          .then(({ removed, failed }) => {
            console.log(`[POST DELETE id=${id}] storage cleanup: removed=${removed} failed=${failed.length}`);
          })
          .catch((err) => {
            console.error(`[POST DELETE id=${id}] storage cleanup unexpected error:`, err);
          });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting post:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete post' }, { status: 500 });
  }
}
