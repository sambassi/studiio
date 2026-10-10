/**
 * SONDE SÛRE D'UN MÉDIA STOCK RETENU — garde SSRF contre les REDIRECTIONS.
 *
 * `urlStockAutorisee` filtre l'URL ÉCRITE ; mais un `fetch` ordinaire SUIT
 * les redirections : un hôte autorisé (CDN, notre stockage) qui répondrait
 * `302 Location: http://169.254.169.254/…` ferait contacter le réseau interne
 * au nom du serveur — par la sonde HEAD, puis par `parseMedia` et le rendu.
 *
 * Ici :
 *   - l'URL de départ est contrôlée AVANT tout appel réseau ;
 *   - chaque requête part en `redirect: 'manual'` : rien n'est suivi en
 *     silence ;
 *   - au plus `MAX_SAUTS` redirections sont suivies À LA MAIN, et seulement si
 *     chaque `Location` (résolue, relative comprise) repasse le MÊME contrôle ;
 *   - sinon le média est LÂCHÉ (`ok: false`) — jamais le montage.
 *
 * Le moteur ne transmet ensuite au rendu (Remotion, ffprobe, `parseMedia`)
 * QUE l'URL finale validée : la chaîne de redirections n'est jamais rejouée.
 *
 * ⚠️ Le contrôle est INJECTABLE (`autorisee`) pour les tests seulement — les
 * serveurs de test écoutent sur 127.0.0.1, qu'aucun code de production
 * n'autorise. Par défaut : `urlStockAutorisee`.
 *
 * Réseau muet, délai dépassé : on ne sait PAS où l'URL mène — lâché (un
 * média stock ne fait jamais échouer un montage ; le doute ne lui profite pas,
 * contrairement à un rush personnel, cf. `rushEncorePresent`).
 */
import { urlStockAutorisee } from '@/lib/autopilot/sources';

export const MAX_SAUTS = 3;
const STATUTS_REDIRECTION = new Set([301, 302, 303, 307, 308]);

export type PredicatStock = (url: string, type: 'video' | 'photo') => boolean;

export interface OptionsSondeStock {
  /** Contrôle de chaque URL (départ et chaque saut). Défaut : `urlStockAutorisee`. */
  autorisee?: PredicatStock;
  /** Défaut : `fetch` global. */
  fetchImpl?: typeof fetch;
  maxSauts?: number;
  /** Délai TOTAL de la sonde, redirections comprises. */
  timeoutMs?: number;
}

export type MotifRejetStock = 'refusee' | 'redirection-refusee' | 'trop-de-redirections' | 'introuvable' | 'injoignable';

export type ResultatSondeStock =
  | { ok: true; url: string; sauts: number }
  | { ok: false; motif: MotifRejetStock; url: string };

export async function sonderMediaStock(
  url: string,
  type: 'video' | 'photo',
  opts: OptionsSondeStock = {},
): Promise<ResultatSondeStock> {
  const autorisee = opts.autorisee ?? ((u: string, t: 'video' | 'photo') => urlStockAutorisee(u, t));
  const faire = opts.fetchImpl ?? fetch;
  const maxSauts = opts.maxSauts ?? MAX_SAUTS;
  // AVANT tout appel réseau.
  if (!autorisee(url, type)) return { ok: false, motif: 'refusee', url };
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), opts.timeoutMs ?? 8_000);
  let courante = url;
  try {
    for (let sauts = 0; ; sauts += 1) {
      let res: Response;
      try {
        res = await faire(courante, { method: 'HEAD', redirect: 'manual', signal: controleur.signal, cache: 'no-store' });
      } catch {
        return { ok: false, motif: 'injoignable', url: courante };
      }
      try { await res.body?.cancel(); } catch { /* rien à lire */ }
      // Navigateur / polyfill : redirection opaque, la cible est illisible.
      if (res.type === 'opaqueredirect') return { ok: false, motif: 'redirection-refusee', url: courante };
      if (STATUTS_REDIRECTION.has(res.status)) {
        const location = res.headers.get('location');
        let suivante: string | null = null;
        try { suivante = location ? new URL(location, courante).href : null; } catch { suivante = null; }
        if (!suivante || !autorisee(suivante, type)) return { ok: false, motif: 'redirection-refusee', url: courante };
        if (sauts + 1 > maxSauts) return { ok: false, motif: 'trop-de-redirections', url: courante };
        courante = suivante;
        continue;
      }
      if (res.status === 404 || res.status === 410) return { ok: false, motif: 'introuvable', url: courante };
      // 2xx, 405 (HEAD refusé), 5xx : présent — l'URL finale, telle quelle.
      return { ok: true, url: courante, sauts };
    }
  } finally {
    clearTimeout(minuteur);
  }
}
