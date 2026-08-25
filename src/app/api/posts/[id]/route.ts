import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { mergePostMetadata } from '@/lib/creer/postMetadata';
import { parsePatchPostPayload } from '@/lib/posts/patch-payload';

// GET /api/posts/[id] — fetch a single post by ID
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing post ID' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();

    if (error) {
      console.error('[API] Post fetch error:', error);
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[API] Error fetching post:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch post' }, { status: 500 });
  }
}

/**
 * PATCH /api/posts/[id] — mise a jour PARTIELLE d'un post.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A CHANGE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La version precedente faisait `.update(body)` avec le corps brut. Sur une
 * colonne `jsonb`, cela REMPLACE la valeur entiere : envoyer
 * `{ metadata: { musicUrl: '…' } }` effacait `posterUrl`, `design`,
 * `sequences`, `cards`, `branding` — tout. La perte etait silencieuse et
 * irrattrapable : la colonne n'a pas d'historique.
 *
 * Desormais, quand `metadata` est present, il est FUSIONNE dans l'existant
 * via le contrat canonique (`lib/creer/postMetadata`) : ce que le client envoie
 * ecrase, ce qu'il n'envoie pas survit — y compris les cles que personne ne
 * declare.
 *
 * Le contrat public ne bouge pas : memes champs acceptes qu'avant pour les
 * appelants du depot, meme forme de reponse `{ success, data }`.
 *
 * Ce que cette route ne fait toujours pas, et ne doit jamais faire : debiter
 * des credits, composer une video, publier, ou creer un post. Elle lit une
 * ligne et en met a jour une.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── 1. Authentification ────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing post ID' }, { status: 400 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Corps JSON invalide' }, { status: 400 });
    }

    // ── 2. Validation de la charge utile ───────────────────────────
    // Avant toute lecture en base : un payload refuse ne doit rien couter.
    const payload = parsePatchPostPayload(raw);
    if (!payload.ok) {
      return NextResponse.json(
        { success: false, error: payload.error, details: payload.details },
        { status: 422 },
      );
    }

    // ── 3. Chargement de la ligne existante ────────────────────────
    // Sans filtre sur `user_id` : c'est ce qui permet de distinguer « le post
    // n'existe pas » (404) de « il ne vous appartient pas » (403). L'ancienne
    // version confondait les deux dans un 500.
    const { data: existing, error: readError } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, metadata, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) {
      console.error('[API] Post read error:', readError);
      return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
    }
    if (!existing) {
      // Aucune creation implicite : un identifiant inconnu est une erreur,
      // jamais une invitation a inserer une ligne.
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }

    // ── 4. Autorisation ────────────────────────────────────────────
    // Contre la SESSION, jamais contre un `user_id` fourni par le client —
    // que le schema refuse d'ailleurs en amont.
    if (existing.user_id !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // ── 5. Fusion ──────────────────────────────────────────────────
    const updates: Record<string, unknown> = { ...payload.data };
    if (payload.hasMetadata) {
      updates.metadata = mergePostMetadata(existing.metadata ?? {}, payload.data.metadata);
    }

    // ── 6. Ecriture, sous controle optimiste ───────────────────────
    //
    // Deux enregistrements simultanes peuvent lire le meme `metadata` : sans
    // garde, la seconde ecriture ecraserait la premiere — le probleme que la
    // fusion seule ne resout PAS.
    //
    // `scheduled_posts` porte un declencheur `BEFORE UPDATE` qui remet
    // `updated_at` a `NOW()` (migration `002_complete_schema.sql`). Cette
    // colonne sert donc de jeton de version, sans migration ni colonne neuve :
    // on n'ecrit que si la ligne n'a pas bouge depuis la lecture.
    //
    // La garde ne s'applique QU'AUX mises a jour portant `metadata` : elles
    // seules sont des lire-modifier-ecrire. Un simple changement d'heure n'a
    // rien a perdre a une ecriture concurrente, et lui imposer un 409 serait
    // une regression pour les traitements par lot du Calendrier.
    //
    // Limite connue, assumee : si le declencheur n'est pas installe sur une
    // base donnee, `updated_at` ne bouge pas, la garde passe toujours et l'on
    // retombe simplement sur le comportement d'avant — jamais sur un faux
    // conflit. Une garde qui se degrade en silence vaut mieux qu'un mecanisme
    // maison greffe sur une colonne qui n'existe pas.
    const versionToken =
      typeof existing.updated_at === 'string' && existing.updated_at.length > 0
        ? existing.updated_at
        : null;
    const guarded = payload.hasMetadata && versionToken !== null;

    let query = supabase
      .from('scheduled_posts')
      .update(updates)
      .eq('id', id)
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
      // Non garde : la ligne a disparu entre la lecture et l'ecriture.
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
    }

    // Meme forme de reponse qu'avant : `{ success: true, data: <ligne> }`.
    return NextResponse.json({ success: true, data: data[0] });
  } catch (error) {
    // Le detail part dans les journaux du serveur, jamais dans la reponse.
    console.error('[API] Error updating post:', error);
    return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
  }
}
