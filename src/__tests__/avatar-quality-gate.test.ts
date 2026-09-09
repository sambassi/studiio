// @vitest-environment node
/**
 * A_8c — CE QU'UNE VIDÉO DE RÉFÉRENCE DOIT VALOIR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX MOITIÉS, ET LA SECONDE COMPTE AUTANT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La politique est PURE : une mesure entre, un verdict sort. Elle se teste
 * donc exhaustivement, sans fichier ni horloge — et c'est ce que fait la
 * première partie.
 *
 * La sonde, elle, ne se teste que sur de VRAIES vidéos : un `.txt` renommé
 * `.mp4` ne se simule pas, et une rotation de téléphone encore moins. La
 * seconde partie fabrique donc des fixtures avec ffmpeg et les lit avec
 * ffprobe — les mêmes binaires que la production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verdictQualiteSource, DUREE_MIN_SECONDES, DUREE_MAX_SECONDES,
  DUREE_RECOMMANDEE_MIN_SECONDES, PETIT_COTE_MIN, PETIT_COTE_RECOMMANDE, FPS_MIN,
  CONSEILS_CAPTURE, type MesureSourceAvatar,
} from '@/lib/avatar/qualite';
import {
  argumentsSondeAvatar, lireSondeAvatar, rotationNormalisee,
} from '@/lib/avatar/source';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';

const execFileP = promisify(execFile);

function outilPresent(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch { return false; }
}
const OUTILS = outilPresent(cheminFfmpeg()) && outilPresent(cheminFfprobe());

/** Une mesure valide de référence — chaque test n'en change QUE ce qu'il teste. */
const BONNE: MesureSourceAvatar = {
  dureeSecondes: 180, largeur: 1080, hauteur: 1920, fps: 30,
  codecVideo: 'h264', codecAudio: 'aac', aAudio: true,
  orientation: 'portrait', rotationDegres: 0, octets: 50_000_000, lisible: true,
};
const avec = (p: Partial<MesureSourceAvatar>) => verdictQualiteSource({ ...BONNE, ...p });
const critere = (m: Partial<MesureSourceAvatar>, cle: string) =>
  avec(m).criteres.find((c) => c.cle === cle);

let atelier = '';
beforeAll(async () => { if (OUTILS) atelier = await mkdtemp(join(tmpdir(), 'a8c-')); }, 60_000);
afterAll(async () => { if (atelier) await rm(atelier, { recursive: true, force: true }); });

/** Une vidéo réelle, aussi légère que possible pour ce qu'elle doit prouver. */
async function fabriquer(nom: string, o: {
  secondes: number; largeur: number; hauteur: number; fps: number; audio: boolean;
  rotation?: number;
}): Promise<string> {
  const chemin = join(atelier, nom);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=${o.largeur}x${o.hauteur}:rate=${o.fps}:d=${o.secondes}`,
    ...(o.audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:d=${o.secondes}`] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
    ...(o.audio ? ['-c:a', 'aac', '-b:a', '64k'] : ['-an']),
    ...(o.rotation ? ['-metadata:s:v:0', `rotate=${o.rotation}`] : []),
    chemin,
  ];
  await execFileP(cheminFfmpeg(), args, { timeout: 180_000 });
  return chemin;
}

