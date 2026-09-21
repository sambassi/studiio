/**
 * OU se trouve le fichier a lire, pour une ligne de la table `videos`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La colonne `videos.video_url` n'est plus alimentee depuis le navigateur :
 * `POST /api/videos` la refuse, parce qu'un client pouvait s'y declarer
 * `completed` avec l'URL de son choix. C'est une bonne regle, et elle reste.
 *
 * Mais les deux ecrans qui creent ces lignes — `dashboard/infographic` et
 * `AgentIAModal` — composent leur montage DANS le navigateur puis le
 * televersent : ils sont les seuls a en connaitre l'URL. Ils la posent aussi
 * dans `metadata.renderedVideoUrl`, qui traverse la liste blanche. Sans ce
 * resolveur, la Bibliotheque ne regardait que la colonne, la trouvait nulle,
 * et retombait sur le RUSH BRUT : l'utilisateur voyait sa video source au
 * lieu de son montage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CLE EST `renderedVideoUrl`, ET ELLE SEULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le piege a connaitre : il existe AUSSI un `metadata.videoUrl` dans ce
 * depot, et il est ambigu — il porte le montage pour les posts d'infographie
 * et de l'autopilote, mais le RUSH pour l'editeur avance
 * (`creer-avance/page.tsx:2272` le lit explicitement comme un rush) et pour
 * l'Assistant. `postMetadata/types.ts` documente cette ambiguite comme une
 * dette assumee, et `cron/publish/route.ts:457` l'exclut nommement de sa
 * priorite : « meta.videoUrl is EXCLUDED from priority because it often
 * contains the raw rush URL ».
 *
 * Sur la table `videos`, la question ne se pose meme pas : personne n'y ecrit
 * `metadata.videoUrl`. Seul `renderedVideoUrl` y existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE RESOLVEUR NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il LIT. Il ne deplace aucune URL, ne reecrit aucune ligne, ne change aucun
 * statut. Une video reste `draft` : lire son montage n'est pas l'avoir rendue.
 */

/** Ce dont le resolveur a besoin — volontairement plus permissif que `Video`. */
export interface SourceVideo {
  video_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Chaine non vide, ou `null`. Une URL vide ne vaut pas mieux qu'une absente. */
function urlOuNull(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
}

function meta(video: SourceVideo | null | undefined): Record<string, unknown> {
  const m = video?.metadata;
  return m && typeof m === 'object' ? m as Record<string, unknown> : {};
}

/**
 * Le MONTAGE, et rien d'autre.
 *
 * 1. `video_url` — la colonne, quand un rendu serveur l'a remplie ;
 * 2. `metadata.renderedVideoUrl` — le montage compose dans le navigateur ;
 * 3. `null` — il n'y a pas de montage. Pas de repli sur le rush ici : rendre
 *    un rush sous le nom de « montage » est exactement la confusion que ce
 *    fichier existe pour supprimer.
 */
export function resolveMontageUrl(video: SourceVideo | null | undefined): string | null {
  return urlOuNull(video?.video_url) ?? urlOuNull(meta(video).renderedVideoUrl);
}

/**
 * Ce qu'on peut LIRE dans un lecteur video.
 *
 * Le montage d'abord ; le rush brut seulement s'il n'y a pas de montage. Ce
 * dernier repli est le comportement historique, conserve tel quel : sans lui,
 * les lignes anterieures a tout montage n'afficheraient plus rien.
 */
export function resolvePlayableVideoUrl(video: SourceVideo | null | undefined): string | null {
  const rushs = meta(video).rushUrls;
  const premierRush = Array.isArray(rushs) ? urlOuNull(rushs[0]) : null;
  return resolveMontageUrl(video) ?? premierRush;
}

/**
 * Ce qu'on peut TELECHARGER ou reposter.
 *
 * Prolonge la lecture par les images d'affiche : une infographie sans montage
 * ni rush reste exportable en image. Cascade reprise a l'identique de
 * `videos/[id]/export` et `videos/[id]/repost`, qui la portaient chacun de
 * leur cote, mot pour mot — a ceci pres qu'elles ignoraient le montage.
 */
export function resolveExportableUrl(video: SourceVideo | null | undefined): string | null {
  const m = meta(video);
  return resolvePlayableVideoUrl(video)
    ?? urlOuNull(m.posterPhotoUrl)
    ?? urlOuNull(m.characterImageUrl);
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLICATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hotes qu'un media publiable ne peut JAMAIS designer.
 *
 * `api/social/publish` telecharge lui-meme le fichier pour YouTube
 * (`fetch(publicVideoUrl)`) : une URL choisie par un tiers deviendrait une
 * requete sortante emise par notre serveur, depuis notre reseau. C'est la
 * definition d'un SSRF.
 */
const HOTES_INTERNES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  // Endpoint de metadonnees des fournisseurs cloud — la cible classique.
  '169.254.169.254', 'metadata.google.internal',
]);

/**
 * Une IPv4 en notation pointee : `[a, b, c, d]`, ou `null`.
 *
 * Un octet au-dela de 255 n'est pas filtre ici, a dessein : il tombe dans
 * `a >= 224` de la regle IPv4 et se retrouve refuse — une adresse malformee
 * n'est pas une adresse publique. C'est le comportement d'origine.
 */
function octetsIpv4(valeur: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(valeur);
  return m ? m.slice(1, 5).map(Number) : null;
}

/** La regle IPv4 seule : boucle, prive, lien-local, multicast et reserve. */
function ipv4Privee(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true; // multicast et reserve
  return false;
}

