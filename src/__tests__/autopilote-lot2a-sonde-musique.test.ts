// @vitest-environment node
/**
 * LOT 2A (correctif) — LA SONDE DES SOURCES MUSICALES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DEFAUT QUE CE FICHIER VERROUILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lot 2A faisait passer la musique par `sonderSource`, la sonde des CLIPS.
 * Celle-ci cherche d'abord un flux `codec_type === 'video'` et refuse le
 * fichier s'il n'en trouve pas — parfaitement juste pour un clip, FAUX pour
 * un MP3. Un MP3 sans pochette n'a qu'un flux audio : il ressortait donc en
 * `clip_illisible`, le rendu s'arretait a l'etape `source`, et l'ecran
 * accusait un rush parfaitement sain. Constate en production le 2026-09-03
 * sur deux rendus consecutifs (`2228920b…`, `ce48c778…`).
 *
 * Pire, le defaut etait INTERMITTENT A L'OREILLE : un MP3 AVEC pochette
 * passait, parce qu'une pochette est un flux video. Le resultat ne doit
 * dependre de rien de tel.
 *
 * ⚠️ FFMPEG EST REEL, LES FIXTURES SONT DE VRAIS FICHIERS. Un doublon de
 * ffprobe prouverait seulement que le doublon dit ce qu'on lui a souffle :
 * c'est precisement ce qu'un JSON de flux invente n'aurait pas montre.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileP = promisify(execFile);

// ───────────────────────────────────────────────────────────────────────────
// Le stockage, double : il sert des fixtures locales (meme montage qu'en M3-H)
// ───────────────────────────────────────────────────────────────────────────
const objets = new Map<string, string>();

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lecteurMinio: () => ({
    getObject: async (_bucket: string, cle: string) => {
      const fichier = objets.get(cle);
      if (!fichier) throw new Error('objet absent studiio-minio:9000');
      return createReadStream(fichier);
    },
  }),
}));

import {
  sonderSource, sonderSourceAudio,
} from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { produireMontage } from '@/lib/autopilot/analyse/rendu';
import { reinitialiserCapacite } from '@/lib/autopilot/analyse/capacite';
import { MOTIFS_RENDU } from '@/lib/autopilot/analyse/rendu-contrat';
import { messageEchec } from '@/lib/autopilot/analyse/rendu-passerelle';
import { BUCKET_MUSIQUE, RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { MontagePlan, PlanMontage } from '@/lib/autopilot/analyse/montage-contrat';

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const RECADRAGE = { x: 0, y: 0, largeur: 1, hauteur: 1 };

function outilPresent(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());

let atelier = '';
const F = {
  musiqueSansPochette: '', musiqueAvecPochette: '',
  videoMuette: '', videoSonore: '', corrompu: '',
};

async function fabriquerFixtures(): Promise<void> {
  F.musiqueSansPochette = join(atelier, 'musique-sans-pochette.mp3');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8:sample_rate=44100',
    '-c:a', 'libmp3lame', '-b:a', '128k', F.musiqueSansPochette,
  ], { timeout: 120_000 });

  // La MEME musique, plus une pochette. C'est le seul ecart entre les deux.
  const pochette = join(atelier, 'pochette.png');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=orange:s=320x320:d=1', '-frames:v', '1', pochette,
  ], { timeout: 60_000 });
  F.musiqueAvecPochette = join(atelier, 'musique-avec-pochette.mp3');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', F.musiqueSansPochette, '-i', pochette,
    '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'copy',
    '-id3v2_version', '3', '-disposition:v', 'attached_pic', F.musiqueAvecPochette,
  ], { timeout: 120_000 });

  F.videoMuette = join(atelier, 'video-muette.mp4');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=1920x1080:d=6:r=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-an', '-t', '6', F.videoMuette,
  ], { timeout: 120_000 });

  F.videoSonore = join(atelier, 'video-sonore.mp4');
  await execFileP(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:d=6:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', '6', F.videoSonore,
  ], { timeout: 120_000 });

  // Des octets qui ne sont aucun media : ffprobe sort en erreur.
  F.corrompu = join(atelier, 'corrompu.mp3');
  writeFileSync(F.corrompu, Buffer.alloc(4096, 0x7a));
}

function unPlan(over: Partial<PlanMontage> & { ordre: number }): PlanMontage {
  return {
    rangClip: over.ordre, bucket: 'videos',
    cle: `${UID}/autopilote/clips/jeu/rang-0${over.ordre}.mp4`,
    entreeSecondes: 0, dureeRetenueSecondes: 5, debutTimelineSecondes: 0,
    raccourci: false, recadrage: RECADRAGE, strategieRecadrage: 'aucun',
    largeurSource: 1920, hauteurSource: 1080, raccordEntrant: 'coupe',
    ...over,
  } as PlanMontage;
}

function unMontage(plans: PlanMontage[]): MontagePlan {
  const total = plans.reduce((t, p) => t + p.dureeRetenueSecondes, 0);
  return {
    id: 'r1', userId: UID, montagePlanId: 'p1', clipSetId: 'c1', clipSetVersion: 1,
    candidateSetId: 'cs1', analysisId: 'a1', algorithme: 'm3e-v3',
    methodeMaterialisation: 'x264-crf23-v1', algorithmePlan: 'm3g-v1',
    format: '16:9', dureeCibleSecondes: total, version: 1,
    largeurCible: 1920, hauteurCible: 1080, fps: 30,
    plans, dureeTotaleSecondes: total, ecartSecondes: 0, clipsEcartes: 0,
    usage: { plansRetenus: plans.length }, createdAt: '', updatedAt: '',
  } as unknown as MontagePlan;
}

const CLE_MUSIQUE = `${UID}/music/musique.mp3`;

/**
 * ⚠️ UN SEUL CYCLE DE VIE POUR LES FIXTURES, AU NIVEAU DU FICHIER.
 *
 * Les poser dans le `beforeAll` d'un `describe` et les effacer dans son
 * `afterAll` les retirerait sous les pieds des `describe` suivants — qui
 * echoueraient alors sur des fichiers absents, pas sur ce qu'ils testent.
 */
