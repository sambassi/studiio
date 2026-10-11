import { pickRush } from '@/lib/autopilot/rules';
import { sonderSur, telechargerSur, estRefusSsrf, type OptionsFetchSur } from '@/lib/securite/fetch-sur';
import { estNotreStockage } from '@/lib/securite/medias-externes';

/**
 * La photo d'affiche et la durée du rush, pour l'Autopilote.
 *
 * Deux sondages RÉSEAU, isolés ici pour que la fabrique de design reste pure
 * et testable sur des valeurs.
 *
 * ⚠️ AUCUN DES DEUX NE PEUT FAIRE ÉCHOUER UN CYCLE. Une API indisponible ou
 * un fichier illisible rend `null`, et le montage sort comme avant — fond
 * dégradé, durée de repli. Un Autopilote qui ne produit rien parce qu'une
 * banque d'images ne répond pas serait un bien pire défaut que celui qu'on
 * corrige.
 */

/** Portrait : l'Autopilote produit du 9:16. */
const ORIENTATION = 'portrait';

/**
 * Mots-clés envoyés à la banque d'images, à partir du sujet.
 *
 * Le sujet vient des objectifs de l'utilisateur, en français. Pexels indexe
 * en anglais : sans traduction, « routine du matin » ne ramène rien et le
 * montage repart sur un dégradé. On garde un repli générique plutôt qu'une
 * requête vide.
 */
