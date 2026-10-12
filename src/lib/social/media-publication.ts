/**
 * LE MÉDIA D'UNE PUBLICATION, LU PAR LE SERVEUR — par le fetch sûr, jamais
 * par un `fetch()` nu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `scheduled_posts.media_url` et `metadata.renderedVideoUrl` sont écrits par
 * le NAVIGATEUR. Le cron les relisait puis les téléchargeait tels quels
 * (`uploadMedia` → `fetch(fichierUrl)`), et les octets partaient chez Zernio,
 * publiés sur les réseaux de l'auteur du post : une lecture COMPLÈTE de
 * n'importe quelle adresse joignable depuis le serveur (métadonnées cloud,
 * PostgREST, MinIO, Coolify…). L'erreur recopiait en plus le statut et l'URL
 * dans `metadata.error` — un oracle de balayage de ports.
 *
 * Ici :
 *   - notre stockage (origines configurées + relais public) est lu en
 *     confiance : c'est là que vivent les montages rendus ;
 *   - toute autre URL passe par `telechargerSur` : DNS résolu et épinglé,
 *     adresses privées refusées, redirections revalidées (3 au plus),
 *     délai total, plafond d'octets ;
 *   - l'erreur est un CODE (`ErreurMediaPublication`) au message fixe : ni
 *     URL, ni adresse, ni port, ni statut de la cible n'en sortent.
 */
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  EchecFetchSur, MAX_OCTETS_MEDIA, RefusSsrf, telechargerSur, type OptionsFetchSur,
} from '@/lib/securite/fetch-sur';
import { estNotreStockage } from '@/lib/securite/medias-externes';
import { originesStockageConfigurees } from '@/lib/storage/acces-objet';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';

/** Plafond d'un média publié : celui des envois. */
export const MAX_OCTETS_PUBLICATION = MAX_OCTETS_MEDIA;

export type CodeMediaPublication = 'refuse' | 'introuvable' | 'trop-volumineux';

/**
 * Messages FIXES, sans interpolation : ils finissent dans `metadata.error`,
 * dans le Calendrier et dans les réponses HTTP.
 */
export const MESSAGES_MEDIA_PUBLICATION: Record<CodeMediaPublication, string> = {
  refuse: 'Média de publication refusé.',
  introuvable: 'Média de publication introuvable.',
  'trop-volumineux': 'Média de publication trop volumineux.',
};

export class ErreurMediaPublication extends Error {
  readonly code: CodeMediaPublication;
  /** Un réessai a-t-il une chance d'aboutir (délai, cible injoignable, 5xx) ? */
  readonly reessayable: boolean;
  constructor(code: CodeMediaPublication, reessayable = false) {
    super(MESSAGES_MEDIA_PUBLICATION[code]);
    this.name = 'ErreurMediaPublication';
    this.code = code;
    this.reessayable = reessayable;
  }
}

/** Hôte seul, pour le journal : jamais le chemin ni la requête (jetons signés). */
function hotePourJournal(url: string): string {
  try { return new URL(url).hostname; } catch { return 'url-invalide'; }
}

/**
 * Lit le média à publier, en entier, en mémoire (plafonné).
 *
 * Rejette UNIQUEMENT `ErreurMediaPublication`. Une cible refusée n'a reçu
 * AUCUNE requête (seule la résolution DNS a eu lieu).
 */
export async function lireMediaPublication(
  url: string,
  opts: { reseau?: OptionsFetchSur } = {},
): Promise<{ octets: Uint8Array<ArrayBuffer>; typeContenu: string | null }> {
  const absolue = typeof url === 'string' ? toAbsoluteMediaUrl(url) : '';
  if (!absolue) throw new ErreurMediaPublication('refuse');
  const origines = originesStockageConfigurees();
  // Confiance accordée à notre STOCKAGE seulement (relais public), pas à
  // toute l'origine de l'application : une autre route du même hôte repasse
  // le contrôle d'adresse comme n'importe quelle URL.
  const confiance = estNotreStockage(absolue, origines) ? origines : [];
  const local = path.join(os.tmpdir(), `studiio-publication-${randomUUID()}.media`);
  try {
    const r = await telechargerSur(absolue, local, {
      timeoutMs: 300_000,
      maxOctets: MAX_OCTETS_PUBLICATION,
      ...(opts.reseau ?? {}),
      originesDeConfiance: opts.reseau?.originesDeConfiance ?? confiance,
    });
    return { octets: await readFile(local), typeContenu: r.typeContenu };
  } catch (e) {
    const hote = hotePourJournal(absolue);
    if (e instanceof RefusSsrf) {
      console.warn('[Publication/Média] refusé', { motif: e.motif, hote });
      throw new ErreurMediaPublication('refuse');
    }
    if (e instanceof EchecFetchSur) {
      console.warn('[Publication/Média] échec', { motif: e.motif, status: e.status, hote });
      if (e.motif === 'trop-volumineux') throw new ErreurMediaPublication('trop-volumineux');
      const reessayable = e.motif === 'delai' || e.motif === 'injoignable' || (e.status !== null && e.status >= 500);
      throw new ErreurMediaPublication('introuvable', reessayable);
    }
    console.warn('[Publication/Média] lecture impossible', { hote, nom: e instanceof Error ? e.name : typeof e });
    throw new ErreurMediaPublication('introuvable', true);
  } finally {
    await unlink(local).catch(() => undefined);
  }
}
