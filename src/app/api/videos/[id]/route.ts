import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { parsePutVideoPayload } from '@/lib/videos/put-payload';
import { mergeVideoMetadata } from '@/lib/videos/metadata';

// GET /api/videos/[id] - Get a single video
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
  }
}

// PUT /api/videos/[id] - Update a video
//
// Ce que cette route ecrivait avant : `.update(body)`, la charge utile
// entiere. Le `WHERE user_id = <session>` bornait la LIGNE mais pas les
// COLONNES — `credits_used`, `render_job_id`, `status`, `video_url` et
// `user_id` etaient donc reecrivables par le client. La liste blanche vit
// dans `@/lib/videos/put-payload`, avec le detail de chaque exclusion.
//
// GET et DELETE ci-dessus et ci-dessous ne sont PAS touches.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // ── 1. Authentification ────────────────────────────────────────
    // L'identite ne vient QUE de la session : aucun `user_id`, `owner_id`,
    // `email` ou `role` du corps n'est consulte — la liste blanche les a de
    // toute facon deja ecartes.
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
    // reveler de la ligne visee. Le filtrage des champs interdits, lui, est
    // SILENCIEUX — seuls un corps non-objet et une cle de detournement de
    // prototype provoquent un refus.
    const payload = parsePutVideoPayload(raw);
    if (!payload.ok) {
      return NextResponse.json(
        { success: false, error: payload.error },
        { status: payload.status },
      );
    }

    // ── 3. Chargement et controle du proprietaire ──────────────────
    // Lecture SANS filtre `user_id`, pour distinguer « la video n'existe
    // pas » (404) de « elle ne vous appartient pas » (403) : l'ancienne
    // version confondait les deux dans un 500 opaque. `select('*')` parce
    // que la ligne complete est ce que la reponse renvoie — y compris quand
    // il n'y a rien a ecrire.
    const { data: existing, error: readError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();

    if (readError) {
      console.error('[API] Video read error:', readError);
      return NextResponse.json({ success: false, error: 'Failed to update video' }, { status: 500 });
    }
    if (!existing) {
      // Aucune creation implicite : un identifiant inconnu est une erreur.
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }
    if (existing.user_id !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // ── 4. Rien a ecrire : on n'ecrit rien ─────────────────────────
    // Un client qui renvoie la ligne entiere sans y avoir touche, ou qui
    // n'envoie que des champs serveur, ne doit declencher AUCUN UPDATE. La
    // ligne actuelle est renvoyee telle quelle, dans la forme habituelle :
    // la reponse reste vraie — c'est bien l'etat de la video.
    if (Object.keys(payload.updates).length === 0) {
      return NextResponse.json({ success: true, data: existing });
    }

    // ── 5. Fusion des metadonnees ──────────────────────────────────
    // Jamais de remplacement : un fragment n'ecrase pas tout le `metadata`.
    // Voir `@/lib/videos/metadata` pour ce que `videos` partage — et ne
    // partage pas — avec le contrat canonique des posts.
    const updates: Record<string, unknown> = { ...payload.updates };
    if (payload.hasMetadata) {
      updates.metadata = mergeVideoMetadata(existing.metadata, payload.updates.metadata);
    }

    // ── 6. Ecriture, sous controle optimiste ───────────────────────
    //
    // `.eq('user_id', session.user.id)` est REDONDANT avec le controle du
    // point 3, et c'est voulu : entre la lecture et l'ecriture la ligne
    // pourrait changer de main. Le `WHERE` garantit qu'aucune ecriture ne
    // touche jamais la ligne d'un autre, meme sur un decalage.
    //
    // La garde de version reprend la strategie de `PUT /api/posts` :
    // `videos` porte le declencheur `update_videos_updated_at`
    // (`002_complete_schema.sql`), ce qui fait de `updated_at` un jeton de
    // version sans migration. Elle ne s'applique qu'aux requetes portant
    // `metadata` — elles seules sont des lire-modifier-ecrire, donc les
    // seules exposees a une mise a jour perdue. Si le jeton n'est pas
    // exploitable, on se degrade vers le comportement d'avant, jamais vers
    // un faux conflit.
    const versionToken =
      typeof existing.updated_at === 'string' && existing.updated_at.length > 0
        ? existing.updated_at
        : null;
    const guarded = payload.hasMetadata && versionToken !== null;

    let query = supabase
      .from('videos')
      .update(updates)
      .eq('id', params.id)
      .eq('user_id', session.user.id);
    if (guarded) query = query.eq('updated_at', versionToken);

    const { data, error } = await query.select();

    if (error) {
      console.error('[API] Video update error:', error);
      return NextResponse.json({ success: false, error: 'Failed to update video' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      if (guarded) {
        return NextResponse.json(
          {
            success: false,
            error: 'La video a ete modifiee entre-temps. Rechargez-la et reessayez.',
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    // Meme forme de reponse qu'avant : `{ success: true, data: <ligne> }`.
    return NextResponse.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('Error updating video:', error);
    return NextResponse.json({ success: false, error: 'Failed to update video' }, { status: 500 });
  }
}

// DELETE /api/videos/[id] - Delete a video
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', params.id)
      .eq('user_id', session.user.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete video' }, { status: 500 });
  }
}
