import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  cleSourceAvatarDuCompte, ouvrirSourceAvatar, typeSourceAvatar,
} from '@/lib/avatar/source';

/**
 * A_8b — LA SOURCE D'UN AVATAR, SERVIE PAR L'APPLICATION.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE NAVIGATEUR PEUT DEMANDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * UN identifiant d'avatar, et rien d'autre. Ni compartiment, ni cle, ni
 * chemin : ces parametres n'existent pas, ni dans l'URL, ni dans une chaine de
 * requete, ni dans un corps qui n'est jamais lu. La cle est LUE dans la ligne
 * `user_avatars`, relue sous le compte de la session.
 *
 * C'est toute la difference avec le lien public qu'elle remplace : il n'y a
 * pas de cle a valider, parce qu'aucune cle ne peut entrer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE REMPLACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `create` posait un `getPublicUrl` sur la photo — ou les deux a cinq minutes
 * de footage — du visage de la personne, et rangeait cette URL en base. Le
 * relais public sert tout objet d'un compartiment autorise SANS SESSION : le
 * lien etait permanent et irrevocable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 404 PARTOUT, ET C'EST VOLONTAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avatar inconnu, avatar d'autrui, source jamais enregistree, objet disparu :
 * une seule et meme reponse. Un 403 sur l'avatar d'un tiers confirmerait son
 * existence ; un code distinct par cause laisserait enumerer.
 *
 * Le 404 est aussi ce qui ARRETE l'ecran : il retient l'echec et ne redemande
 * plus. Une source illisible ne doit pas couter une requete a chaque rendu.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const introuvable = () => NextResponse.json(
  { ok: false, error: 'Source introuvable' }, { status: 404 },
);

/**
 * ⚠️ `Content-Type` DECIDE PAR NOUS, jamais lu sur l'objet : MinIO pose
 * `application/octet-stream` des qu'un televersement n'a rien declare, et s'y
 * fier laisserait servir en HTML, depuis notre origine, un fichier depose par
 * un autre chemin. `nosniff` ferme la seconde moitie de la porte, la CSP la
 * troisieme.
 *
 * ⚠️ `no-store` : la reponse depend de la session, et son contenu est un
 * visage. Un cache partage — navigateur commun, intermediaire — la servirait a
 * qui n'y a pas droit.
 */
function entetes(typeContenu: string): Record<string, string> {
  return {
    'Content-Type': typeContenu,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store, max-age=0',
  };
}

export async function GET(
  _req: NextRequest, { params }: { params: { id: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    /* ⚠️ LA PROPRIETE AVANT LE STOCKAGE. Interroger MinIO sur la cle d'un tiers,
       meme pour refuser ensuite, ferait de cette route un revelateur
       d'existence. Le filtre est DANS la requete : l'avatar d'autrui ne revient
       pas, donc il n'y a rien a decider ensuite. */
    const { data, error } = await supabaseAdmin
      .from('user_avatars')
      .select('id, source_object_key')
      .eq('id', params.id ?? '')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      // Socle absent ou base muette : on ne distingue pas a l'ecran. Le detail
      // n'aiderait personne et renseignerait sur l'infrastructure.
      return introuvable();
    }
    if (!data) return introuvable();

    const cle = (data as { source_object_key?: unknown }).source_object_key;
    /* Revalidee malgre la lecture filtree : la cle a ete ecrite par une autre
       version du code, et une ligne ancienne peut porter autre chose qu'une
       cle du namespace de son proprietaire. */
    if (!cleSourceAvatarDuCompte(cle, userId)) return introuvable();

    const typeContenu = typeSourceAvatar(cle);
    if (typeContenu === null) return introuvable();

    let flux: NodeJS.ReadableStream;
    try {
      flux = await ouvrirSourceAvatar(cle);
    } catch {
      return introuvable();
    }

    // Les octets vont du stockage a la reponse sans etre materialises : ni
    // `Buffer`, ni fichier temporaire.
    const corps = Readable.toWeb(Readable.from(flux)) as ReadableStream;
    return new NextResponse(corps, { status: 200, headers: entetes(typeContenu) });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin ou une cle.
    return introuvable();
  }
}