/**
 * L'IPv4 que porte une IPv6 « mappee » (`::ffff:a.b.c.d`, RFC 4291 §2.5.5.2),
 * ou `null` si l'hote n'en est pas une.
 *
 * Deux ecritures coexistent pour la meme adresse : pointee (`::ffff:127.0.0.1`)
 * et hexadecimale par paire (`::ffff:7f00:1`). Le prefixe peut lui-meme etre
 * abrege (`::ffff:`) ou developpe (`0:0:0:0:0:ffff:`). Sans ce deballage, un
 * `[::ffff:127.0.0.1]` passe toutes les regles IPv4 et designe pourtant la
 * boucle locale — la pile reseau, elle, le sait tres bien.
 */
function ipv4Mappee(hote: string): number[] | null {
  const m = /^(?:::|(?:0{1,4}:){5})ffff:(.+)$/.exec(hote);
  if (!m) return null;
  const reste = m[1];
  const pointee = octetsIpv4(reste);
  if (pointee) return pointee;
  const hexa = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(reste);
  if (!hexa) return null;
  const haut = parseInt(hexa[1], 16);
  const bas = parseInt(hexa[2], 16);
  return [haut >> 8, haut & 0xff, bas >> 8, bas & 0xff];
}

/**
 * Plages privees, en notation litterale. Un nom DNS n'est pas resolu ici.
 *
 * L'entree est normalisee avant tout : blancs retires, minuscules, point
 * final retire (`localhost.` est `localhost` pour le resolveur), crochets
 * d'IPv6 retires (`[::1]` et `::1` sont la meme adresse). Un hote vide est
 * refuse : il ne designe rien qu'on puisse publier.
 *
 * Exportee pour que tout chemin qui fait sortir une requete depuis NOTRE
 * serveur vers une URL fournie par un tiers applique la meme regle.
 */
export function estAdressePrivee(hote: string): boolean {
  let h = typeof hote === 'string' ? hote.trim().toLowerCase().replace(/\.$/, '') : '';
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.length === 0) return true;
  if (HOTES_INTERNES.has(h)) return true;
  // `localhost` et tout ce qui se termine par `.localhost` (RFC 6761).
  if (/(^|\.)localhost$/.test(h)) return true;
  // Suffixes de reseau interne.
  if (/\.(local|internal|localdomain|home|lan)$/.test(h)) return true;
  // IPv6 locale unique (fc00::/7) ou lien-local (fe80::/10).
  if (/^\[?(f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(h)) return true;
  if (h.includes(':')) {
    // `::` (adresse non specifiee) et toutes ses formes developpees ; `::1`
    // (boucle locale) developpee ou non.
    if (/^[0:]+$/.test(h)) return true;
    if (/^(?:0{0,4}:){2,7}0{0,3}1$/.test(h)) return true;
    // IPv4 mappee (`::ffff:…`) ou compatible (`::a.b.c.d`) : la regle IPv4
    // s'applique a l'adresse deballee.
    const mappee = ipv4Mappee(h) ?? (h.startsWith('::') ? octetsIpv4(h.slice(2)) : null);
    if (mappee) return ipv4Privee(mappee);
    return false;
  }
  const v4 = octetsIpv4(h);
  if (!v4) return false;
  return ipv4Privee(v4);
}

/**
 * L'URL est-elle utilisable pour une PUBLICATION ?
 *
 * Plus stricte que la lecture dans la Bibliotheque, et pour deux raisons
 * distinctes : le fichier part chez un tiers qui doit pouvoir l'atteindre, et
 * notre serveur le telecharge lui-meme pour YouTube.
 *
 * - `https:` seul. `http:` est refuse : les plateformes le rejettent de toute
 *   facon, et l'autoriser rouvrirait la porte du reseau interne.
 * - `blob:`, `data:`, `javascript:` : refuses par la meme regle.
 * - Aucun identifiant dans l'URL (`https://user:mdp@hote/`).
 * - Aucune remontee de chemin. Garde etroit, et c'est assume : `new URL`
 *   normalise deja `..` et `%2e%2e` (le chemin est reecrit avant qu'on le
 *   voie). Ce qui survit au parseur, et que ce garde attrape, c'est la forme
 *   antislash encodee `%5c`.
 * - Aucun hote local, prive ou interne.
 *
 * Reprend les gardes de `api/proxy-media` — schema, identifiants, traversee,
 * hote — sans sa liste blanche d'hotes : un montage peut legitimement vivre
 * sur un stockage dont le nom d'hote n'est pas connu de ce fichier.
 */
export function isPubliableMediaUrl(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string' || valeur.length === 0) return false;
  // Un blanc de tete masque un schema : `\njavascript:…` est lu comme
  // `javascript:…` par certains analyseurs.
  if (valeur !== valeur.trim()) return false;

  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  let chemin = url.pathname;
  try {
    chemin = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (chemin.includes('..') || chemin.includes('\\')) return false;

  const hote = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hote) return false;
  return !estAdressePrivee(hote);
}

/**
 * L'URL a PUBLIER, ou `null`.
 *
 * 1. `video_url` — la colonne, quand un rendu serveur l'a remplie ;
 * 2. `metadata.renderedVideoUrl` — le montage compose dans le navigateur ;
 * 3. `null` — on refuse.
 *
 * JAMAIS le rush brut, contrairement a l'apercu de la Bibliotheque. Publier
 * la video source a la place du montage est irreversible : le fichier part
 * chez un tiers, sous le nom de l'utilisateur. Mieux vaut refuser.
 *
 * L'URL retenue est validee : une valeur venue des metadonnees a ete ecrite
 * par un navigateur, et rien ne garantit a elle seule qu'elle soit sure.
 */
export function resolvePublishableUrl(video: SourceVideo | null | undefined): string | null {
  const montage = resolveMontageUrl(video);
  return isPubliableMediaUrl(montage) ? montage : null;
}
