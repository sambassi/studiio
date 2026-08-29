/**
 * Où sont ffmpeg et ffprobe — un seul endroit qui le sait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le dépôt résout aujourd'hui ffmpeg à TROIS endroits, avec trois listes de
 * candidats différentes : `api/convert/to-mp4`, `api/cron/publish` et
 * `lib/autopilot/render.ts`. Trois copies d'une résolution de binaire ne
 * divergent pas tout de suite ; elles divergent le jour où l'une apprend un
 * nouvel emplacement et pas les autres — et ce jour-là un chemin trouve
 * ffmpeg quand l'autre ne le trouve plus, sans que rien ne le signale.
 *
 * Ce module est le quatrième appelant possible, et il est écrit pour être le
 * seul à terme. Il ne MODIFIE aucun des trois existants : les faire migrer
 * touche au cron de publication et à la conversion MP4, deux chemins de
 * production que ce lot n'a pas à remuer. La consolidation est un lot à part.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `ffmpeg-static` NE FOURNIT PAS `ffprobe`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le paquet n'installe qu'un seul exécutable, `ffmpeg`. Il n'y a donc AUCUN
 * `ffprobe` à côté de lui, et chercher un frère du binaire embarqué est une
 * perte de temps garantie.
 *
 * En production, `ffprobe` vient d'ailleurs : le `Dockerfile` installe le
 * paquet Debian `ffmpeg`, qui livre `/usr/bin/ffmpeg` ET `/usr/bin/ffprobe`.
 * C'est vrai aujourd'hui, ce n'est pas déclaré comme un contrat, et c'est
 * exactement pourquoi l'appelant doit savoir se passer de ffprobe plutôt que
 * de le supposer présent.
 */
import { accessSync, constants } from 'fs';
import { join } from 'path';

/**
 * Le binaire ffmpeg : binaire système d'abord, paquet embarqué en secours.
 *
 * `FFMPEG_PATH` gagne SANS être vérifié. Un chemin explicite qu'on ignore
 * parce qu'il ne répond pas est la pire des réponses : celui qui l'a posé
 * croit piloter la machine, et c'est un autre binaire qui tourne. Un chemin
 * faux doit produire un `ENOENT` visible, pas un silence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI LE SYSTÈME PASSE AVANT `ffmpeg-static`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le binaire d'`ffmpeg-static` est lié STATIQUEMENT, sur une glibc plus
 * ancienne que celle de l'image. Or une glibc statique n'embarque pas la
 * résolution de noms : `getaddrinfo` va chercher son module NSS par
 * `dlopen`, à chaud, et charge donc une bibliothèque partagée qui ne
 * correspond pas à la sienne. Le processus meurt sur SIGSEGV — sans un
 * octet sur stderr.
 *
 * Ce n'est pas un cas rare ici, c'est le cas NOMINAL : l'unique appelant de
 * ce module sonde des rushes par une URL http signée dont l'hôte est le nom
 * interne du stockage (`studiio-minio`). Toute URL portant un nom d'hôte —
 * donc chacune des nôtres — déclenche la résolution, donc la panne. Une URL
 * à adresse IP littérale, elle, passe : c'est bien le résolveur qui meurt,
 * pas le protocole. Constaté en production le 2026-08-29 : huit vignettes
 * attendues, zéro produite, huit fois `signal=SIGSEGV`.
 *
 * Le binaire du système est lié dynamiquement : il utilise le NSS de la
 * machine sur laquelle il tourne, et n'a pas ce défaut. C'est déjà lui qui
 * fournit `ffprobe`, sur exactement les mêmes URL, sans incident — la
 * démonstration est faite par le fonctionnement de la sonde.
 *
 * ⚠️ Le renversement fait perdre l'homogénéité de version que le paquet
 * embarqué apportait : la production exécute désormais le ffmpeg de Debian
 * (`Dockerfile`, `apt-get install ffmpeg`), plus ancien que le paquet. Toute
 * option ajoutée par un appelant doit donc exister dans cette version-là.
 *
 * `ffmpeg-static` reste une dépendance et reste le repli : il couvre les
 * installations sans ffmpeg système. Il n'est simplement plus le premier
 * servi là où l'on parle à un hôte.
 */
export function cheminFfmpeg(): string {
  const force = process.env.FFMPEG_PATH;
  if (force) return force;

  const systeme = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ];
  for (const c of systeme) if (lisible(c)) return c;

  // ── Le repli : le paquet embarqué, par ses DEUX voies ─────────────────
  //
  // Aucune des deux ne couvre l'autre, et c'est pour cela qu'elles restent
  // toutes les deux : elles ne partent pas du même point.
  //
  // `require` résout le paquet depuis l'emplacement de CE module, en suivant
  // le hissage et les liens ; le chemin en dur part du RÉPERTOIRE COURANT.
  // Les deux divergent dès que ces deux points ne coïncident pas — un
  // worktree dont le `node_modules` est un lien, un dépôt en espace de
  // travail, une sortie `standalone` — et l'une trouve alors le binaire là
  // où l'autre le déclare absent.
  //
  // Le `catch` reste, lui, pour le cas où `require` n'existe pas ou échoue
  // selon le contexte d'exécution. Attention toutefois à ne pas s'en
  // remettre à une croyance commode : sous Vitest, `require` EST disponible
  // et rend bien le chemin du paquet. Cette voie n'est donc pas du code mort
  // en test — elle est exécutable, et donc vérifiable.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static');
    if (typeof p === 'string' && p && lisible(p)) return p;
  } catch { /* paquet absent, ou `require` indisponible : on tente le chemin */ }

  const embarque = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (lisible(embarque)) return embarque;

  // Dernier recours : le PATH. Si rien n'y répond, le lancement échoue avec
  // `ENOENT`, que l'appelant traduit — plutôt que de deviner ici.
  return 'ffmpeg';
}

/**
 * Le binaire ffprobe. Le PATH en dernier recours, jamais `null`.
 *
 * UN SEUL mécanisme décide que ffprobe est absent : le `ENOENT` du
 * lancement. Rendre `null` ici en ajouterait un second — un module qui
 * annonce l'absence, et un lancement qui la constate — et deux mécanismes
 * pour un même fait finissent par se contredire. Le PATH reste tenté parce
 * qu'un ffprobe installé ailleurs (Homebrew, image dérivée) doit continuer
 * de fonctionner. `FFPROBE_PATH` l'emporte sans vérification, pour la même
 * raison que `FFMPEG_PATH` — et c'est aussi ce qui permet de faire jouer le
 * repli sur ffmpeg pendant un test, sans porte dérobée dans le module.
 */
export function cheminFfprobe(): string {
  const force = process.env.FFPROBE_PATH;
  if (force) return force;

  const candidats = [
    '/usr/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/opt/homebrew/bin/ffprobe',
  ];
  for (const c of candidats) if (lisible(c)) return c;

  return 'ffprobe';
}

function lisible(chemin: string): boolean {
  try {
    accessSync(chemin, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