beforeAll(async () => {
  if (!OUTILS) return;
  atelier = mkdtempSync(join(tmpdir(), 'lot2a-sonde-'));
  await fabriquerFixtures();
}, 300_000);
afterAll(() => { if (atelier) rmSync(atelier, { recursive: true, force: true }); });

beforeEach(() => {
  reinitialiserCapacite();
  objets.clear();
});

// ═════════════════════════════════════════════════════════════════════════
// Le vocabulaire, et le message
// ═════════════════════════════════════════════════════════════════════════
describe('Le motif de la musique existe, et ne parle pas de rush', () => {
  it('`musique_illisible` est un motif du vocabulaire ferme', () => {
    expect(MOTIFS_RENDU).toContain('musique_illisible');
  });

  // H. Sans cela, l'utilisateur va refilmer un rush qui n'a rien.
  it('H. le message d une musique invalide n accuse PAS un rush', () => {
    const m = messageEchec('musique_illisible');
    expect(m).not.toBe(messageEchec('clip_illisible'));
    expect(m.toLowerCase()).not.toContain('rush');
    expect(m.toLowerCase()).toContain('musique');
  });
});

it('les binaires sont là, ou la CI le dit', () => {
  if (process.env.CI) {
    expect(OUTILS, 'ffmpeg et ffprobe sont requis en intégration continue').toBe(true);
  } else if (!OUTILS) {
    console.warn('[lot2a] ffmpeg/ffprobe absents : les sondes réelles sont ignorées');
  }
  expect(true).toBe(true);
});

// ═════════════════════════════════════════════════════════════════════════
describe.skipIf(!OUTILS)('La sonde AUDIO, sur de vrais fichiers', () => {
  // A + B. Le cas de production exact : `adou.mp3`, aucun flux video.
  it('A/B. un MP3 audio-only SANS pochette est une musique valide', async () => {
    const s = await sonderSourceAudio(F.musiqueSansPochette);
    expect(s.motif).toBeNull();
    expect(s.aAudio).toBe(true);
  }, 60_000);

  // C. Le meme resultat, et surtout POUR LA MEME RAISON.
  it('C. un MP3 AVEC pochette est valide, et le verdict ne depend pas d elle',
    async () => {
      const avec = await sonderSourceAudio(F.musiqueAvecPochette);
      const sans = await sonderSourceAudio(F.musiqueSansPochette);
      expect(avec).toEqual({ aAudio: true, motif: null });
      expect(avec).toEqual(sans);
    }, 60_000);

  // D. Le critere reste « porte-t-il de l audio », pas « est-ce une video ».
  it('D. un media SANS piste audio n est pas une musique', async () => {
    const s = await sonderSourceAudio(F.videoMuette);
    expect(s.motif).toBeNull();
    expect(s.aAudio).toBe(false);
  }, 60_000);

  it('D bis. une video AVEC piste audio porte bien de l audio', async () => {
    const s = await sonderSourceAudio(F.videoSonore);
    expect(s).toEqual({ aAudio: true, motif: null });
  }, 60_000);

  // E. Et un refus PROPRE : le motif de la musique, pas celui des clips.
  it('E. un fichier illisible est refuse avec le motif de la MUSIQUE', async () => {
    const s = await sonderSourceAudio(F.corrompu);
    expect(s.aAudio).toBe(false);
    expect(s.motif).toBe('musique_illisible');
  }, 60_000);
});

