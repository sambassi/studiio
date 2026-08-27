import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  politiqueDeLUtilisateur, consommeDesCredits, LIBELLE_PARTENAIRES,
} from '@/lib/facturation/politique';

/**
 * Le solde, ou l'aveu qu'il n'y en a pas.
 *
 * Cette route renvoyait `999_999_999` aux administrateurs -- un nombre
 * invente, cense signifier « illimite ». Il ne l'etait pas : c'etait un
 * mensonge d'affichage, et depuis que le debit passe par le socle atomique,
 * un mensonge DANGEREUX. Le socle lit la vraie colonne `users.credits` et ne
 * connait aucune exception ; l'ecran annoncait donc un solde quasi infini
 * pendant qu'un debit reel aurait pu echouer sur solde insuffisant.
 *
 * Sous `partner_cost_only`, il n'y a pas de solde a montrer. On rend `null`
 * et un libelle, jamais un nombre.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { ok: false, balance: null, error: 'Unauthorized' }, { status: 401 },
      );
    }

    const { politique } = await politiqueDeLUtilisateur(session.user.id);

    if (!consommeDesCredits(politique)) {
      return NextResponse.json({
        ok: true,
        politique,
        balance: null,
        libelle: LIBELLE_PARTENAIRES,
      });
    }

    const { data, error } = await supabaseAdmin
      .from('users').select('credits').eq('id', session.user.id).maybeSingle();

    if (error || !data) {
      // Indisponible, et on le dit. Un `0` invente ferait croire a un solde
      // vide et enverrait l'utilisateur acheter des credits qu'il possede.
      return NextResponse.json(
        { ok: false, politique, balance: null, error: 'solde indisponible' },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      politique,
      balance: typeof data.credits === 'number' ? data.credits : 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, balance: null, error: message }, { status: 500 });
  }
}
