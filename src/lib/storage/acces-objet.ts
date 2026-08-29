/**
 * Ce qu'une cle d'objet a le droit d'etre, et sous quel type on la sert.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La meme garde de chemin etait deja ecrite a trois endroits :
 *   - `api/upload/multipart/route.ts`      → `cheminAutorise` (prefixe + `..`)
 *   - `lib/storage/verifier-objet.ts`      → prefixe + `..`
 *   - `lib/autopilot/analyse/vignettes.ts` → prefixe + `..` + `://`
 *
 * Trois copies d'une garde ne divergent pas tout de suite : elles divergent
 * le jour ou l'une apprend a refuser une forme que les autres acceptent
 * encore. C'est deja le cas — seule la troisieme refuse `://`. La quatrieme
 * occurrence (la route de stockage publique) est donc ecrite ICI, une fois,
 * et les copies existantes pourront y etre ramenees separement : deux
 * d'entre elles sont figees par des tests qui verifient leur texte source,
 * et les deplacer dans ce lot aurait melange un durcissement avec un
 * remaniement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TYPE DE CONTENU EST DECIDE ICI, JAMAIS LU SUR L'OBJET
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `stat.metaData['content-type']` est choisi par CELUI QUI ENVOIE :
 * `api/storage/upload` recopie l'en-tete du navigateur, `api/upload/multipart`
 * recopie `corps.contentType`, et une URL presignee laisse l'en-tete libre.
 * `sanitizeStorageFilename` conserve les points et ne filtre aucune
 * extension. Servir ce type depuis notre origine, c'est laisser un compte
 * deposer `x.html` en `text/html` et le faire executer sur le domaine qui
 * porte la session NextAuth.
 *
 * Alors le type vient de l'EXTENSION, d'une table fermee de types media, et
 * tout le reste tombe sur `application/octet-stream`. Aucune entree de cette
 * table n'est executable par un navigateur : ni `html`, ni `svg`, ni `xml`.
 * C'est le raisonnement deja applique aux vignettes d'analyse
 * (`api/autopilot/analyses/[id]/vignettes/[n]/route.ts`).
 */

/** Le type de repli : des octets, que le navigateur ne cherchera pas a lire. */
export const TYPE_OCTETS = 'application/octet-stream';

/**
 * Extensions servies avec leur vrai type. Table FERMEE, volontairement.
 *
 * Ajouter une entree, c'est autoriser un navigateur a interpreter un fichier
 * televerse par un compte. `svg` en est absent pour cette raison : une image
 * SVG execute du script.
 */
export const TYPES_PAR_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  json: 'application/json',
};

/**
 * Le type sous lequel on servira cette cle.
 *
 * Extension inconnue, absente, ou nom se terminant par un point :
 * `application/octet-stream`. Toujours a accompagner de
 * `X-Content-Type-Options: nosniff` — sans lui, un navigateur peut renifler
 * le contenu et servir en HTML ce qu'on a annonce en octets.
 */
export function typeContenuDepuisCle(cle: string): string {
  const point = cle.lastIndexOf('.');
  if (point < 0 || point === cle.length - 1) return TYPE_OCTETS;
  const extension = cle.slice(point + 1).toLowerCase();
  return TYPES_PAR_EXTENSION[extension] ?? TYPE_OCTETS;
}

/** Caracteres de controle : jamais dans une cle legitime, utiles pour tromper un journal. */
const CARACTERES_DE_CONTROLE = /[\u0000-\u001f\u007f]/;

/**
 * Cette cle a-t-elle une forme acceptable ?
 *
 * Le controle porte sur la valeur BRUTE **et** sur sa version decodee :
 * Next.js decode deja les segments d'URL une fois, donc `%252e%252e` arrive
 * ici sous la forme `%2e%2e` et ne redeviendrait `..` qu'apres un second
 * decodage — celui que fait ce module.
 *
 * Refuse :
 *   - la chaine vide, et tout ce qui n'est pas une chaine ;
 *   - `..`     — `A/../B/x` satisfait un prefixe tout en designant B ;
 *   - `\`      — separateur d'un autre systeme, jamais dans une cle S3 ;
 *   - `://`    — une cle ne porte pas de schema ; c'est le signe d'une URL
 *                glissee la ou on attend une cle ;
 *   - les caracteres de controle.
 */
export function cleObjetValide(cle: unknown): cle is string {
  if (typeof cle !== 'string' || cle.length === 0) return false;
  let decodee: string;
  try {
    decodee = decodeURIComponent(cle);
  } catch {
    // Sequence d'echappement invalide : on ne devine pas ce qu'elle voulait dire.
    return false;
  }
  for (const valeur of [cle, decodee]) {
    if (valeur.includes('..')) return false;
    if (valeur.includes('\\')) return false;
    if (valeur.includes('://')) return false;
    if (CARACTERES_DE_CONTROLE.test(valeur)) return false;
  }
  return true;
}

/**
 * Prefixes partages, anterieurs a ce lot.
 *
 * `converted/` est ecrit par `api/convert/to-mp4` et `api/cron/publish` sans
 * identifiant de compte dans la cle : la conversion MP4 depose sous un nom
 * horodate commun a tous. Ces objets sont donc lisibles par tout compte
 * connecte, et ce lot ne le change pas — restreindre ici casserait le repli
 * de conversion du Calendrier et de l'export bureau sans rien remplacer.
 *
 * Ce qu'il faudra faire ensuite : donner a ces ecritures une cle
 * `<userId>/converted/…`, puis retirer cette liste. Tant qu'elle existe, elle
 * est le trou connu, ecrit, et delimite.
 */
export const PREFIXES_PARTAGES = ['converted/'] as const;

/**
 * Cette cle appartient-elle a ce compte ?
 *
 * Le prefixe EST la preuve de propriete : les cles sont fabriquees par le
 * serveur sous la forme `<userId>/<usage>/<horodatage>-<nom>`, et seul le nom
 * vient du navigateur. Meme raisonnement que `verifierObjet`.
 */
export function clePossedeePar(cle: unknown, userId: string): boolean {
  if (!userId) return false;
  if (!cleObjetValide(cle)) return false;
  if (cle.startsWith(`${userId}/`)) return true;
  return PREFIXES_PARTAGES.some((prefixe) => cle.startsWith(prefixe));
}
