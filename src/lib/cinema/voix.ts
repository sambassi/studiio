/**
 * LES VOIX DU FILM — synthese des repliques, cote serveur.
 *
 * Elle reutilise le MEME moteur que le reste de Studiio : `msedge-tts`, celui
 * de `/api/tts/edge`. C'est un service GRATUIT ; aucun fournisseur payant
 * n'est appele ici, et il n'y a pas de repli payant — un repli silencieux vers
 * un service facture serait exactement le genre de cout qu'on ne voit qu'au
 * relevé.
 *
 * ⚠️ REGLE TENUE : LA VOIX N'EST JAMAIS ACCELEREE pour tenir une duree. C'est
 * la duree du plan qui s'aligne sur la voix mesuree
 * (`ajusterDureesSurVoix`), jamais l'inverse. La qualite sonore validee du
 * projet depend de ce sens-la.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { spawn } from 'child_process';
import { rm } from 'fs/promises';
import os from 'os';
import { mkdir, writeFile, stat } from 'fs/promises';
import path from 'path';
import type { Film } from '@/lib/cinema/types';
import { VOIX_NARRATEUR } from '@/lib/cinema/personnages';

/**
 * DEUX MOTEURS, LES DEUX GRATUITS, dans cet ordre :
 *
 *   1. `edge` — `msedge-tts`, celui du reste de Studiio. Qualite neurale.
 *   2. `systeme` — la commande `say` de macOS, puis ffmpeg. HORS LIGNE, donc
 *      disponible meme quand le WebSocket d'Edge est refuse (c'est le cas
 *      constate sur ce poste le 2026-10-26 : « Connect Error »).
 *
 * Le repli est annonce, jamais silencieux : `synthetiserFilm` rend le moteur
 * reellement utilise et le motif du repli. Un film qui part avec une voix
 * differente de celle attendue sans le dire est un bug qu'on decouvre a
 * l'ecoute, trop tard.
 *
 * ⚠️ AUCUN REPLI PAYANT. `/api/tts/edge` se rabat, lui, sur OpenAI ; ce
 * module ne le fait pas : un module de prototype qui appelle un service
 * facture est un cout qu'on ne voit qu'au relevé.
 */
export type MoteurVoix = 'edge' | 'systeme';

/** Correspondance voix Edge -> voix systeme macOS, a timbre comparable. */
export const VOIX_SYSTEME: Record<string, string> = {
  'fr-FR-DeniseNeural': 'Sandy',
  'fr-FR-HenriNeural': 'Thomas',
  'fr-FR-VivienneMultilingualNeural': 'Flo',
};
export const VOIX_SYSTEME_DEFAUT = 'Thomas';

/** Pause respirée ajoutée apres chaque replique, en secondes. */
export const RESPIRATION_S = 0.35;
const DELAI_FLUX_MS = 30_000;

/** Une replique synthetisee : son fichier et sa duree REELLE. */
export interface VoixPlan {
  planId: string;
  /** Chemin servi par `public/` (ce que la composition recevra). */
  url: string;
  /** Chemin absolu sur le disque. */
  fichier: string;
  octets: number;
}

export async function synthetiser(texte: string, voix: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voix, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(texte);
    const morceaux: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      let minuterie = setTimeout(() => reject(new Error('flux TTS muet')), DELAI_FLUX_MS);
      audioStream.on('data', (c: Buffer) => {
        clearTimeout(minuterie);
        minuterie = setTimeout(() => reject(new Error('flux TTS interrompu')), DELAI_FLUX_MS);
        morceaux.push(c);
      });
      audioStream.on('end', () => { clearTimeout(minuterie); resolve(); });
      audioStream.on('error', (e: Error) => { clearTimeout(minuterie); reject(e); });
    });
    const audio = Buffer.concat(morceaux);
    // Edge rend parfois 0 octet quand une voix a quitte le catalogue : le dire
    // ici, sinon le film part muet sans qu'aucune erreur ne remonte.
    if (audio.length === 0) throw new Error(`voix sans audio : ${voix}`);
    return audio;
  } finally {
    try { tts.close(); } catch { /* fermeture sans consequence */ }
  }
}

/**
 * Synthese HORS LIGNE par `say`, convertie en MP3 par ffmpeg — le meme
 * binaire que le reste du depot (`lib/ffmpeg/binaires`), pas un troisieme
 * chemin de resolution.
 */
export async function synthetiserSysteme(texte: string, voix: string): Promise<Buffer> {
  const { cheminFfmpeg } = await import('@/lib/ffmpeg/binaires');
  const { readFile } = await import('fs/promises');
  const base = path.join(os.tmpdir(), `cinema-voix-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const aiff = `${base}.aiff`;
  const mp3 = `${base}.mp3`;
  const voixSysteme = VOIX_SYSTEME[voix] ?? VOIX_SYSTEME_DEFAUT;
  try {
    // Le texte part en ARGUMENT, jamais dans un shell : aucune interpolation.
    // Pas de `--data-format` : associe a une sortie `.aiff`, `say` refuse le
    // fichier (« Opening output file failed: fmt? »). Le format par defaut
    // convient, ffmpeg s'occupe de la conversion juste apres.
    await commande('say', ['-v', voixSysteme, '-o', aiff, texte]);
    await commande(cheminFfmpeg(), ['-i', aiff, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', '24000', '-ac', '1', '-y', mp3]);
    const audio = await readFile(mp3);
    if (audio.length === 0) throw new Error(`voix systeme sans audio : ${voixSysteme}`);
    return audio;
  } finally {
    await rm(aiff, { force: true }).catch(() => {});
    await rm(mp3, { force: true }).catch(() => {});
  }
}

function commande(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let err = '';
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} code ${code} : ${err.slice(-500)}`)));
  });
}

