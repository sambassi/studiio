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
import { useEffect, useState } from 'react';
import type { ComposerOptions } from '@/lib/video-composer';
import { generationDepuisRush } from '@/lib/avatar/identite';

export const API_PLEIN_CADRE = '/api/creer/jumeau/plein-cadre';

/** Une vidéo de jumeau pas encore passée par le contrôle plein cadre ? Pure. */
export function jumeauAControler(url: unknown): url is string {
  return typeof url === 'string' && !!generationDepuisRush(url) && !url.includes('/jumeaux-recadres/');
}

const memo = new Map<string, Promise<string>>();
/** URL rendue, connue SYNCHRONEMENT (succès) — l'aperçu l'affiche dès le montage du composant. */
const resolues = new Map<string, string>();
/** Échecs de la session : l'aperçu ne relance pas la requête (pas de rafale). */
const echecs = new Set<string>();

/** Tests uniquement. */
export function oublierMemoPleinCadre(): void { memo.clear(); resolues.clear(); echecs.clear(); }

/**
 * `1080:1920`, `9:16`, `9x16` → `9:16` : l'aperçu (format de l'éditeur) et
 * l'export (dimensions du compositeur) partagent ainsi la MÊME entrée de
 * cache, donc le même fichier dérivé. Pure.
 */
export function ratioReduit(format: string): string {
  const m = /^\s*(\d{1,5})\s*[:x/]\s*(\d{1,5})\s*$/.exec(format);
  if (!m) return format;
  const a = Number(m[1]); const b = Number(m[2]);
  if (!(a > 0 && b > 0)) return format;
  const pgcd = (x: number, y: number): number => (y === 0 ? x : pgcd(y, x % y));
  const d = pgcd(a, b);
  return `${a / d}:${b / d}`;
}

const cleDe = (url: string, format: string) => `${url}|${ratioReduit(format)}`;

/**
 * L'URL à monter pour ce jumeau et ce format (`1080:1920`, `9:16`…).
 * Chemin de l'EXPORT : un échec n'est pas définitif, le prochain montage
 * réessaie.
 */
export function urlJumeauPleinCadre(url: string, format: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cle = cleDe(url, format);
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
  // Le memo garde la promesse qui NE REJETTE PAS : un second appelant
  // (l'aperçu puis l'export, en parallèle) reçoit l'original en cas d'échec,
  // jamais une erreur qui interromprait l'envoi.
  const sure = travail.then(
    (u) => { resolues.set(cle, u); echecs.delete(cle); return u; },
    // Un échec n'est pas mémorisé : le prochain montage réessaie.
    () => { echecs.add(cle); memo.delete(cle); return url; },
  );
  memo.set(cle, sure);
  return sure;
}

/**
 * Chemin de l'APERÇU — même requête, même cache que l'export : l'aperçu
 * montre exactement le fichier que le MP4 montera. Une seule requête par
 * (jumeau, format) et par session : un échec déjà constaté rend l'original
 * sans relancer. Ne rejette jamais.
 */
export function resoudreJumeauPleinCadre(url: string, format: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!jumeauAControler(url)) return Promise.resolve(url);
  const cle = cleDe(url, format);
  const connue = resolues.get(cle);
  if (connue) return Promise.resolve(connue);
  if (echecs.has(cle) && !memo.has(cle)) return Promise.resolve(url);
  return urlJumeauPleinCadre(url, format, fetchImpl);
}

/** L'URL plein cadre DÉJÀ connue pour ce jumeau et ce format, sinon `undefined`. */
export function urlPleinCadreConnue(url: string, format: string): string | undefined {
  return resolues.get(cleDe(url, format));
}

/**
 * Source À AFFICHER d'une vidéo dans l'aperçu de Créer. L'URL d'origine reste
 * celle de l'état, du brouillon et des métadonnées : seule la source montrée
 * change, une fois, quand la version plein cadre est connue. Résolu par
 * (url, format) — jamais à chaque rendu. Échec → l'original, sans blocage.
 */
export function useUrlJumeauPleinCadre<T extends string | null | undefined>(url: T, format: string): T | string {
  const [, setResolu] = useState(0);
  const aControler = jumeauAControler(url);
  useEffect(() => {
    if (!aControler) return;
    if (urlPleinCadreConnue(url as string, format)) return;
    let vivant = true;
    void resoudreJumeauPleinCadre(url as string, format).then(() => { if (vivant) setResolu((n) => n + 1); });
    return () => { vivant = false; };
  }, [url, format, aControler]);
  if (!aControler) return url;
  return urlPleinCadreConnue(url as string, format) ?? url;
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
