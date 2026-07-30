import { parseCube, parseLutPng } from './parse';
import { Lut } from './types';

/**
 * Chargement d'une LUT depuis son URL, avec cache.
 *
 * L'aperçu et le compositeur chargent la MÊME LUT : sans cache, un montage
 * retéléchargerait jusqu'à 6 Mo à chaque rendu. Mais **un échec n'est jamais
 * mis en cache** — il condamnerait la LUT pour toute la session, y compris
 * une fois le réseau revenu.
 */

const cache = new Map<string, Promise<Lut>>();

/** Vide le cache. Réservé aux tests — rien n'invalide une LUT en production. */
export function clearLutCache(): void {
  cache.clear();
}

export interface LutLoadDeps {
  fetchFn?: typeof fetch;
  decodeImage?: (blob: Blob) => Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
}

export function loadLut(url: string, deps: LutLoadDeps = {}): Promise<Lut> {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = fetchAndParse(url, deps);
  cache.set(url, pending);
  // Un rejet retiré du cache : le prochain appel retentera.
  pending.catch(() => cache.delete(url));
  return pending;
}

async function fetchAndParse(url: string, deps: LutLoadDeps): Promise<Lut> {
  const doFetch = deps.fetchFn ?? fetch;
  const res = await doFetch(proxied(url));
  if (!res.ok) {
    throw new Error(`Filtre introuvable (${res.status}).`);
  }

  if (/\.png$/i.test(url)) {
    const decode = deps.decodeImage;
    if (!decode) throw new Error("Décodeur d'image indisponible.");
    const { data, width, height } = await decode(await res.blob());
    return parseLutPng(data, width, height);
  }
  return parseCube(await res.text());
}

/**
 * Les LUT vivent sur le stockage, qui est d'une autre origine : une requête
 * directe se prend le CORS. Le proxy est le même que celui des autres médias
 * du compositeur. Une URL déjà relative est laissée telle quelle.
 */
function proxied(url: string): string {
  if (url.startsWith('/')) return url;
  return `/api/proxy-media?url=${encodeURIComponent(url)}`;
}
