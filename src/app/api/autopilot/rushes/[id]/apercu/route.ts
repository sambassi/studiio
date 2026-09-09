import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth/config';
import { lireRush } from '@/lib/autopilot/tournage/service';
import {
  apercuDejaLa, cleApercuRush, ouvrirApercu, produireApercuRush, TYPE_APERCU,
} from '@/lib/autopilot/analyse/vignette-rush';

/**
 * L'aperçu d'un rush — une image, servie par l'application.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE NAVIGATEUR PEUT DEMANDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * UN identifiant de rush, et rien d'autre. Ni compartiment, ni clé, ni
 * chemin : ces paramètres n'existent pas, ni dans l'URL, ni dans un corps qui
 * n'est jamais lu. La clé de l'objet est LUE dans la ligne `rushes`, relue
 * sous le compte de la session. C'est la même règle que les vignettes
 * d'analyse, et elle ferme la même porte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CETTE ROUTE EST LE SECOND RECOURS, PAS LE PREMIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Quand l'analyse a produit des vignettes, la carte prend la vignette 0 : elle
 * est déjà là, déjà payée. Cette route existe pour l'autre cas — un rush
 * lisible dont l'analyse n'a produit AUCUNE image. Jusqu'ici il n'y avait rien
 * à afficher pour lui ; il y a maintenant une image de son propre contenu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 404 PARTOUT, ET C'EST VOLONTAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rush inconnu, rush d'autrui, objet disparu : une seule et même réponse. Un
 * 403 sur le rush d'un tiers confirmerait son existence.
 *
 * Le 404 est aussi ce qui ARRÊTE la carte : elle retient l'échec et ne
 * redemande plus. Une image impossible ne doit pas coûter une requête à chaque
 * rendu de la bande.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const introuvable = () => NextResponse.json(
  { ok: false, error: 'Aperçu introuvable' }, { status: 404 },
);

/**
 * `Content-Type` est DÉCIDÉ ici, jamais lu sur l'objet : un fichier déposé par
 * un autre chemin ne doit pas pouvoir se faire servir en HTML depuis notre
 * origine. `nosniff` ferme la seconde moitié de la porte, `default-src 'none'`
 * la troisième.
 *
 * ⚠️ `no-store` MALGRÉ LE CACHE D'OBJET. Les deux caches ne protègent pas la
 * même chose : l'objet évite de RECALCULER l'image, cet en-tête évite qu'un
 * intermédiaire la serve à qui n'a pas la session.
 */
const ENTETES_IMAGE: Record<string, string> = {
  'Content-Type': TYPE_APERCU,
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function GET(
  _req: NextRequest, { params }: { params: { id: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    /* La propriété AVANT le stockage, comme partout : interroger MinIO sur la
       clé d'un tiers, même pour refuser ensuite, ferait de cette route un
       révélateur d'existence. */
    const { rush, motif } = await lireRush(userId, params.id ?? '');
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: 'Rushes indisponibles sur ce serveur.', motif }, { status: 503 },
      );
    }
    if (!rush) return introuvable();

    const cle = cleApercuRush(userId, rush.id);

    /* ⚠️ LE CACHE EST ICI, ET IL TIENT EN UNE QUESTION. Présent, on sert ;
       absent, on produit UNE fois. Dix cartes à l'écran ne lancent donc pas
       dix ffmpeg à chaque rendu : le rendu suivant ne trouve plus rien à
       produire. */
    if (!(await apercuDejaLa(cle))) {
      const { apercu } = await produireApercuRush(userId, rush.id, {
        bucket: rush.bucket,
        cleObjet: rush.cleObjet,
        dureeSecondes: rush.dureeSecondes,
      });
      // Objet disparu, stockage muet, rush sans image exploitable : la carte
      // retombe sur sa pellicule, et ne redemande pas.
      if (!apercu) return introuvable();
    }

    let flux: NodeJS.ReadableStream;
    try {
      flux = await ouvrirApercu(cle);
    } catch {
      return introuvable();
    }

    const corps = Readable.toWeb(Readable.from(flux)) as ReadableStream;
    return new NextResponse(corps, { status: 200, headers: ENTETES_IMAGE });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture d’aperçu impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
