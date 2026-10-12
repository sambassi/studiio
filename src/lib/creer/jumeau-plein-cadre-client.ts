/**
 * Navigateur — avant de COMPOSER, chaque vidéo de jumeau des options est
 * remplacée par l'URL que rend `POST /api/creer/jumeau/plein-cadre` :
 * l'original s'il est propre, sa version plein cadre dérivée s'il porte des
 * bandes incrustées (jumeau rapatrié avant #555). Aucune génération, aucun
 * crédit.
 *
 * Ne bloque jamais un montage : réseau coupé, refus, réponse illisible →
 * l'URL d'origine est gardée (le montage d'avant, à l'identique).
 */
import type { ComposerOptions } from '@/lib/video-composer';
import { generationDepuisRush } from '@/lib/avatar/identite';

export const API_PLEIN_CADRE = '/api/creer/jumeau/plein-cadre';

/** Une vidéo de jumeau pas encore passée par le contrôle plein cadre ? Pure. */
export function jumeauAControler(url: unknown): url is string {
  return typeof url === 'string' && !!generationDepuisRush(url) && !url.includes('/jumeaux-recadres/');
}

const memo = new Map<string, Promise<string>>();

/** Tests uniquement. */
export function oublierMemoPleinCadre(): void { memo.clear(); }

/** L'URL à monter pour ce jumeau et ce format (`1080:1920`, `9:16`…). */
export function urlJumeauPleinCadre(url: string, format: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cle = `${url}|${format}`;
  const deja = memo.get(cle);
  if (deja) return deja;
  const travail = (async () => {
    const res = await fetchImpl(API_PLEIN_CADRE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, format }),
    });
    const json = await res.json().catch(() => null);
    const rendue = res.ok && json?.success && typeof json.data?.url === 'string' ? json.data.url as string : null;
    if (!rendue) throw new Error('plein cadre indisponible');
    return rendue;
  })();
  memo.set(cle, travail);
  // Un échec n'est pas mémorisé : le prochain montage réessaie.
  return travail.catch(() => { memo.delete(cle); return url; });
}

type OptionsVideo = Pick<ComposerOptions, 'width' | 'height' | 'videoUrl' | 'rushs' | 'montage' | 'sequenceVoiceUrls'>;

/**
 * Remplace, DANS l'objet d'options, chaque vidéo de jumeau (séquence Vidéo,
 * multi-rush, plan de montage, piste de voix « vidéo » qui est le même
 * fichier) par sa version à monter. Rend le même objet.
 */
export async function pleinCadreDesJumeaux<T extends OptionsVideo>(options: T, fetchImpl: typeof fetch = fetch): Promise<T> {
  const format = `${options.width}:${options.height}`;
  const urls = new Set<string>();
  const noter = (u: unknown) => { if (jumeauAControler(u)) urls.add(u); };
  noter(options.videoUrl);
  for (const r of options.rushs ?? []) noter(r?.url);
  for (const s of options.montage ?? []) noter(s?.url);
  noter(options.sequenceVoiceUrls?.video);
  if (urls.size === 0) return options;
  const remplacees = new Map<string, string>();
  for (const u of urls) remplacees.set(u, await urlJumeauPleinCadre(u, format, fetchImpl));
  const l = <U>(u: U): U => (typeof u === 'string' ? (remplacees.get(u) ?? u) as U : u);
  if (options.videoUrl) options.videoUrl = l(options.videoUrl);
  if (options.rushs) options.rushs = options.rushs.map((r) => ({ ...r, url: l(r.url) }));
  if (options.montage) options.montage = options.montage.map((s) => ({ ...s, url: l(s.url) }));
  if (options.sequenceVoiceUrls?.video) options.sequenceVoiceUrls = { ...options.sequenceVoiceUrls, video: l(options.sequenceVoiceUrls.video) };
  return options;
}
