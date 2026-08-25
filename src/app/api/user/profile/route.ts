import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';
import { PROFILE_ALLOWED_FIELDS, parseProfilePayload } from '@/lib/user/profile-payload';

export async function GET(_req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user.email)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user/profile — mise a jour du profil de L'UTILISATEUR CONNECTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A CHANGE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le gestionnaire faisait `.update(body)` avec le corps client brut, via
 * `supabaseAdmin` — la cle de service, qui contourne toute RLS — sur la table
 * `users`. Tout compte connecte pouvait donc s'ecrire :
 *
 *   - `credits`   → credits gratuits, sans trace dans `credit_transactions` ;
 *   - `plan`      → offre payante sans paiement ;
 *   - `role`      → sans effet aujourd'hui (`isAdmin` compare des e-mails),
 *                   mais elevation immediate le jour ou `users.role` sera lu ;
 *   - `blocked`   → levee de bannissement ;
 *   - `email`     → desynchronisation de l'identite : `resolveUserId`
 *                   (`lib/auth/config.ts:25`) retrouve la ligne PAR e-mail ;
 *   - `stripe_customer_id` → `api/stripe/create-portal/route.ts:13` lit cette
 *                   colonne en PREMIER pour ouvrir le portail de facturation.
 *                   S'attribuer l'identifiant client d'un tiers donnait acces
 *                   a ses factures et a ses moyens de paiement.
 *
 * Desormais, un seul champ est modifiable — `avatar_url` — et rien d'autre
 * n'atteint PostgREST. La cible reste l'e-mail de la SESSION serveur : aucun
 * identifiant fourni par le client n'est lu, ni utilise pour cibler la ligne.
 *
 * Le GET n'est pas touche.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    // ── 1. Session ─────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Corps JSON invalide' },
        { status: 400 }
      );
    }

    // ── 2. Validation ──────────────────────────────────────────────
    // Avant toute requete : un corps refuse ne doit rien couter, et surtout
    // ne rien reveler de la ligne visee.
    const payload = parseProfilePayload(raw);
    if (!payload.ok) {
      return NextResponse.json(
        {
          success: false,
          error: payload.error,
          ...(payload.ignored.length > 0
            ? { message: `Champs ignores (non modifiables ici) : ${payload.ignored.join(', ')}` }
            : {}),
        },
        { status: 422 }
      );
    }

    // ── 3. Ecriture ────────────────────────────────────────────────
    // `payload.updates` ne peut contenir que les cles de
    // PROFILE_ALLOWED_FIELDS : c'est le seul objet transmis a PostgREST.
    // `credits`, `plan`, `role`, `email`, `stripe_customer_id` n'y figurent
    // jamais, quelle que soit la charge utile recue.
    //
    // Ciblage par l'e-mail de session, comme le GET. `.update()` ne cree
    // jamais de ligne : un compte inexistant renvoie zero ligne, pas un
    // nouvel utilisateur.
    const { data, error } = await supabase
      .from('users')
      .update(payload.updates)
      .eq('email', session.user.email)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Meme forme de reponse qu'avant : `{ success: true, data: <ligne> }`.
    // `message` n'apparait que si des champs ont ete ecartes — il rend le
    // filtrage observable au lieu de le laisser silencieux.
    return NextResponse.json({
      success: true,
      data: data[0],
      ...(payload.ignored.length > 0
        ? {
            message: `Champs ignores (non modifiables ici) : ${payload.ignored.join(
              ', '
            )}. Modifiable : ${PROFILE_ALLOWED_FIELDS.join(', ')}.`,
          }
        : {}),
    });
  } catch (error) {
    // Le detail part dans les journaux, jamais dans la reponse.
    console.error('[API] Error updating profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