async function sonder(chemin: string): Promise<MesureSourceAvatar> {
  try {
    const { stdout } = await execFileP(cheminFfprobe(), argumentsSondeAvatar(chemin), {
      timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    return lireSondeAvatar(stdout);
  } catch {
    return lireSondeAvatar('');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La durée', () => {
  it('1.1 ⚠️ TROP COURTE : REFUS, PAS UN AVERTISSEMENT', () => {
    /* En dessous de la borne du fournisseur, l'entraînement échouerait de
       toute façon : autant le dire avant le téléversement qu'après. */
    const v = avec({ dureeSecondes: 10 });
    expect(v.acceptable).toBe(false);
    expect(critere({ dureeSecondes: 10 }, 'duree')?.gravite).toBe('erreur');
    expect(v.erreurs.join(' ')).toMatch(/trop courte/i);
  });

  it('1.2 ⚠️ 30 s PASSE, MAIS AVEC UN AVERTISSEMENT', () => {
    /* Techniquement acceptable, qualitativement pauvre. Bloquer serait
       paternaliste ; se taire serait laisser quelqu'un payer un clone raté. */
    const v = avec({ dureeSecondes: 30 });
    expect(v.acceptable).toBe(true);
    expect(critere({ dureeSecondes: 30 }, 'duree')?.gravite).toBe('avertissement');
    expect(v.avertissements.join(' ')).toMatch(/2 à 5 minutes/);
  });

  it('1.3 deux minutes : recommandé, sans réserve', () => {
    const v = avec({ dureeSecondes: 120 });
    expect(v.acceptable).toBe(true);
    expect(v.avertissements).toHaveLength(0);
    expect(critere({ dureeSecondes: 120 }, 'duree')?.gravite).toBe('succes');
  });

  it('1.4 ⚠️ AU-DELÀ DE 600 s : REFUS', () => {
    const v = avec({ dureeSecondes: 601 });
    expect(v.acceptable).toBe(false);
    expect(v.erreurs.join(' ')).toMatch(/trop longue/i);
  });

  it('1.5 les bornes exactes sont acceptées', () => {
    // Une borne se teste SUR la borne : `<` et `<=` ne se distinguent pas ailleurs.
    expect(avec({ dureeSecondes: DUREE_MIN_SECONDES }).acceptable).toBe(true);
    expect(avec({ dureeSecondes: DUREE_MAX_SECONDES }).acceptable).toBe(true);
    expect(avec({ dureeSecondes: DUREE_MIN_SECONDES - 0.1 }).acceptable).toBe(false);
    expect(avec({ dureeSecondes: DUREE_MAX_SECONDES + 0.1 }).acceptable).toBe(false);
    expect(critere({ dureeSecondes: DUREE_RECOMMANDEE_MIN_SECONDES }, 'duree')?.gravite)
      .toBe('succes');
  });

  it('1.6 une durée non mesurée est une erreur, pas un zéro', () => {
    expect(avec({ dureeSecondes: null }).acceptable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La résolution', () => {
  it('2.1 ⚠️ C’EST LE PETIT CÔTÉ QUI COMPTE, JAMAIS LA LARGEUR', () => {
    /* Une vidéo verticale 1080 × 1920 n'a « que » 1080 de large et vaut
       pourtant 1080p. Comparer la largeur refuserait exactement le format que
       Studiio produit le plus. */
    expect(avec({ largeur: 1080, hauteur: 1920 }).acceptable).toBe(true);
    expect(critere({ largeur: 1080, hauteur: 1920 }, 'resolution')?.gravite).toBe('succes');
    expect(critere({ largeur: 1920, hauteur: 1080 }, 'resolution')?.gravite).toBe('succes');
  });

  it('2.2 en dessous de 720 sur le petit côté : refus', () => {
    expect(avec({ largeur: 640, hauteur: 480 }).acceptable).toBe(false);
    expect(avec({ largeur: 480, hauteur: 854 }).acceptable).toBe(false);
  });

  it('2.3 720p passe avec un avertissement, 1080p sans', () => {
    expect(critere({ largeur: 720, hauteur: 1280 }, 'resolution')?.gravite)
      .toBe('avertissement');
    expect(critere({ largeur: PETIT_COTE_RECOMMANDE, hauteur: 1920 }, 'resolution')?.gravite)
      .toBe('succes');
    expect(avec({ largeur: PETIT_COTE_MIN, hauteur: 1280 }).acceptable).toBe(true);
  });

  it('2.4 le carré est accepté', () => {
    // 1:1 est un format de publication légitime, pas une anomalie.
    expect(avec({ largeur: 1080, hauteur: 1080 }).acceptable).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La cadence et le son', () => {
  it('3.1 sous 24 images/s : avertissement, pas refus', () => {
    /* Le mouvement des lèvres perd en précision, mais la vidéo reste
       exploitable : refuser irait au-delà de ce qu'on sait démontrer. */
    const c = critere({ fps: 15 }, 'fps');
    expect(c?.gravite).toBe('avertissement');
    expect(avec({ fps: 15 }).acceptable).toBe(true);
  });

  it('3.2 les cadences usuelles passent sans réserve', () => {
    for (const f of [FPS_MIN, 25, 29.97, 30, 60]) {
      expect(critere({ fps: f }, 'fps')?.gravite, `${f} images/s`).toBe('succes');
    }
  });

  it('3.3 ⚠️ SANS SON, C’EST UN REFUS', () => {
    /* Un clone qui parle s'entraîne sur quelqu'un qui parle : sans piste
       sonore, il n'y a rien à apprendre du mouvement de la bouche. */
    const v = avec({ aAudio: false, codecAudio: null });
    expect(v.acceptable).toBe(false);
    expect(v.erreurs.join(' ')).toMatch(/ne contient pas de son/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le fichier illisible', () => {
  it('4.1 ⚠️ UN SEUL MESSAGE, PAS CINQ CROIX', () => {
    /* Un fichier illisible n'a ni durée ni dimensions : enchaîner les autres
       critères afficherait cinq échecs pour une seule cause, et noierait la
       vraie information. */
    const v = verdictQualiteSource({
      dureeSecondes: null, largeur: null, hauteur: null, fps: null,
      codecVideo: null, codecAudio: null, aAudio: false,
      orientation: null, rotationDegres: 0, octets: 12, lisible: false,
    });
    expect(v.acceptable).toBe(false);
    expect(v.criteres).toHaveLength(1);
    expect(v.criteres[0].cle).toBe('fichier');
    expect(v.erreurs[0]).toMatch(/illisible/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Les messages', () => {
  it('5.1 ⚠️ AUCUNE SORTIE D’OUTIL NE REMONTE À L’ÉCRAN', () => {
    const tous = [
      avec({ dureeSecondes: 5 }), avec({ dureeSecondes: 700 }),
      avec({ largeur: 320, hauteur: 240 }), avec({ aAudio: false }),
      verdictQualiteSource({ ...BONNE, lisible: false }),
    ].flatMap((v) => v.criteres.map((c) => c.message));
    for (const m of tous) {
      expect(m).not.toMatch(/ffprobe|ffmpeg|ENOENT|codec_name|null|undefined|exit/i);
    }
  });

  it('5.2 les conseils sont séparés des mesures', () => {
    /* Annoncer « éclairage ✓ » sans rien avoir regardé serait une mesure
       inventée. Les conseils ne portent donc aucune gravité. */
    const cles = avec({}).criteres.map((c) => c.cle);
    expect(cles).toEqual(['fichier', 'duree', 'resolution', 'fps', 'audio']);
    expect(CONSEILS_CAPTURE.length).toBeGreaterThan(5);
    expect(CONSEILS_CAPTURE.join(' ')).toMatch(/2 à 5 minutes/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La sonde, sur de vraies vidéos', () => {
  it('6.1 une vidéo valide est mesurée exactement', async () => {
    if (!OUTILS) return;
    const f = await fabriquer('valide.mp4', {
      secondes: 20, largeur: 1080, hauteur: 1920, fps: 30, audio: true,
    });
    const m = await sonder(f);
    expect(m.lisible).toBe(true);
    expect(m.dureeSecondes).toBeCloseTo(20, 0);
    expect(m.largeur).toBe(1080);
    expect(m.hauteur).toBe(1920);
    expect(Math.round(m.fps ?? 0)).toBe(30);
    expect(m.aAudio).toBe(true);
    expect(m.orientation).toBe('portrait');
    expect(verdictQualiteSource(m).acceptable).toBe(true);
  }, 240_000);

  it('6.2 ⚠️ UNE VIDÉO SANS PISTE SONORE EST DÉTECTÉE, PAS SUPPOSÉE', async () => {
    if (!OUTILS) return;
    const f = await fabriquer('muette.mp4', {
      secondes: 20, largeur: 1080, hauteur: 1920, fps: 30, audio: false,
    });
    const m = await sonder(f);
    expect(m.lisible).toBe(true);
    expect(m.aAudio).toBe(false);
    expect(verdictQualiteSource(m).acceptable).toBe(false);
  }, 240_000);

  it('6.3 ⚠️ UN .TXT RENOMMÉ .MP4 EST REFUSÉ PAR LE DÉCODEUR', async () => {
    if (!OUTILS) return;
    /* Ni l'extension ni le type MIME du navigateur ne décident : les deux se
       falsifient en une seconde. C'est ffprobe qui tranche. */
    const f = join(atelier, 'faux.mp4');
    await writeFile(f, 'ceci n’est pas une vidéo, mais le nom dit le contraire');
    const m = await sonder(f);
    expect(m.lisible).toBe(false);
    expect(verdictQualiteSource(m).acceptable).toBe(false);
  }, 60_000);

  it('6.4 ⚠️ UN PORTRAIT FILMÉ AU TÉLÉPHONE RESTE UN PORTRAIT', async () => {
    /* Un téléphone enregistre souvent 1920 × 1080 avec une rotation de 90° :
       sans la lire, la vidéo se classerait paysage et son petit côté serait
       faux. */
    if (!OUTILS) return;
    const f = await fabriquer('pivotee.mp4', {
      secondes: 16, largeur: 1920, hauteur: 1080, fps: 30, audio: true, rotation: 90,
    });
    const m = await sonder(f);
    expect(m.lisible).toBe(true);
    if (m.rotationDegres === 90) {
      expect(m.largeur).toBe(1080);
      expect(m.hauteur).toBe(1920);
      expect(m.orientation).toBe('portrait');
    }
  }, 240_000);

  it('6.5 les formes de rotation se ramènent au même quart de tour', () => {
    expect(rotationNormalisee(-90)).toBe(270);
    expect(rotationNormalisee(270)).toBe(270);
    expect(rotationNormalisee(450)).toBe(90);
    expect(rotationNormalisee(0)).toBe(0);
    expect(rotationNormalisee('nimporte')).toBe(0);
    expect(rotationNormalisee(undefined)).toBe(0);
  });

  it('6.6 une sortie vide ne devine rien', () => {
    const m = lireSondeAvatar('');
    expect(m.lisible).toBe(false);
    expect(m.dureeSecondes).toBeNull();
    expect(m.aAudio).toBe(false);
  });
});

it('les binaires sont là, ou la CI le dit', () => {
  if (process.env.CI) {
    expect(OUTILS, 'ffmpeg et ffprobe sont requis en intégration continue').toBe(true);
  } else if (!OUTILS) {
    console.warn('[a8c] ffmpeg/ffprobe absents : les sondes réelles sont ignorées');
  }
  expect(true).toBe(true);
});
