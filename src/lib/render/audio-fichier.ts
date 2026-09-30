/**
 * Le FICHIER rendu a-t-il réellement du son ? Mesuré par ffmpeg sur le MP4
 * final (`volumedetect`), jamais déduit de la configuration.
 *
 * Un MP4 peut porter une piste AAC entièrement muette (-91 dB) : c'est ce
 * qu'a produit l'Autopilote sur staging quand musique, voix et son du rush
 * manquaient tous. « Piste présente » ne prouve donc rien ; seul le volume
 * mesuré le fait.
 */
import { spawn } from 'child_process';

export interface MesureAudioFichier {
  /** Une piste audio existe dans le conteneur. */
  piste: boolean;
  /** Volume moyen / crête mesurés (dB), `null` sans piste. */
  moyenDb: number | null;
  maxDb: number | null;
  /** Vrai si la piste manque ou si sa crête reste sous -60 dB. */
  silencieux: boolean;
}

/** Seuil sous lequel une piste est considérée comme silencieuse. */
export const SEUIL_SILENCE_DB = -60;

/** Lit la sortie d'erreur de `ffmpeg -af volumedetect`. Pure, testable. */
export function lireVolumedetect(journal: string): MesureAudioFichier {
  const piste = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(journal);
  const moy = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(journal);
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(journal);
  const nombre = (m: RegExpExecArray | null) => (m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null);
  const maxDb = piste ? nombre(max) : null;
  return {
    piste,
    moyenDb: piste ? nombre(moy) : null,
    maxDb,
    silencieux: !piste || maxDb === null || maxDb < SEUIL_SILENCE_DB,
  };
}

/** Mesure le son d'un fichier local. `null` si ffmpeg est introuvable ou échoue. */
export function mesurerAudioFichier(chemin: string, ffmpeg = 'ffmpeg', timeoutMs = 60_000): Promise<MesureAudioFichier | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-i', chemin, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let journal = '';
    const minuteur = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, timeoutMs);
    p.stderr.on('data', (b: Buffer) => { journal += b.toString(); });
    p.on('error', () => { clearTimeout(minuteur); resolve(null); });
    p.on('close', () => { clearTimeout(minuteur); resolve(lireVolumedetect(journal)); });
  });
}
