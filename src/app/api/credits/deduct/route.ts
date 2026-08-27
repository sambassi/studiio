import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { debiterRenduAtomique, referenceRendu, CHAMPS_INTERDITS } from '@/lib/credits/atomique';

/**
 * Debit d'un rendu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE ACCEPTAIT, ET N'ACCEPTE PLUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle lisait `{ cost }` dans le corps et debitait ce montant. Le navigateur
 * choisissait donc ce qu'il payait : `cost: 1` pour un rendu TV facture 15.
 * Aucune borne, aucun lien avec un travail effectue, aucune cle
 * d'idempotence — rejouer la requete debitait deux fois.
 *
 * Le corps ne porte plus qu'un `postId`. Tout le reste est decide ici :
 *
 *   - l'identite vient de la session, jamais du corps ;
 *   - la propriete du post est verifiee avant tout ;
 *   - le format — donc le prix — est lu SUR LE POST, pas recu ;
 *   - le prix vient de `public.tarifs_rendu`, en base ;
 *   - la reference idempotente est construite depuis l'identifiant du post.
 *
 * Un champ `cost`, `amount`, `credits` ou `user_id` n'est pas ignore : il est
 * REFUSE. Un client qui l'envoie encore n'a pas ete migre, et l'ignorer en
 * silence laisserait croire qu'il a ete pris en compte.
 */

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
    }

    const corps = body as Record<string, unknown>;

    const interdit = CHAMPS_INTERDITS.find(
      (c) => Object.prototype.hasOwnProperty.call(corps, c),
    );
    if (interdit) {
      return NextResponse.json(
        { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
        { status: 422 },
      );
    }

    const postId = corps.postId;
    if (typeof postId !== 'string' || postId.length === 0) {
      return NextResponse.json({ ok: false, error: 'postId requis' }, { status: 400 });
    }

    // Propriete AVANT tout : un identifiant appartenant a autrui ne doit ni
    // debiter, ni reveler que ce post existe.
    const { data: post } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id, format, user_id')
      .eq('id', postId)
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (!post) {
      return NextResponse.json({ ok: false, error: 'Post introuvable' }, { status: 404 });
    }

    // Le format est lu SUR LE POST. `reel` par defaut, comme la colonne.
    const format: 'reel' | 'tv' = post.format === 'tv' ? 'tv' : 'reel';

    const resultat = await debiterRenduAtomique(
      session.user.id, format, referenceRendu(post.id),
    );

    if (resultat.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: 'Debit indisponible : migration des credits non appliquee.' },
        { status: 503 },
      );
    }

    // Un rejeu rend le MEME resultat metier que l'appel d'origine — 200, pas
    // une erreur : le client a bien obtenu ce qu'il demandait.
    return NextResponse.json(
      {
        ok: resultat.ok,
        balance: resultat.solde,
        dejaDebite: resultat.dejaDebite,
        motif: resultat.motif,
      },
      { status: resultat.ok ? 200 : 402 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'deduct failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
