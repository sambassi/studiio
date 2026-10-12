/**
 * L'URL qu'un réseau social (ou notre téléchargement YouTube) ira chercher —
 * UNE seule implémentation pour `api/social/publish` et `api/cron/publish`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TROU QUE CE MODULE FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les deux routes portaient chacune leur copie de `ensurePublicUrl` : toute
 * URL contenant `/storage/v1/object/(sign|authenticated|private)/<bucket>/<clé>`
 * était SIGNÉE pour 1 h avec le client ADMIN, sans regarder à qui
 * appartenait l'objet. Or l'URL vient du post (`media_url`,
 * `metadata.renderedVideoUrl`) — donc du navigateur. A pouvait y poser la clé
 * d'un objet PRIVÉ de B : notre serveur signait, Meta / TikTok téléchargeaient,
 * et la vidéo de B partait sur les réseaux de A. Un « adjoint confus ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avant toute signature, la cible passe `cibleLisibleParCompte` avec
 * l'identifiant du PUBLIEUR (session pour la route, `post.user_id` pour le
 * cron) — exactement la garde des lectures internes du stockage :
 * politique du relais public (`cibleRecevable` : compartiments admis, chemin
 * sain, namespaces privés refusés — analyses, montages, LUT, source
 * d'avatar), puis propriété lue sur la clé.
 *
 * La garde porte sur la clé BRUTE (celle qui part à la signature) ET sur sa
 * forme décodée : une clé qui ne satisfait la règle que sous l'une des deux
 * formes n'est pas signée.
 *
 * Refus → `ErreurMediaPublication('refuse')`, message FIXE
 * (« Média de publication refusé. ») : ni clé, ni URL, ni compte n'en
 * sortent, ni dans la réponse, ni dans `metadata.error`. Aucun appel de
 * signature n'a lieu.
 *
 * Une URL publique (relais `/object/public/`) ressort telle quelle APRÈS la
 * même garde de propriété (sauf `converted/…`, préfixe partagé du cron) ; une
 * URL externe ressort telle quelle ; un échec de signature rend l'URL
 * d'origine, comme avant.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  cibleParCheminLisible,
  cibleStockageParChemin,
  extraireCibleStockage,
  originesStockageConfigurees,
} from '@/lib/storage/acces-objet';
import { signerUrlRelais, DUREE_JETON_RELAIS_MS } from '@/lib/storage/jeton-relais';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';
import { ErreurMediaPublication, verdictStockagePublication } from '@/lib/social/media-publication';

/** Durée de validité de l'URL signée remise au réseau. */
export const DUREE_SIGNATURE_PUBLICATION_S = 3600;

/** Jeton du relais remis au réseau (#547) : 24 h, le temps d'un traitement Meta / TikTok lent. */
export const DUREE_JETON_PUBLICATION_MS = DUREE_JETON_RELAIS_MS;

/**
 * Rend une URL que la plateforme peut aller chercher elle-même.
 *
 * ⚠️ LE CHEMIN FAIT FOI, PAS L'HÔTE. Tout chemin d'objet de stockage
 * (`/storage/v1/object/(public|sign|authenticated|private)/…`), sur
 * N'IMPORTE QUEL hôte (staging, alias, IP, point final, `http`), passe la
 * propriété du publieur (`verdictStockagePublication`) — y compris l'URL
 * PUBLIQUE : remise telle quelle au réseau, elle publiait l'objet d'un autre
 * compte sur les réseaux de celui-ci. Une forme encodée ou non canonique du
 * chemin est refusée.
 *
 * @param userId le PUBLIEUR — propriétaire exigé de tout objet de stockage.
 * @throws ErreurMediaPublication('refuse') avant toute signature.
 */
export async function ensurePublicUrl(url: string, userId: unknown): Promise<string> {
  if (!url) return url;
  // ⚠️ ABSOLUE D'ABORD : Meta et TikTok vont chercher le fichier eux-mêmes,
  // un chemin relatif (`/storage/v1/object/public/…` sous MinIO) leur est
  // inutilisable. Une URL déjà absolue ressort inchangée.
  const absolue = toAbsoluteMediaUrl(url);
  const verdict = verdictStockagePublication(absolue, userId);
  if (verdict === 'hors-stockage') return absolue;
  const cible = cibleStockageParChemin(absolue);
  if (verdict === 'refuse' || cible === null || cible === 'refus') {
    // Journal sans clé ni URL : le compartiment seul suffit au diagnostic.
    console.warn('[Publication/Média] objet de stockage refusé avant signature', {
      bucket: cible && cible !== 'refus' ? cible.bucket : 'invalide',
    });
    throw new ErreurMediaPublication('refuse');
  }
  if (cible.acces === 'public') {
    // #547 : le relais n'ouvre plus un objet de compte sans session. Meta,
    // TikTok et Zernio viennent le chercher SANS cookie : l'URL remise porte
    // un jeton signé, lié à CETTE clé, valable 24 h. Jamais pour un hôte
    // non configuré — un jeton remis à un tiers ouvrirait l'objet chez nous.
    // Propriété déjà vérifiée ci-dessus (`verdictStockagePublication`).
    const sansRequete = absolue.split(/[?#]/)[0];
    return extraireCibleStockage(sansRequete, { origines: originesStockageConfigurees() })
      ? signerUrlRelais(absolue, { dureeMs: DUREE_JETON_PUBLICATION_MS })
      : absolue;
  }
  // Privé (`sign` / `authenticated` / `private`) : propriété STRICTE, la
  // conversion partagée n'est admise qu'en lecture publique — jamais signée.
  if (!cibleParCheminLisible(cible, userId)) {
    console.warn('[Publication/Média] objet privé refusé avant signature', { bucket: cible.bucket });
    throw new ErreurMediaPublication('refuse');
  }

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(cible.bucket)
      .createSignedUrl(cible.cleBrute, DUREE_SIGNATURE_PUBLICATION_S);
    if (error || !data?.signedUrl) return absolue;
    return data.signedUrl;
  } catch {
    return absolue;
  }
}
