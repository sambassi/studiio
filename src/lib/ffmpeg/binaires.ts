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
 * Le binaire ffmpeg : paquet embarqué d'abord, binaire système ensuite.
 *
 * `FFMPEG_PATH` gagne SANS être vérifié. Un chemin explicite qu'on ignore
 * parce qu'il ne répond pas est la pire des réponses : celui qui l'a posé
 * croit piloter la machine, et c'est un autre binaire qui tourne. Un chemin
 * faux doit produire un `ENOENT` visible, pas un silence.
 */
export function cheminFfmpeg(): string {
  const force = process.env.FFMPEG_PATH;
  if (force) return force;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static');
    if (typeof p === 'string' && p && lisible(p)) return p;
  } catch { /* paquet absent : on tente les emplacements connus */ }

  const candidats = [
    // Le paquet, atteint par le chemin plutot que par `require` : sous le
    // transformateur ESM des tests, `require` n'existe pas, et le binaire
    // serait declare absent alors qu'il est la.
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ];
  for (const c of candidats) if (lisible(c)) return c;

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
