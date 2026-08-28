import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { politiqueDeLUtilisateur, consommeDesCredits, LIBELLE_PARTENAIRES } from '@/lib/facturation/politique';

export const dynamic = 'force-dynamic';

/**
 * Le tarif d'un rendu — tel que le SERVEUR le connait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE ROUTE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'ecran annoncait « 10 crédits seront débités » depuis une constante
 * TypeScript, `COST = { reel: 10, tv: 15 }`. Elle disait vrai — par
 * coincidence : le prix REEL vit dans `public.tarifs_rendu`, et c'est de la
 * que `reserver_rendu` le lit. Les deux pouvaient diverger sans que rien ne
 * le signale, et un pilote de deux videos double l'ecart affiche.
 *
 * Ici, le chiffre montre a l'utilisateur vient de la meme table que celui
 * qui sera preleve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET QUAND ON NE PEUT PAS LE LIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On ne devine pas. La route repond `503` sans tarif, et l'ecran ecrit
 * « Tarif confirmé au rendu » plutot qu'un prix qu'il aurait calcule seul.
 * Un prix invente presente comme certain est pire qu'une absence de prix.
 *
 * Sous `partner_cost_only`, il n'y a pas de tarif en credits a annoncer : on
 * rend la politique et le libelle, jamais un nombre.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { politique } = await politiqueDeLUtilisateur(session.user.id);

    if (!consommeDesCredits(politique)) {
      return NextResponse.json({
        ok: true, politique, tarifs: null, libelle: LIBELLE_PARTENAIRES,
      });
    }

    const { data, error } = await supabaseAdmin
      .from('tarifs_rendu').select('format, credits');

    if (error || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { ok: false, politique, tarifs: null, error: 'tarifs indisponibles' },
        { status: 503 },
      );
    }

    const tarifs: Record<string, number> = {};
    for (const ligne of data as Array<{ format?: unknown; credits?: unknown }>) {
      if (typeof ligne.format === 'string' && typeof ligne.credits === 'number') {
        tarifs[ligne.format] = ligne.credits;
      }
    }

    // Un tarif partiel n'est pas un tarif : mieux vaut l'avouer que d'afficher
    // un prix pour un format et rien pour l'autre.
    if (typeof tarifs.reel !== 'number' || typeof tarifs.tv !== 'number') {
      return NextResponse.json(
        { ok: false, politique, tarifs: null, error: 'tarifs incomplets' },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, politique, tarifs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'tarifs indisponibles';
    return NextResponse.json({ ok: false, tarifs: null, error: message }, { status: 500 });
  }
}
