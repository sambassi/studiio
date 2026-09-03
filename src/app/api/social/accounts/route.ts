import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

/**
 * Les colonnes qu'un navigateur a le droit de recevoir.
 *
 * ---------------------------------------------------------------------------
 * LISTE BLANCHE, ET JAMAIS `*`
 * ---------------------------------------------------------------------------
 *
 * Cette route rendait `select('*')`. La ligne `social_accounts` porte
 * `access_token` et `refresh_token` : le jeton de publication Meta, TikTok et
 * YouTube partait donc en clair dans une reponse JSON, et l'ecran des reseaux
 * le recopiait dans `localStorage` (`studiio_social_accounts`), ou il
 * survivait a la session.
 *
 * L'ecran n'en avait aucun besoin. Son propre type `SocialAccount`
 * (`dashboard/social/page.tsx`) ne declare que `platform`, `username`,
 * `connected` et `connectedAt` : il n'a jamais lu un jeton. C'etait un secret
 * de BACKEND qui voyageait avec une information d'INTERFACE.
 *
 * CE QUI RESTE, ET POURQUOI. `account_id` et `account_name` nomment le compte
 * a l'ecran, `expires_at` est une date et non un pouvoir, `connected` est
 * l'etat affiche. Aucune de ces valeurs ne permet de publier quoi que ce soit.
 *
 * NE JAMAIS REVENIR A `*`, meme « le temps de deboguer ». Un jeton rendu une
 * fois est un jeton a revoquer : il a traverse le reseau, le cache du
 * navigateur et, ici, le stockage local du poste.
 */
export const COLONNES_COMPTE_PUBLIQUES = [
  'id', 'user_id', 'platform', 'account_id', 'account_name',
  'connected', 'expires_at', 'created_at', 'updated_at',
] as const;

/** La meme liste, sous la forme attendue par PostgREST. */
export const SELECT_COMPTE_PUBLIC = COLONNES_COMPTE_PUBLIQUES.join(', ');

export async function GET(_req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from('social_accounts')
      .select(SELECT_COMPTE_PUBLIC)
      .eq('user_id', session.user.id);

    if (error) throw error;

    return NextResponse.json({ success: true, accounts: data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch social accounts' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { data, error } = await supabase
      .from('social_accounts')
      .insert({
        ...body,
        user_id: session.user.id,
      })
      .select(SELECT_COMPTE_PUBLIC)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to connect social account' },
      { status: 500 }
    );
  }
}
