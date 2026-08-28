import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { politiqueDeLUtilisateur, consommeDesCredits, LIBELLE_PARTENAIRES } from '@/lib/facturation/politique';
import { FORMATS } from '@/lib/rendus/service';

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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST LU, ET CE QUI SORT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux tables sont lues, cote serveur : `tarifs_rendu` pour les prix, et
 * `users.role` — du seul compte de la session, via `politiqueDeLUtilisateur`
 * — pour savoir s'il y a un prix a annoncer. Cette seconde lecture est
 * necessaire : sans elle, un administrateur verrait « 20 crédits » pour une
 * serie qui ne lui en coutera aucun.
 *
 * Rien de `users` ne ressort. La reponse porte deux nombres et la politique
 * DERIVEE (`credits` / `partner_cost_only`) : ni role brut, ni identifiant,
 * ni e-mail, ni solde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LISTE FERMEE, ET PAS DE RECOPIE DYNAMIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La reponse etait construite en recopiant CHAQUE cle trouvee en base
 * (`tarifs[ligne.format] = ligne.credits`). Aucune entree client n'y
 * arrivait, donc ce n'etait pas une faille — mais une ligne ajoutee en base,
 * un jour, serait sortie telle quelle vers le navigateur, `__proto__`
 * compris.
 *
 * Les prix sont desormais collectes dans une `Map` — qui n'a pas de
 * prototype a polluer — filtree par `FORMATS`, et la reponse est construite
 * LITTERALEMENT avec `reel` et `tv`. Le filtre SQL en amont est un confort ;
 * c'est la liste fermee qui protege, et elle tiendrait meme s'il sautait.
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
      .from('tarifs_rendu').select('format, credits')
      // Filtre de confort : la garde qui compte est la liste fermee ci-dessous.
      .in('format', [...FORMATS]);

    if (error || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { ok: false, politique, tarifs: null, error: 'tarifs indisponibles' },
        { status: 503 },
      );
    }

    // Une `Map` et non un objet : rien a polluer, et aucune cle ne devient
    // une propriete. Seuls les formats de `FORMATS` y entrent.
    const connus = new Map<string, number>();
    for (const ligne of data as Array<{ format?: unknown; credits?: unknown }>) {
      const f = ligne.format;
      const c = ligne.credits;
      if (typeof f !== 'string' || typeof c !== 'number' || !Number.isFinite(c)) continue;
      if (!(FORMATS as readonly string[]).includes(f)) continue;
      connus.set(f, c);
    }

    const reel = connus.get('reel');
    const tv = connus.get('tv');

    // Un tarif partiel n'est pas un tarif : mieux vaut l'avouer que d'afficher
    // un prix pour un format et rien pour l'autre.
    if (typeof reel !== 'number' || typeof tv !== 'number') {
      return NextResponse.json(
        { ok: false, politique, tarifs: null, error: 'tarifs incomplets' },
        { status: 503 },
      );
    }

    // Construite LITTERALEMENT : deux nombres, et rien d'autre ne peut s'y
    // glisser depuis la base.
    return NextResponse.json({ ok: true, politique, tarifs: { reel, tv } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'tarifs indisponibles';
    return NextResponse.json({ ok: false, tarifs: null, error: message }, { status: 500 });
  }
}
