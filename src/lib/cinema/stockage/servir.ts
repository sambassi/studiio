/**
 * CINEMA IA — servir un objet PRIVE au navigateur de son proprietaire.
 *
 * L'appelant a deja prouve la propriete (session + ligne en base) et a obtenu
 * la cle de la BASE, jamais du navigateur. Ce module ne decide que de la
 * forme de la reponse :
 *
 *   - le type est decide ICI d'apres l'extension (table fermee de
 *     `acces-objet`), jamais lu sur l'objet : un fichier depose ne peut pas se
 *     faire servir en HTML depuis notre origine ;
 *   - `nosniff` + `Content-Security-Policy: default-src 'none'; sandbox` ;
 *   - cache PRIVE : aucun intermediaire partage ne garde un media de compte ;
 *   - `Range` pris en charge (206 / 416) : un lecteur HTML5 ne peut sinon ni se
 *     positionner ni remplir son tampon. Rien n'est lu d'un bloc en memoire.
 */
import { Readable } from 'stream';
import { typeContenuDepuisCle } from '@/lib/storage/acces-objet';
import type { PlageOctets, StockageObjets } from '@/lib/cinema/stockage/objets';

export type AnalyseRange =
  | { genre: 'aucune' }
  | { genre: 'plage'; debut: number; fin: number }
  | { genre: 'invalide' };

/** `Range: bytes=a-b | a- | -n`, une seule plage. Tout le reste est invalide. */
export function analyserRange(entete: string | null, taille: number): AnalyseRange {
  if (entete === null || entete === '') return { genre: 'aucune' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(entete.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { genre: 'invalide' };
  let debut: number;
  let fin: number;
  if (m[1] === '') {                       // suffixe : les n derniers octets
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return { genre: 'invalide' };
    debut = Math.max(0, taille - n);
    fin = taille - 1;
  } else {
    debut = Number(m[1]);
    fin = m[2] === '' ? taille - 1 : Math.min(Number(m[2]), taille - 1);
  }
  if (!Number.isSafeInteger(debut) || !Number.isSafeInteger(fin) || debut > fin || debut >= taille) return { genre: 'invalide' };
  return { genre: 'plage', debut, fin };
}

const ENTETES_SURES: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Accept-Ranges': 'bytes',
  'Content-Disposition': 'inline',
};

/** Le refus est le meme pour « absent » et « pas a vous » : rien n'est confirme. */
export function reponseIntrouvable(): Response {
  return new Response(JSON.stringify({ ok: false, erreur: 'introuvable' }), {
    status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

export async function servirObjet(req: Request, cle: string, objets: StockageObjets): Promise<Response> {
  // La taille d'abord (ouverture sans plage = tout le flux ; on la referme si une plage est demandee).
  const entier = await objets.ouvrir(cle);
  if (!entier) return reponseIntrouvable();
  const taille = entier.taille;
  const type = typeContenuDepuisCle(cle);
  const range = analyserRange(req.headers.get('range'), taille);

  if (range.genre === 'invalide') {
    (entier.flux as Readable).destroy?.();
    return new Response(null, { status: 416, headers: { ...ENTETES_SURES, 'Content-Range': `bytes */${taille}` } });
  }
  if (range.genre === 'aucune') {
    return new Response(Readable.toWeb(entier.flux as Readable) as ReadableStream, {
      status: 200, headers: { ...ENTETES_SURES, 'Content-Type': type, 'Content-Length': String(taille) },
    });
  }
  (entier.flux as Readable).destroy?.();
  const plage: PlageOctets = { debut: range.debut, fin: range.fin };
  const morceau = await objets.ouvrir(cle, plage);
  if (!morceau) return reponseIntrouvable();
  return new Response(Readable.toWeb(morceau.flux as Readable) as ReadableStream, {
    status: 206,
    headers: {
      ...ENTETES_SURES, 'Content-Type': type,
      'Content-Length': String(plage.fin - plage.debut + 1),
      'Content-Range': `bytes ${plage.debut}-${plage.fin}/${taille}`,
    },
  });
}
