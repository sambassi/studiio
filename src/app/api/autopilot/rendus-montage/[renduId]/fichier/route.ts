/**
 * M3-H — LES OCTETS DU MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI UN RELAIS AUTHENTIFIÉ, ET NON UNE URL SIGNÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le dépôt n'a AUCUN signeur de lecture qu'un navigateur puisse atteindre.
 * `signeurInterne` produit une adresse sur le nom interne du stockage, dont
 * sa propre documentation dit qu'elle « ne doit JAMAIS sortir du serveur » ;
 * `signeurPublic` ne sait signer qu'un dépôt. Le relais public existant, lui,
 * répond SANS session — irréductiblement, puisque les serveurs de Meta et de
 * TikTok viennent chercher les fichiers eux-mêmes — et il bloque déjà le
 * domaine des vignettes d'analyse pour exactement cette raison.
 *
 * La convention du dépôt pour servir un octet privé est donc celle-ci : une
 * route qui exige une session et refait le contrôle de propriété, comme le
 * fait déjà la lecture des vignettes. Rien à faire expirer, aucun jeton à
 * révoquer, et un accès qui s'éteint avec la session plutôt qu'à une heure
 * fixée d'avance.
 *
 * ⚠️ LE COMPARTIMENT ET LA CLÉ VIENNENT DE LA BASE. Le navigateur n'envoie
 * qu'un identifiant de rendu ; il ne peut désigner ni l'un ni l'autre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { CONTENT_TYPE_RENDU, cleValide } from '@/lib/autopilot/analyse/rendu-contrat';
import { diagnosticRendu, ouvrirRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { lireRenduParId } from '@/lib/autopilot/analyse/rendu-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Un relais d'octets : le temps du transfert, pas celui d'un rendu. */
export const maxDuration = 300;

/**
 * ⚠️ LE TYPE EST DÉCIDÉ ICI, jamais lu sur l'objet.
 *
 * Le relais de stockage documente la panne que cela évite : un compte qui
 * déposerait un `.html` en `text/html` le ferait servir depuis la MÊME
 * ORIGINE que la session — un script stocké. `nosniff` et une disposition
 * explicite ferment les deux moitiés restantes.
 */
const ENTETES = {
  'Content-Type': CONTENT_TYPE_RENDU,
  'Content-Disposition': 'inline; filename="montage.mp4"',
  'X-Content-Type-Options': 'nosniff',
  // Le troisième verrou de la route des vignettes : même si le type était un
  // jour détourné, la page servie ne pourrait rien charger ni exécuter.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
  // Le relais lit l'objet d'un bloc : il ne sait pas répondre à une requête
  // partielle, et le dire évite qu'un lecteur croie pouvoir s'y déplacer.
  'Accept-Ranges': 'none',
} as const;

const introuvable = () => NextResponse.json(
  { ok: false, error: 'Rendu introuvable' }, { status: 404 },
);

export async function GET(
  _req: NextRequest, { params }: { params: { renduId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!identifiantValide(params.renduId)) return introuvable();

    const { rendu } = await lireRenduParId(session.user.id, params.renduId);
    // Inconnu, d'autrui, pas encore abouti : une seule et même réponse. Dire
    // « pas encore prêt » renseignerait sur le travail d'un tiers.
    if (!rendu || rendu.etat !== 'reussie' || !rendu.resultat) return introuvable();

    // ⚠️ LA CLÉ EST REVALIDÉE MÊME VENANT DE LA BASE. Une ligne écrite par
    // une version future, ou par une main, ne doit pas pouvoir faire lire
    // l'espace d'un tiers — c'est le même geste qu'à l'écriture.
    if (!cleValide(rendu.resultat.cle, session.user.id)) return introuvable();

    const flux = await ouvrirRendu(rendu.resultat.bucket, rendu.resultat.cle);
    if (!flux) return introuvable();

    // ⚠️ LA CONVERSION EXPLICITE DU DÉPÔT, et non un cast. La route des
    // vignettes fait exactement ce geste pour le même client de stockage : un
    // `Readable` de Node n'est pas un flux web, et s'en remettre à ce qu'un
    // runtime veut bien accepter n'est pas un contrat.
    return new NextResponse(Readable.toWeb(Readable.from(flux)) as ReadableStream, {
      status: 200,
      headers: { ...ENTETES, 'Content-Length': String(rendu.resultat.octets) },
    });
  } catch (e: unknown) {
    console.error(
      `[autopilote][rendu] lecture impossible : ${diagnosticRendu(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