/** La voix d'une replique : celle du personnage, sinon celle du narrateur. */
export function voixDuPlan(film: Film, personnageId: string | null): string {
  if (!personnageId) return VOIX_NARRATEUR;
  return film.personnages.find((p) => p.id === personnageId)?.voix ?? VOIX_NARRATEUR;
}

export interface ResultatVoix {
  voix: Record<string, string>;
  details: VoixPlan[];
  echecs: Array<{ planId: string; motif: string }>;
  /** Le moteur qui a reellement produit les voix. */
  moteur: MoteurVoix;
  /** Pourquoi le moteur demande a cede la place, s'il a cede. */
  motifRepli: string | null;
}

/**
 * Synthetise toutes les repliques du film dans `public/<dossierRelatif>`.
 * Rien n'est retente : un echec de voix est RENDU, pas masque — un film qui
 * part muet sans message est plus couteux a diagnostiquer qu'un echec net.
 */
export async function synthetiserFilm(
  film: Film,
  options: {
    racinePublique: string;
    dossierRelatif?: string;
    /** Limiter la synthese a ces scenes. Absent = tout le film. */
    scenes?: readonly string[];
    /** `true` (defaut) : un fichier deja la n'est pas resynthetise. */
    reutiliser?: boolean;
    /** Moteur demande. Defaut `edge`, avec repli `systeme` annonce. */
    moteur?: MoteurVoix;
    /** `false` : pas de repli, un echec reste un echec. */
    repli?: boolean;
  },
): Promise<ResultatVoix> {
  const relatif = options.dossierRelatif ?? path.join('cinema', film.id);
  const dossier = path.join(options.racinePublique, relatif);
  await mkdir(dossier, { recursive: true });

  const voix: Record<string, string> = {};
  const details: VoixPlan[] = [];
  const echecs: Array<{ planId: string; motif: string }> = [];

  const filtre = options.scenes ? new Set(options.scenes) : null;
  const reutiliser = options.reutiliser !== false;
  let moteur: MoteurVoix = options.moteur ?? 'edge';
  let motifRepli: string | null = null;

  const produire = async (texte: string, voixId: string): Promise<Buffer> => {
    if (moteur === 'systeme') return synthetiserSysteme(texte, voixId);
    try {
      return await synthetiser(texte, voixId);
    } catch (e) {
      if (options.repli === false) throw e;
      // Le moteur bascule UNE fois pour tout le film : reessayer Edge a
      // chaque replique ajouterait une attente par plan pour le meme echec.
      moteur = 'systeme';
      motifRepli = e instanceof Error ? e.message : 'echec du moteur edge';
      return synthetiserSysteme(texte, voixId);
    }
  };

  for (const scene of film.scenes) {
    for (const plan of scene.plans) {
      const replique = plan.dialogue?.texte?.trim();
      if (!replique) continue;
      const fichierAttendu = path.join(dossier, `${plan.id}.mp3`);
      const urlAttendue = path.posix.join(relatif.split(path.sep).join('/'), `${plan.id}.mp3`);
      // Un fichier deja la est repris tel quel : resynthetiser une replique
      // inchangee ne produirait pas un meilleur son, seulement du temps perdu.
      if (reutiliser) {
        try {
          const info = await stat(fichierAttendu);
          if (info.size > 0) {
            voix[plan.id] = urlAttendue;
            details.push({ planId: plan.id, url: urlAttendue, fichier: fichierAttendu, octets: info.size });
            continue;
          }
        } catch { /* pas de fichier : on synthetise */ }
      }
      if (filtre && !filtre.has(scene.id)) continue;
      try {
        const audio = await produire(replique, voixDuPlan(film, plan.dialogue?.personnageId ?? null));
        const fichier = path.join(dossier, `${plan.id}.mp3`);
        await writeFile(fichier, audio);
        const url = path.posix.join(relatif.split(path.sep).join('/'), `${plan.id}.mp3`);
        voix[plan.id] = url;
        details.push({ planId: plan.id, url, fichier, octets: audio.length });
      } catch (e) {
        echecs.push({ planId: plan.id, motif: e instanceof Error ? e.message : 'echec inconnu' });
      }
    }
  }
  return { voix, details, echecs, moteur, motifRepli };
}

/**
 * Aligne la duree des plans sur la voix MESUREE (ffprobe), plus une
 * respiration. Un plan dont la voix est plus longue que l'estimation serait
 * coupe net ; c'est l'estimation qui cede, jamais la parole.
 */
export function ajusterDureesSurVoix(film: Film, dureesMesurees: Readonly<Record<string, number>>): Film {
  const scenes = film.scenes.map((scene) => ({
    ...scene,
    plans: scene.plans.map((plan) => {
      const mesuree = dureesMesurees[plan.id];
      if (!mesuree || !Number.isFinite(mesuree)) return plan;
      const requise = Math.round((mesuree + RESPIRATION_S) * 10) / 10;
      if (requise <= plan.dureeS) return plan;
      return {
        ...plan,
        dureeS: requise,
        dialogue: plan.dialogue ? { ...plan.dialogue, dureeS: Math.round(mesuree * 10) / 10 } : null,
      };
    }),
  }));
  return { ...film, scenes };
}
