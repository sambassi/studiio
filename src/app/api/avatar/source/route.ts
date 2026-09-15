/**
 * GET /api/avatar/source — la source d'enrôlement (photo ou vidéo de
 * référence) de l'avatar ACTIF du compte connecté. Rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE ROUTE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Jusqu'ici la source — le VISAGE de la personne — était servie par le relais
 * public de stockage, sans session, à quiconque possédait l'adresse. Le
 * relais la refuse désormais (`cleSourceAvatarPrivee`) ; c'est ici, et
 * seulement ici, qu'elle se lit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE NAVIGATEUR NE DÉSIGNE RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun identifiant, aucune clé, aucun paramètre n'est lu : ni query, ni
 * corps, ni en-tête. La page peut ajouter `?v=…` pour rafraîchir son cache,
 * la route l'ignore. Le compte vient de la session ; l'avatar vient de la
 * base ; la clé vient de la ligne — et elle est REVALIDÉE
 * (`cleSourceAvatarDuCompte`, dans `ouvrirSourceAvatar`) avant tout appel au
 * stockage, même venant de la base.
 *
 * La clé est `source_object_key` quand la ligne en a une (AVATAR-2A) ; sinon
 * elle est DÉRIVÉE du `source_url` historique par `cleSourceDepuisUrlLegacy`,
 * qui n'accepte que la forme exacte du relais et la même règle de propriété.
 * Rien n'est écrit en base ici.
 *
 * 404 PARTOUT, ET C'EST VOLONTAIRE : pas d'avatar, avatar supprimé, pas de
 * clé, clé d'autrui, vidéo générée, objet absent — une seule et même réponse.
 * Un code distinct dirait ce qui existe.
 */
import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ouvrirSourceAvatar, cleSourceDepuisUrlLegacy } from '@/lib/avatar/source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const introuvable = () => NextResponse.json(
  { success: false, error: 'Source introuvable.' }, { status: 404 },
);

/**
 * Le type est DÉCIDÉ par la clé (`typeSourceAvatar`), jamais lu sur l'objet ;
 * `nosniff`, `inline` et une CSP vide ferment ce que le relais public ferme
 * pour les mêmes raisons (un `.html` déposé ne doit jamais s'exécuter depuis
 * l'origine de la session).
 */
const ENTETES = {
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // L'avatar actif : même ordre que `GET /api/avatar/create` (le plus
    // récent), restreint aux lignes vivantes.
    const { data: lignes } = await supabaseAdmin
      .from('user_avatars')
      .select('id, user_id, source_object_key, source_url, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const avatar = lignes?.[0];
    if (!avatar || avatar.user_id !== userId || avatar.deleted_at !== null) return introuvable();

    const cle = typeof avatar.source_object_key === 'string' && avatar.source_object_key.length > 0
      ? avatar.source_object_key
      : cleSourceDepuisUrlLegacy(avatar.source_url, userId);
    if (!cle) return introuvable();

    let source: Awaited<ReturnType<typeof ouvrirSourceAvatar>>;
    try {
      source = await ouvrirSourceAvatar(userId, cle);
    } catch {
      // Objet absent, stockage injoignable : la même réponse, sans le détail.
      return introuvable();
    }
    if (!source || source.taille <= 0) return introuvable();

    return new NextResponse(Readable.toWeb(Readable.from(source.flux)) as ReadableStream, {
      status: 200,
      headers: {
        ...ENTETES,
        'Content-Type': source.type,
        'Content-Length': String(source.taille),
      },
    });
  } catch (e: unknown) {
    console.error('[Avatar][source] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500 });
  }
}