export function posterQuery(topic: string): string {
  const propre = (topic || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const table: Array<[RegExp, string]> = [
    [/sommeil|dormir|nuit|repos/, 'sleep rest recovery'],
    [/nutrition|manger|aliment|repas/, 'healthy food nutrition'],
    [/cardio|course|courir|running/, 'cardio running workout'],
    [/muscu|force|halter/, 'weightlifting gym strength'],
    [/yoga|meditation|stress|mental/, 'yoga meditation calm'],
    [/danse|dance/, 'dance fitness energy'],
    [/matin|reveil|routine/, 'morning routine sunrise'],
    [/eau|hydrat/, 'water hydration drink'],
    [/energie|motivation/, 'athlete motivation training'],
  ];
  for (const [motif, requete] of table) {
    if (motif.test(propre)) return requete;
  }
  // Repli : le même que la route `/api/pexels` quand elle ne reconnaît rien.
  return 'fitness dance workout';
}

/**
 * Affiche prise dans la banque de l'utilisateur, en rotation.
 *
 * ⚠️ MÊME RÈGLE QUE LES RUSHES, ET POUR LA MÊME RAISON : deux vidéos d'affilée
 * sur la même image, c'est ce que la banque existe pour éviter. On réutilise
 * donc `pickRush` plutôt que d'en réécrire une variante — une seconde rotation
 * aurait fini par tourner autrement.
 *
 * ⚠️ AVEC UNE SEULE AFFICHE, ELLE EST FORCÉMENT RÉPÉTÉE. C'est la limite de la
 * banque, pas de la rotation : l'écran invite à en ajouter une seconde.
 */
export function pickCustomPoster(
  posterUrls: string[],
  lastPosterUrl: string | null | undefined,
  index = 0,
): string | null {
  return pickRush(posterUrls, lastPosterUrl, index);
}

/**
 * Photo de fond pour un sujet, ou `null`.
 *
 * On interroge Pexels directement plutôt que la route `/api/pexels` : celle-ci
 * exige une session, et un cron n'en a pas. C'est la MÊME clé et la même API.
 */
export async function pickPosterUrl(topic: string, variante = 0): Promise<string | null> {
  const cle = process.env.PEXELS_API_KEY;
  if (!cle) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(posterQuery(topic))}`
      + `&per_page=15&orientation=${ORIENTATION}`,
      { headers: { Authorization: cle } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { photos?: Array<{ src?: Record<string, string> }> };
    const photos = (data.photos ?? []).map((p) => p.src?.large2x || p.src?.large).filter(Boolean);
    if (photos.length === 0) return null;
    // ⚠️ LA GRAINE INCLUT LA VARIANTE. Dérivée du seul sujet, elle rendait la
    // MÊME photo à chaque cycle d'un même thème : l'affiche ne changeait
    // jamais. `variante` — le rang du montage et l'instant du cycle — la fait
    // tourner, tout en restant reproductible.
    const graine = [...topic].reduce((n, c) => n + c.charCodeAt(0), 0)
      + Math.abs(Math.floor(variante));
    return photos[graine % photos.length] as string;
  } catch {
    return null;
  }
}

/**
 * Le rush est-il TOUJOURS là ?
 *
 * ⚠️ ON NE RÉPOND « NON » QUE SUR UN 404 OU UN 410. Un 500, un délai dépassé,
 * une coupure réseau ne prouvent RIEN sur l'existence du fichier — et traiter
 * ces cas comme une disparition retirerait de la banque, définitivement, un
 * rush parfaitement valide dont le stockage a hoqueté cinq secondes. Le doute
 * profite au rush : on rend `true`, et le rendu échouera de son côté si le
 * fichier manque vraiment — ce qui coûte un montage, pas la banque.
 *
 * Un 405 (HEAD refusé par le stockage) ne dit rien non plus : il passe.
 *
 * ⚠️ SSRF : la sonde passe par le fetch SÛR (`fetch-sur.ts`) — DNS épinglé,
 * adresses internes refusées, redirections revalidées une à une. Un REFUS de
 * politique (cible interne, redirection vers une adresse privée, chaîne trop
 * longue) n'est PAS un doute : la cible n'a pas été contactée, et l'URL ne
 * sera jamais lisible par le rendu — le rush est « absent ». Le doute ne
 * profite qu'aux échecs RÉSEAU d'une cible autorisée.
 */
export async function rushEncorePresent(url: string, timeoutMs = 8_000, reseau: OptionsFetchSur = {}): Promise<boolean> {
  try {
    const res = await sonderSur(url, { ...reseau, timeoutMs });
    return !(res.status === 404 || res.status === 410);
  } catch (e) {
    if (estRefusSsrf(e)) return false;
    // Réseau, délai, hôte injoignable : aucune conclusion possible.
    return true;
  }
}

/**
 * Durée réelle d'un rush, en secondes, ou `null` si elle est illisible.
 *
 * ⚠️ C'EST CE QUI SUPPRIME LE GEL DE FIN DE MONTAGE. La séquence vidéo durait
 * une valeur FIXE de repli ; un rush plus court que cette valeur laissait
 * `OffthreadVideo` figé sur sa dernière image le temps restant — l'image se
 * bloquait, puis le CTA arrivait. Sonder le fichier permet de caler la
 * séquence sur ce qu'il contient vraiment.
 *
 * `@remotion/media-parser` lit l'en-tête sans décoder la vidéo, et tourne
 * dans Node — contrairement à `@remotion/media-utils`, qui suppose un
 * navigateur.
 */
export async function probeRushSeconds(url: string, reseau: OptionsFetchSur = {}): Promise<number | null> {
  // ⚠️ SSRF / TOCTOU : `parseMedia` lit lui-même ce qu'on lui donne, en
  // suivant les redirections. Il ne reçoit donc une URL que si elle désigne
  // NOTRE stockage (relais public, qui ne redirige jamais) ; tout autre média
  // est d'abord téléchargé par le fetch sûr, puis lu en FICHIER local.
  let local: string | null = null;
  try {
    const { parseMedia } = await import('@remotion/media-parser');
    let src = url;
    let reader: import('@remotion/media-parser').MediaParserReaderInterface | undefined;
    if (!estNotreStockage(url)) {
      const os = await import('os');
      const path = await import('path');
      const { randomUUID } = await import('crypto');
      local = path.join(os.tmpdir(), `studiio-sonde-${randomUUID()}`);
      await telechargerSur(url, local, { timeoutMs: 120_000, ...reseau });
      src = local;
      reader = (await import('@remotion/media-parser/node')).nodeReader;
    }
    const { durationInSeconds } = await parseMedia({
      src,
      ...(reader ? { reader } : {}),
      fields: { durationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    return typeof durationInSeconds === 'number' && durationInSeconds > 0
      ? durationInSeconds
      : null;
  } catch {
    return null;
  } finally {
    if (local) {
      const { unlink } = await import('fs/promises');
      await unlink(local).catch(() => undefined);
    }
  }
}