// ═════════════════════════════════════════════════════════════════════════
describe.skipIf(!OUTILS)('F. La sonde des CLIPS n a pas bouge', () => {
  it('un media sans piste video reste INVALIDE comme clip', async () => {
    const s = await sonderSource(F.musiqueSansPochette);
    expect(s.motif).toBe('clip_illisible');
    expect(s.largeur).toBeNull();
    expect(s.hauteur).toBeNull();
  }, 60_000);

  it('un clip muet reste VALIDE, avec `aAudio` faux et ses dimensions', async () => {
    const s = await sonderSource(F.videoMuette);
    expect(s.motif).toBeNull();
    expect(s.aAudio).toBe(false);
    expect(s.largeur).toBe(1920);
    expect(s.hauteur).toBe(1080);
  }, 60_000);

  it('un clip sonore reste valide, avec `aAudio` vrai', async () => {
    const s = await sonderSource(F.videoSonore);
    expect(s).toMatchObject({ aAudio: true, largeur: 1920, hauteur: 1080, motif: null });
  }, 60_000);

  it('un fichier illisible reste `clip_illisible` pour un clip', async () => {
    const s = await sonderSource(F.corrompu);
    expect(s.motif).toBe('clip_illisible');
  }, 60_000);

  /**
   * ⚠️ LA PREUVE AVANT / APRES, EN UN SEUL ENDROIT.
   *
   * Le MEME fichier : refuse par la sonde des clips (c'est son droit), accepte
   * par la sonde audio. C'est exactement l'ecart que le correctif introduit —
   * avant lui, la musique empruntait la premiere ligne.
   */
  it('AVANT/APRES : le meme MP3, refuse comme clip, accepte comme musique',
    async () => {
      const commeClip = await sonderSource(F.musiqueSansPochette);
      const commeMusique = await sonderSourceAudio(F.musiqueSansPochette);
      expect(commeClip.aAudio).toBe(false);
      expect(commeClip.motif).toBe('clip_illisible');
      expect(commeMusique.aAudio).toBe(true);
      expect(commeMusique.motif).toBeNull();
    }, 60_000);
});

// ═════════════════════════════════════════════════════════════════════════
describe.skipIf(!OUTILS)('G. Le chemin de rendu, avec une musique audio-only', () => {
  /**
   * Le rendu de production, en miniature : deux clips, une musique MP3 sans
   * pochette, son original conserve. Avant le correctif, il s'arretait a
   * `source` avec `clip_illisible` sans jamais atteindre `amix`.
   */
  it('le rendu ATTEINT le mixage et produit un MP4 H.264 + AAC', async () => {
    objets.set(`${UID}/autopilote/clips/jeu/rang-01.mp4`, F.videoSonore);
    objets.set(`${UID}/autopilote/clips/jeu/rang-02.mp4`, F.videoSonore);
    objets.set(CLE_MUSIQUE, F.musiqueSansPochette);

    const plan = unMontage([
      unPlan({ ordre: 1, dureeRetenueSecondes: 4 }),
      unPlan({ ordre: 2, dureeRetenueSecondes: 3 }),
    ]);

    const r = await produireMontage({
      userId: UID,
      plan,
      recette: {
        ...RECETTE_AUDIO_DEFAUT,
        musique: { bucket: BUCKET_MUSIQUE, cle: CLE_MUSIQUE },
        volumeMusique: 0.7,
        sonOriginal: true,
        volumeSonOriginal: 0.25,
      },
    });

    // ⚠️ LA REGRESSION EXACTE, NOMMEE : plus jamais ce motif sur ce chemin.
    expect(r.motif).not.toBe('clip_illisible');
    expect(r.motif).toBeNull();
    expect(r.ok).toBe(true);

    const m = r.mesure!;
    expect(m.codecVideo).toBe('h264');
    expect(m.aAudio).toBe(true);
    expect(m.codecAudio).toBe('aac');
    expect(m.octets).toBeGreaterThan(0);
    expect(m.dureeMesureeSecondes).toBeGreaterThan(6);
    // La musique a bien ete descendue : le releve le dit, il n'est pas suppose.
    expect(r.usage.octetsMusique).toBeGreaterThan(0);
  }, 300_000);

  it('une musique SANS piste audio echoue en `musique_illisible`, pas en clip',
    async () => {
      objets.set(`${UID}/autopilote/clips/jeu/rang-01.mp4`, F.videoSonore);
      objets.set(CLE_MUSIQUE, F.videoMuette);

      const r = await produireMontage({
        userId: UID,
        plan: unMontage([unPlan({ ordre: 1, dureeRetenueSecondes: 4 })]),
        recette: {
          ...RECETTE_AUDIO_DEFAUT,
          musique: { bucket: BUCKET_MUSIQUE, cle: CLE_MUSIQUE },
        },
      });

      expect(r.ok).toBe(false);
      expect(r.motif).toBe('musique_illisible');
    }, 300_000);
});
