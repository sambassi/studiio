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

/**
 * IL N'Y A PAS DE `POST` ICI, ET C'EST LE CORRECTIF.
 *
 * ---------------------------------------------------------------------------
 * CE QUE FAISAIT L'ANCIENNE VERSION
 * ---------------------------------------------------------------------------
 *
 *     .insert({ ...body, user_id: session.user.id })
 *
 * Une affectation de masse : le corps HTTP choisissait les colonnes. Le
 * `user_id` etait bien impose par la session — donc personne ne pouvait creer
 * une connexion au nom d'un tiers — mais tout le reste de la ligne etait
 * pilotable, `access_token` et `refresh_token` compris. Un compte pouvait
 * ainsi ecrire dans SA propre ligne un jeton arbitraire, que le cron aurait
 * ensuite presente a Meta, TikTok ou YouTube. La table porte aussi
 * `connected` et `expires_at`, qui gouvernent la selection du compte a la
 * publication et le rafraichissement.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI LA RETIRER PLUTOT QUE LA FILTRER
 * ---------------------------------------------------------------------------
 *
 * Une liste blanche d'ecriture aurait suppose qu'un navigateur ait quelque
 * chose de legitime a declarer ici. Il n'a rien : une connexion sociale N'EST
 * PAS declaree, elle est le RESULTAT d'un echange OAuth. Le seul champ qu'un
 * client pourrait fournir sans absurdite est `platform`, et une ligne
 * `platform` sans jeton est une connexion morte que `/api/social/status`
 * ecarterait aussitot.
 *
 * Le vrai chemin de creation est ailleurs, et il est complet :
 * `/api/social/callback` fait son `upsert` avec une liste de colonnes
 * NOMMEE, sur `onConflict: 'user_id,platform'`, a partir des valeurs rendues
 * par la plateforme. Il n'appelle pas cette route, et rien d'autre ne le fait
 * — verifie sur tout le depot : le seul appel a `/api/social/accounts` est le
 * `fetch` de lecture de `dashboard/social/page.tsx`.
 *
 * Sans export `POST`, Next.js repond `405 Method Not Allowed`. La surface
 * d'ecriture n'existe plus du tout, plutot que d'exister sous surveillance.
 *
 * SI UN JOUR UN BESOIN APPARAIT — une connexion saisie a la main, un import —
 * il ne se reouvre PAS ici : il passe par une route dediee, avec sa liste
 * blanche nommee et son propre test. Cette route-ci lit, et rien d'autre.
 */
