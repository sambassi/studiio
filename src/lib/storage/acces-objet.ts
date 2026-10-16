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
import { estClePriveeAvatar } from '@/lib/avatar/source-cle';
import { bucketAutorise } from '@/lib/storage/buckets';

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

/**
 * Cette cle appartient-elle a ce compte, SANS aucun prefixe partage ?
 *
 * La version stricte de `clePossedeePar` : `converted/…` n'y passe pas. A
 * utiliser partout ou l'objet designe va etre LU PAR LE SERVEUR puis renvoye
 * ou transforme au nom du compte (conversion MP4, publication) — la ou un
 * prefixe commun a tous les comptes n'est pas une preuve de propriete.
 *
 * `userId` doit etre une chaine non vide sans `/` : un identifiant qui porte
 * lui-meme un separateur pourrait fabriquer un prefixe de deux segments et
 * matcher la cle d'un autre compte. La cle passe par `cleObjetValide`, donc
 * ni `..`, ni antislash, ni schema, ni echappement invalide.
 *
 * `u1x/…` n'appartient pas a `u1` : le separateur fait partie du prefixe.
 */
export function cleDuCompteStrict(cle: unknown, userId: unknown): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  if (userId.includes('/')) return false;
  if (!cleObjetValide(cle)) return false;
  return cle.startsWith(`${userId}/`);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * D'UNE URL A UNE CIBLE (compartiment + cle) — UN SEUL PARSEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Plusieurs routes recoivent une URL de media ecrite par un navigateur et
 * doivent en tirer `{ bucket, cle }` avant de lire l'objet. Chacune avait sa
 * propre lecture de `/storage/v1/object/public/<bucket>/<cle>`, avec ses
 * propres oublis : l'une acceptait n'importe quelle origine, l'autre gardait
 * la chaine de requete, une troisieme ne decodait pas. Le parseur est ecrit
 * ICI, une fois, et ne fait QUE parser : il ne juge pas la cle
 * (`cibleRecevable` s'en charge) et ne verifie pas la propriete
 * (`cleDuCompteStrict`).
 *
 * L'origine d'une URL absolue doit etre EXACTEMENT l'une des origines
 * configurees (`originesStockageConfigurees`) — jamais l'en-tete `Host`, qui
 * est fourni par l'appelant. Une URL vers un autre hote n'est pas « notre
 * stockage », meme si son chemin ressemble au notre.
 */
export const PREFIXE_RELAIS_PUBLIC = '/storage/v1/object/public/';

export interface CibleStockage { bucket: string; cle: string }

/** `http(s)` seulement : les seuls schemas qui ont une origine comparable. */
function origineHttp(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const brut = valeur.trim();
  if (brut.length === 0) return null;
  let url: URL;
  try { url = new URL(brut); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // `.origin` : hote en minuscules, port par defaut retire, jamais de `/` final.
  return url.origin;
}

/**
 * L'origine du stockage Supabase Cloud HISTORIQUE, ou `null`.
 *
 * Elle ne sert plus qu'a relire les anciens contenus : des URL absolues
 * `https://<projet>.supabase.co/storage/v1/object/public/…` persistees en base
 * avant la migration MinIO. Aucun contenu neuf n'y est ecrit.
 *
 *   - `SUPABASE_LEGACY_STORAGE_URL` (serveur seulement) fait autorite des
 *     qu'elle est DEFINIE. Vide ou invalide → aucune origine historique :
 *     c'est l'interrupteur de coupure, une fois le backfill termine.
 *   - Sinon, repli sur `NEXT_PUBLIC_SUPABASE_URL` : le comportement d'avant,
 *     inchange tant que la nouvelle variable n'est pas posee.
 *
 * ⚠️ JAMAIS `SUPABASE_URL` : cote serveur elle designe le PostgREST
 * auto-heberge (reseau Docker interne), pas un stockage. L'admettre ici
 * ouvrirait un hote interne aux relais de lecture.
 *
 * ⚠️ LECTURE PAR `env.X`, JAMAIS PAR `process.env.NEXT_PUBLIC_…` LITTERAL :
 * Next remplace ce litteral par sa valeur AU BUILD (client ET serveur), et le
 * Dockerfile y pose `https://placeholder.supabase.co`. Lue ainsi, la valeur
 * est celle de l'environnement d'execution (Coolify).
 */
export function origineSupabaseHistorique(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.SUPABASE_LEGACY_STORAGE_URL !== undefined) {
    return origineHttp(env.SUPABASE_LEGACY_STORAGE_URL);
  }
  return origineHttp(env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Les origines sous lesquelles NOTRE stockage peut etre designe, d'apres la
 * configuration : l'application (`NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`), le
 * CDN eventuel (`PUBLIC_STORAGE_URL`, dont on ne garde que l'origine) et
 * l'URL Supabase historique (`origineSupabaseHistorique`). Sans doublon, sans
 * barre oblique finale, `http(s)` seulement. Jamais le `Host` de la requete.
 */
export function originesStockageConfigurees(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const origines: string[] = [];
  for (const brut of [
    env.NEXT_PUBLIC_APP_URL,
    env.NEXTAUTH_URL,
    env.PUBLIC_STORAGE_URL,
    origineSupabaseHistorique(env) ?? undefined,
  ]) {
    const origine = origineHttp(brut);
    if (origine && !origines.includes(origine)) origines.push(origine);
  }
  return origines;
}

/**
 * `{ bucket, cle }` depuis une URL de relais public, ou `null`.
 *
 * Accepte :
 *   - un chemin relatif `/storage/v1/object/public/<bucket>/<cle…>` ;
 *   - une URL absolue `http(s)` dont l'ORIGINE est exactement l'une de
 *     `options.origines` (comparaison de `new URL(x).origin` : hote sans
 *     casse, port par defaut normalise) et dont le chemin porte ce prefixe.
 *
 * Refuse tout le reste : autre origine, `//hote/…` (relatif de protocole),
 * schema non `http(s)` (`data:`, `file:`, `ftp:`, `javascript:`, `blob:`),
 * identifiants (`user:pass@`), chaine de requete ou fragment, antislash,
 * compartiment ou cle vides, echappement invalide, valeur qui n'est pas une
 * chaine, blanc de tete ou de queue (il masque un schema).
 *
 * ⚠️ LE CHEMIN EST LU SUR LA CHAINE BRUTE, PAS SUR `url.pathname`. L'analyseur
 * WHATWG normalise `..` ET `%2e%2e` en remontant d'un segment : il aurait
 * transforme `media/u1/%2e%2e/x.mp4` en `media/x.mp4` — une traversee
 * blanchie avant que `cibleRecevable` puisse la voir. `new URL` ne sert ici
 * qu'a juger le schema, l'origine, les identifiants, la requete et le
 * fragment.
 *
 * Le compartiment et la cle sont decodes UNE fois (`decodeURIComponent`) :
 * c'est ce que fait Next.js pour les segments du relais, donc la cle rendue
 * ici est celle que le relais verrait. Un compartiment qui contient `/` apres
 * decodage (`media%2Fx`) est refuse : ce n'est plus un nom de compartiment.
 *
 * Ne valide PAS le contenu : `..`, namespaces prives, compartiment hors liste
 * sont le travail de `cibleRecevable`, a appeler ensuite.
 */
export function extraireCibleStockage(
  valeur: unknown,
  options: { origines: readonly string[] },
): CibleStockage | null {
  if (typeof valeur !== 'string' || valeur.length === 0) return null;
  if (valeur !== valeur.trim()) return null;
  // `?` et `#` n'ont rien a faire dans une adresse d'objet ; `\` non plus —
  // l'analyseur le lirait comme `/`, et une cle S3 n'en porte jamais.
  if (valeur.includes('?') || valeur.includes('#') || valeur.includes('\\')) return null;

  let cheminBrut: string;
  if (valeur.startsWith('/')) {
    // `//hote/…` est une URL relative au PROTOCOLE : une autre origine.
    if (valeur.startsWith('//')) return null;
    cheminBrut = valeur;
  } else {
    // `https:hote/x` (sans `//`) est accepte par l'analyseur ; pas ici.
    if (!/^https?:\/\//i.test(valeur)) return null;
    let url: URL;
    try { url = new URL(valeur); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;
    const admises = options.origines
      .map((o) => origineHttp(o))
      .filter((o): o is string => o !== null);
    if (!admises.includes(url.origin)) return null;
    // Sans identifiant, sans `\`, sans `?` ni `#` : le chemin commence au
    // premier `/` qui suit l'autorite.
    const debut = valeur.indexOf('/', valeur.indexOf('//') + 2);
    if (debut < 0) return null;
    cheminBrut = valeur.slice(debut);
  }

  if (!cheminBrut.startsWith(PREFIXE_RELAIS_PUBLIC)) return null;
  const reste = cheminBrut.slice(PREFIXE_RELAIS_PUBLIC.length);
  const separateur = reste.indexOf('/');
  if (separateur <= 0) return null;

  let bucket: string;
  let cle: string;
  try {
    bucket = decodeURIComponent(reste.slice(0, separateur));
    cle = decodeURIComponent(reste.slice(separateur + 1));
  } catch {
    // Sequence d'echappement invalide : on ne devine pas ce qu'elle voulait dire.
    return null;
  }
  if (bucket.length === 0 || bucket.includes('/')) return null;
  if (cle.length === 0) return null;
  return { bucket, cle };
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * LE NAMESPACE D'ANALYSE N'A RIEN A FAIRE SUR LA ROUTE PUBLIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lib/autopilot/analyse/extraction.ts` ecrit les vignettes sous
 * `media/<userId>/analyse/<analysisId>/vignette-NN.jpg` (voir la fabrication
 * de `cle` et `BUCKET_VIGNETTES`). Cette cle est DETERMINISTE : les deux
 * identifiants qui la composent sont deja dans le navigateur de l'ecran
 * d'analyse. `lib/autopilot/analyse/vignettes.ts` le dit noir sur blanc :
 * « Quiconque les a lit les vignettes de leur proprietaire ».
 *
 * Le seul acces legitime est
 * `GET /api/autopilot/analyses/[id]/vignettes/[n]`, qui exige une session,
 * relit la cle en base sous `.eq('user_id', …)` et n'accepte aucune cle
 * venue du client. Cette route-la n'est pas touchee.
 *
 * ⚠️ LE REFUS EST UN 404, JAMAIS UN 401 NI UN 403. Un code distinct
 * repondrait « ce namespace existe » — et comme la cle est devinable, ce seul
 * bit suffirait a confirmer qu'une analyse donnee a produit des vignettes.
 * On rend exactement ce que rend un objet absent.
 *
 * On refuse le NAMESPACE, pas le seul motif `vignette-NN.jpg` : tout ce qui
 * est range sous `analyse/` est un derive prive d'un rush. Une regle collee
 * au nom de fichier d'aujourd'hui laisserait passer celui de demain.
 */
export const BUCKET_NAMESPACE_ANALYSE = 'media';

/** Le segment de chemin qui porte le namespace. Compare sans casse. */
export const SEGMENT_NAMESPACE_ANALYSE = 'analyse';

/**
 * Decode jusqu'a point fixe, avec une borne.
 *
 * Next.js decode deja une fois les segments dynamiques. La forme BRUTE est
 * celle qui partira a MinIO, donc c'est elle qui suffit a la justesse : une
 * cle qui ne porte pas litteralement `/analyse/` ne peut pas designer une
 * vignette. Les formes decodees sont la pour tenir si un intermediaire — un
 * proxy, une version future de Next — decodait une fois de plus.
 */
function formesDecodees(valeur: string): string[] {
  const formes = [valeur];
  let courante = valeur;
  for (let i = 0; i < 4; i++) {
    let suivante: string;
    try {
      suivante = decodeURIComponent(courante);
    } catch {
      // Sequence d'echappement invalide : on ne devine pas ce qu'elle
      // voulait dire. `cleObjetValide` la refuse deja de son cote.
      break;
    }
    if (suivante === courante) break;
    formes.push(suivante);
    courante = suivante;
  }
  return formes;
}

/**
 * Cette cible vise-t-elle le namespace prive des analyses ?
 *
 * Vrai des qu'un SEGMENT de la cle vaut `analyse` — comparaison sans casse,
 * pour qu'un `Analyse/` ecrit un jour par une migration ne rouvre pas la
 * porte — avec au moins un segment non vide avant et un apres, c'est-a-dire
 * la forme `<quelque-chose>/analyse/<quelque-chose>`. Les segments vides
 * (`a//analyse//b`) ne comptent pas : ils ne sont pas « quelque chose ».
 *
 * Ne s'applique qu'au compartiment `media`, le seul ou l'extraction ecrit.
 */
/**
 * Un `purpose` d'envoi acceptable.
 *
 * ⚠️ SANS CETTE GARDE, LE BLOCAGE CI-DESSOUS CRÉE UNE VRAIE RÉGRESSION.
 *
 * Les trois routes d'envoi interpolent `purpose` tel quel dans la clé —
 * `<userId>/<purpose>/<horodatage>-<nom>` — sans aucune liste blanche, et
 * `sanitizeStorageFilename` ne s'applique qu'au NOM de fichier, jamais au
 * `purpose`. Un appelant qui demande `purpose: "analyse"` obtient donc une
 * clé `<userId>/analyse/…` **délivrée par notre propre serveur**, que le
 * blocage rendrait ensuite illisible — sans message, sans trace, et sans que
 * son propriétaire puisse comprendre pourquoi.
 *
 * Un audit l'a démontré en appelant les vraies routes, pas en le supposant.
 *
 * On refuse donc à l'écriture ce qu'on refuse à la lecture, plutôt que de
 * documenter un trou. Cela ferme aussi, au passage, la possibilité pour un
 * compte d'écrire dans son propre espace de vignettes : la clé
 * `<userId>/analyse/<analysisId>/vignette-NN.jpg` est déterministe, et rien
 * n'interdisait jusqu'ici de l'écraser.
 *
 * La barre oblique est refusée pour la même raison : elle permettrait de
 * fabriquer un segment réservé au milieu du chemin.
 */
export function purposeAcceptable(valeur: unknown): boolean {
  if (typeof valeur !== 'string' || valeur.length === 0) return false;
  if (valeur.includes('/') || valeur.includes('\\')) return false;
  if (valeur.includes('..') || valeur.includes('://')) return false;
  /* ⚠️ ET `lut` AUSSI. Même raisonnement : on refuse à l'écriture ce qu'on
     refuse à la lecture. Les routes d'envoi interpolent `purpose` tel quel
     dans la clé ; un `purpose: "lut"` accepté ici rendrait une clé
     `<userId>/lut/…` délivrée par notre propre serveur, que le relais public
     refuserait ensuite de servir — sans message et sans trace. Les LUT
     importées n'entrent que par leur route dédiée, qui construit la clé
     elle-même. */
  /* ⚠️ ET `avatar` — la source d'un clone (le VISAGE de la personne) n'entre
     que par la route d'enrôlement, qui construit sa clé. Aucun appelant
     n'envoie `purpose: "avatar"` aujourd'hui : ce refus ne casse rien, il
     ferme une porte avant qu'on la découvre. */
  return valeur !== SEGMENT_NAMESPACE_ANALYSE
    && valeur !== SEGMENT_NAMESPACE_LUT
    && valeur !== SEGMENT_NAMESPACE_AVATAR;
}

/**
 * Le domaine des MONTAGES de l'Autopilote, fermé pour la même raison.
 *
 * ⚠️ SANS CETTE GARDE, LA ROUTE AUTHENTIFIÉE NE PROTÈGE RIEN. M3-H sert le
 * montage par une route qui exige une session et refait le contrôle de
 * propriété — mais le même objet vit dans `videos`, un compartiment de la
 * liste blanche, donc ce relais le rendait SANS COOKIE. Le propriétaire
 * connaît les deux identifiants de la clé : il pouvait fabriquer un lien
 * public, permanent et irrévocable, ce qui vidait l'argument de sa
 * substance.
 *
 * Exactement le geste déjà appliqué aux vignettes d'analyse, et pour le même
 * motif. Aucun code ne lit un montage par ce relais : le fermer ne casse rien.
 */
export const BUCKET_NAMESPACE_MONTAGE = 'videos';
export const SEGMENT_NAMESPACE_MONTAGE = 'montages';

export function cleDansNamespaceMontage(bucket: unknown, cle: unknown): boolean {
  if (bucket !== BUCKET_NAMESPACE_MONTAGE) return false;
  return contientSegment(cle, SEGMENT_NAMESPACE_MONTAGE);
}

/**
 * Le domaine des LUT IMPORTÉES, fermé pour la même raison que les montages.
 *
 * Un look étalonné à la main est un travail que la personne peut vouloir
 * garder pour elle : le relais public en ferait un lien permanent que
 * personne ne pourrait révoquer. Son seul accès légitime est la route
 * authentifiée de la bibliothèque, qui refait le contrôle de propriété.
 * Aucun code ne lit une LUT par ce relais : le fermer ne casse rien.
 */
export const BUCKET_NAMESPACE_LUT = 'media';
export const SEGMENT_NAMESPACE_LUT = 'lut';

export function cleDansNamespaceLut(bucket: unknown, cle: unknown): boolean {
  if (bucket !== BUCKET_NAMESPACE_LUT) return false;
  return contientSegment(cle, SEGMENT_NAMESPACE_LUT);
}

/**
 * Le domaine des AVATARS — la source de référence d'un clone et les vidéos
 * qu'il produit, sous `<userId>/avatar/…`.
 *
 * Ce qu'on protège ici n'est pas un fichier, c'est un visage : la photo ou la
 * vidéo de référence de la personne elle-même (`source-<horodatage>.<ext>`,
 * voir `@/lib/avatar/source`). Ce lot ferme l'ÉCRITURE par les routes
 * génériques (`purposeAcceptable`) : une source n'entre que par la route
 * d'enrôlement, qui construit sa clé.
 *
 * LA LECTURE PAR LE RELAIS PUBLIC EST FERMÉE pour les objets PRIVÉS du
 * dossier — source, vidéo de consentement, audio de « ma voix »
 * (`cleSourceAvatarPrivee`, appliquée par `cibleRecevable`) ; la source ne
 * sort plus que par `/api/avatar/source`, authentifiée. Les vidéos générées
 * (`<userId>/avatar/<uuid>.mp4`) restent servies : une vidéo générée est un
 * livrable, pas une donnée biométrique.
 */
export const BUCKET_NAMESPACE_AVATAR = 'media';
export const SEGMENT_NAMESPACE_AVATAR = 'avatar';

export function cleDansNamespaceAvatar(bucket: unknown, cle: unknown): boolean {
  if (bucket !== BUCKET_NAMESPACE_AVATAR) return false;
  return contientSegment(cle, SEGMENT_NAMESPACE_AVATAR);
}

/**
 * Cette cible est-elle la SOURCE d'un avatar — le visage — et non une vidéo
 * générée sous le même dossier ?
 *
 * C'est la question que pose le relais public, en GET comme en HEAD, avant
 * tout appel au stockage. La forme est celle de `@/lib/avatar/source-cle`
 * (module pur : aucune base, aucun stockage — c'est ce qui autorise l'import
 * depuis ici sans cycle), appliquée à toutes les formes décodées comme le fait
 * `contientSegment`. Les vidéos générées (`<userId>/avatar/<uuid>.mp4`)
 * ne matchent pas : elles restent servies, à qui possède l'adresse, comme
 * aujourd'hui.
 */
export function cleSourceAvatarPrivee(bucket: unknown, cle: unknown): boolean {
  if (!cleDansNamespaceAvatar(bucket, cle)) return false;
  // Source, vidéo de consentement, audio de ma voix : les trois objets
  // privés du dossier (`estClePriveeAvatar`), jamais une vidéo générée.
  return formesDecodees(cle as string).some((forme) => estClePriveeAvatar(forme));
}

/** Le segment est-il ENTOURÉ d'autre chose, sous toutes ses formes décodées ? */
function contientSegment(cle: unknown, segment: string): boolean {
  if (typeof cle !== 'string' || cle.length === 0) return false;
  return formesDecodees(cle).some((forme) => {
    const segments = forme.split('/');
    for (let i = 0; i < segments.length; i++) {
      // ⚠️ SENSIBLE À LA CASSE, ET C'EST DÉLIBÉRÉ — voir plus bas.
      if (segments[i] !== segment) continue;
      const avant = segments.slice(0, i).some((s) => s.length > 0);
      const apres = segments.slice(i + 1).some((s) => s.length > 0);
      if (avant && apres) return true;
    }
    return false;
  });
}

export function cleDansNamespaceAnalyse(bucket: unknown, cle: unknown): boolean {
  if (bucket !== BUCKET_NAMESPACE_ANALYSE) return false;
  if (typeof cle !== 'string' || cle.length === 0) return false;
  return formesDecodees(cle).some((forme) => {
    const segments = forme.split('/');
    for (let i = 0; i < segments.length; i++) {
      // ⚠️ SENSIBLE À LA CASSE, ET C'EST DÉLIBÉRÉ.
      //
      // Les clés S3 sont exactes à l'octet près : `A/ANALYSE/…` désigne un
      // objet DIFFÉRENT, qui n'existe pas. Le bloquer ne rend donc aucune
      // vignette inaccessible — ça n'ajoute que des refus sur des clés qu'un
      // compte pourrait légitimement s'être données. Deux audits indépendants
      // ont conclu la même chose.
      if (segments[i] !== SEGMENT_NAMESPACE_ANALYSE) continue;
      const avant = segments.slice(0, i).some((s) => s.length > 0);
      const apres = segments.slice(i + 1).some((s) => s.length > 0);
      if (avant && apres) return true;
    }
    return false;
  });
}

/**
 * La cible est-elle recevable, sans avoir rien demandé au stockage ?
 *
 * Trois refus, une seule réponse (`introuvable`) : compartiment hors liste,
 * chemin malformé, et — depuis M3-B3.2a — namespace privé des analyses.
 *
 * L'ordre compte. La normalisation de chemin (`cleObjetValide` : `..`, antislash,
 * `://`, caractères de contrôle, sur la valeur brute ET décodée) passe AVANT
 * le refus du namespace, de sorte qu'aucune forme tordue ne puisse à la fois
 * échapper au motif `analyse/` et désigner malgré tout l'objet. Et la garde
 * de namespace relit elle-même les formes décodées, donc elle ne dépend pas
 * de l'ordre pour être juste — elle en dépend seulement pour rester lisible.
 *
 * ⚠️ `media/<userId>/analyse/<analysisId>/vignette-NN.jpg` est une clé
 * DEVINABLE (voir plus haut). Le seul accès légitime aux vignettes est
 * `/api/autopilot/analyses/[id]/vignettes/[n]`, authentifié. Sur le relais,
 * c'est 404 — pas 401, pas 403 : un code distinct signalerait que le
 * namespace existe.
 *
 * Cette composition vivait dans le relais public
 * (`app/storage/v1/object/public/[bucket]/[...path]/route.ts`). Elle est
 * ici pour que TOUTE route qui lit un objet au nom d'une URL fournie par un
 * navigateur — conversion MP4, publication, proxy — applique EXACTEMENT les
 * mêmes refus que le relais, sans en recopier la liste.
 */
export function cibleRecevable(bucket: string, cle: string): boolean {
  if (!bucketAutorise(bucket)) return false;
  if (!cleObjetValide(cle)) return false;
  if (cleDansNamespaceAnalyse(bucket, cle)) return false;
  // Le montage de l'Autopilote se lit par sa route authentifiée, jamais ici :
  // sinon le propriétaire pourrait en faire un lien public et permanent.
  if (cleDansNamespaceMontage(bucket, cle)) return false;
  // Même refus pour les LUT importées : un look est un travail privé, il se
  // lit par la route authentifiée de la bibliothèque, jamais par un lien
  // public permanent.
  if (cleDansNamespaceLut(bucket, cle)) return false;
  // La SOURCE d'un avatar — le visage de la personne — ne sort que par
  // `/api/avatar/source`, authentifiée. Les vidéos générées du même dossier
  // (`<userId>/avatar/<uuid>.mp4`) restent servies comme avant.
  if (cleSourceAvatarPrivee(bucket, cle)) return false;
  return true;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * LECTURE PAR LE SERVEUR AU NOM D'UN COMPTE — LE RELAIS, PLUS LA PROPRIÉTÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le serveur lit certains médias EN DIRECT dans MinIO (URL signée interne :
 * analyse ffmpeg, proxy de rendu, copie du rendu hybride). Ces URL viennent
 * de données écrites par l'utilisateur (`rush_urls`, musique, sources) : sans
 * garde, A pouvait y poser l'adresse d'un objet PRIVÉ de B et le faire signer,
 * lire et monter dans SON montage — le relais public, lui, l'aurait refusé.
 *
 * Deux conditions, dans cet ordre :
 *   1. `cibleRecevable` — EXACTEMENT la politique du relais public (liste des
 *      compartiments, chemin sain, namespaces privés : analyses, montages,
 *      LUT, source / consentement / audio d'avatar). Ce qui n'est pas servi
 *      publiquement n'est jamais lu au nom d'un compte non plus — pas même
 *      par son propriétaire : ces objets ont leurs routes authentifiées.
 *   2. la PROPRIÉTÉ, lue sur la clé (le préfixe EST la preuve, cf.
 *      `cleDuCompteStrict`) :
 *        - `<userId>/…`                       → ce compte seulement ;
 *        - `audio-complet/<userId>/…`,
 *          `stock-attributions/<userId>/…`,
 *          `fiches-contenu/<userId>/…`        → propriétaire au 2e segment ;
 *        - `media/externes/<fichier>` et
 *          `media/externes/proxies/<fichier>` → copies PARTAGÉES de médias
 *          publics (`medias-externes.ts`, clé = sha1 de l'URL d'origine) :
 *          lisibles par tout compte, elles ne contiennent rien de privé ;
 *        - tout le reste — y compris `converted/…` (préfixe commun, jamais
 *          une preuve de propriété) — est refusé.
 */
export const BUCKET_COPIES_EXTERNES = 'media';

/**
 * Namespaces dont le PROPRIÉTAIRE est le 2e segment de la clé.
 *
 * `fiches-contenu` (M2-a) : DÉFENSE EN PROFONDEUR. Ses clés portent déjà le
 * segment privé `analyse`, refusé plus haut par `cibleRecevable` ; si ce
 * refus venait à tomber, la propriété au 2e segment refuserait encore la
 * fiche de B à A (et non « tout le reste refusé » par accident de forme).
 */
export const NAMESPACES_PROPRIETAIRE_SECOND = ['audio-complet', 'stock-attributions', 'fiches-contenu'] as const;

const COPIE_EXTERNE = /^externes\/(?:proxies\/)?[^/]+$/;

export function cibleLisibleParCompte(bucket: string, cle: string, userId: unknown): boolean {
  if (typeof userId !== 'string' || userId.length === 0 || userId.includes('/')) return false;
  if (!cibleRecevable(bucket, cle)) return false;
  if (bucket === BUCKET_COPIES_EXTERNES && COPIE_EXTERNE.test(cle)) return true;
  const segments = cle.split('/');
  if ((NAMESPACES_PROPRIETAIRE_SECOND as readonly string[]).includes(segments[0])) {
    return segments.length >= 3 && segments[1] === userId && segments[segments.length - 1].length > 0;
  }
  return cleDuCompteStrict(cle, userId) && segments.length >= 2 && segments[segments.length - 1].length > 0;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * LE CHEMIN FAIT FOI, PAS L'HÔTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les gardes de propriété ne s'appliquaient qu'aux URL dont l'ORIGINE était
 * exactement configurée. La même clé atteinte par un autre nom — hôte de
 * staging, alias, IP de l'application, `http` au lieu de `https`, point
 * final (`studiio.pro.`), port explicite — était jugée « externe », copiée
 * par le fetch sûr DEPUIS NOTRE RELAIS PUBLIC (qui sert sans session), et
 * déposée dans `media/externes/…`, lisible par tous : la propriété n'était
 * jamais vérifiée.
 *
 * Règle : un chemin d'objet de stockage
 * (`/storage/v1/object/(public|sign|authenticated|private)/<bucket>/<clé>`),
 * QUEL QUE SOIT L'HÔTE, est un objet de NOTRE stockage et passe le contrôle
 * de propriété. Aucun CDN tiers n'emploie ce chemin — sauf Supabase, dont
 * l'instance historique est la nôtre.
 *
 *   - `null`    : aucune forme du chemin ne ressemble à un objet de stockage ;
 *   - `'refus'` : il y ressemble sous une forme décodée, normalisée ou d'une
 *                 autre casse, mais pas sous la forme canonique exacte
 *                 (`%2F`, `%252F`, `\`, `//`, `/./`, `PUBLIC`…) — on ne
 *                 devine pas ce qu'un intermédiaire en ferait ;
 *   - la cible : compartiment et clé décodés UNE fois (ce que voit le relais),
 *                plus la clé BRUTE — les gardes doivent passer sur les deux.
 *
 * Pure. La chaîne de requête et le fragment ne participent pas au chemin.
 */
export type AccesStockage = 'public' | 'sign' | 'authenticated' | 'private';
export interface CibleParChemin extends CibleStockage { cleBrute: string; acces: AccesStockage }

const CHEMIN_STOCKAGE_CANONIQUE = /^\/storage\/v1\/object\/(public|sign|authenticated|private)\/([^/]+)\/(.+)$/;

/** Le chemin brut (avant `?`/`#`) d'une URL absolue ou relative, ou `null`. */
function cheminBrutDe(valeur: string): string | null {
  if (valeur.startsWith('/') && !valeur.startsWith('//')) return valeur.split(/[?#]/)[0];
  const m = /^[a-z][a-z0-9+.-]*:[\\/]{2}[^/\\?#]*/i.exec(valeur);
  if (!m) return null;
  const reste = valeur.slice(m[0].length).split(/[?#]/)[0];
  return reste.length ? reste : '/';
}

/** Le chemin désigne-t-il un objet de stockage, sous l'une de ses formes ? */
function ressembleStockage(formes: string[]): boolean {
  return formes.some((f) => /\/storage\/v1\/object(\/|$)/i.test(f.replace(/\\/g, '/').replace(/\/{2,}/g, '/')));
}

/**
 * Décodage TOLÉRANT, pour RECONNAÎTRE seulement : chaque `%XX` valide est
 * décodé, les séquences invalides restent telles quelles. `formesDecodees`
 * s'arrête à la première séquence invalide — un `%ZZ` glissé ailleurs dans le
 * chemin suffisait à masquer `%73torage/…`.
 */
function formesTolerantes(valeur: string): string[] {
  const formes = [valeur];
  let courante = valeur;
  for (let i = 0; i < 4; i++) {
    const suivante = courante.replace(/%([0-9a-f]{2})/gi, (_t, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (suivante === courante) break;
    formes.push(suivante);
    courante = suivante;
  }
  return formes;
}

/** Toutes les formes d'un chemin qu'on examine pour le reconnaître. */
function formesDe(chemin: string): string[] {
  return [...formesDecodees(chemin), ...formesTolerantes(chemin)];
}

/**
 * Les deux analyseurs voient-ils le MÊME chemin ? Comparaison des formes
 * décodées une fois : l'analyseur WHATWG échappe certains caractères (espace,
 * guillemets, non-ASCII) sans changer ce qu'ils désignent, mais toute
 * normalisation qui change la cible (`.`/`..`, `%2e`, antislash, tabulation
 * retirée) change aussi la forme décodée.
 */
function memeChemin(brut: string, whatwg: string): boolean {
  if (brut === whatwg) return true;
  try { return decodeURIComponent(brut) === decodeURIComponent(whatwg); } catch { return false; }
}

export function cibleStockageParChemin(valeur: unknown): CibleParChemin | 'refus' | null {
  if (typeof valeur !== 'string' || valeur.length === 0) return null;
  const brut = cheminBrutDe(valeur.trim());
  // Forme normalisée par l'analyseur WHATWG — celui de `new URL`, donc du
  // fetch sûr et de tout client HTTP : c'est CE chemin qui part réellement
  // sur le réseau et que le routeur Next.js associe au relais.
  //
  // ⚠️ ELLE EST CALCULÉE MÊME QUAND LA LECTURE BRUTE ÉCHOUE. WHATWG accepte
  // des formes que `cheminBrutDe` ne découpe pas — `https:hote/…`,
  // `https:/hote/…`, `ht<TAB>tps://…`, un caractère de contrôle en tête —
  // et les envoie bel et bien au relais. Sans elle, ces URL étaient jugées
  // « hors stockage » : ni propriété, ni refus, l'objet d'un autre compte
  // était lu puis publié.
  let normalise: string | null = null;
  try {
    normalise = new URL(valeur, 'http://studiio.invalid').pathname;
  } catch { /* URL invalide : aucun client ne l'enverra telle quelle */ }
  const formes = [...(brut !== null ? formesDe(brut) : []), ...(normalise !== null ? formesDe(normalise) : [])];
  if (!ressembleStockage(formes)) return null;
  // Ressemble à un objet de stockage : les deux lectures doivent désigner le
  // même chemin, sous la forme canonique exacte, sinon on ne devine pas.
  if (brut === null || normalise === null) return 'refus';
  if (valeur !== valeur.trim()) return 'refus';
  if (!memeChemin(brut, normalise)) return 'refus';
  const m = CHEMIN_STOCKAGE_CANONIQUE.exec(brut);
  if (!m) return 'refus';
  const [, acces, bucketBrut, cleBrute] = m;
  let bucket: string;
  let cle: string;
  try {
    bucket = decodeURIComponent(bucketBrut);
    cle = decodeURIComponent(cleBrute);
  } catch {
    return 'refus';
  }
  // Un nom de compartiment n'a rien à échapper.
  if (bucket !== bucketBrut || bucket.length === 0) return 'refus';
  if (cle.length === 0) return 'refus';
  return { bucket, cle, cleBrute, acces: acces as AccesStockage };
}

/**
 * Cette cible (par chemin) est-elle lisible par ce compte — sur la clé
 * décodée ET sur la clé brute ? Pure.
 */
export function cibleParCheminLisible(cible: CibleParChemin, userId: unknown): boolean {
  return cibleLisibleParCompte(cible.bucket, cible.cle, userId)
    && cibleLisibleParCompte(cible.bucket, cible.cleBrute, userId);
}
