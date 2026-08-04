import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { preparePosts, toPostRow } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';

/**
 * Le brouillon de l'Autopilote doit pointer sur le mp4 RENDU.
 *
 * ⚠️ LE CÂBLAGE N'ÉTAIT PAS EN CAUSE — LA VIGNETTE MANQUANTE, SI.
 *
 * En production, le post pointait vers un `montage-….webm` de
 * `media/<userId>/rush/`, illisible (`duration=N/A`), alors que le montage
 * serveur était un mp4 valide de `videos/`. Ce chemin et ce nom sont ceux du
 * compositeur NAVIGATEUR (`video-composer.ts`, `montage-${Date.now()}`,
 * `purpose: 'rush'`) : le fichier ne venait donc pas du rendu serveur.
 *
 * Le Calendrier propose « Régénérer le montage » dès qu'un post n'a pas de
 * `thumbnailUrl` — ce qui était le cas de tous les posts de l'Autopilote.
 * Cette régénération recompose dans le navigateur, en mode rapide, puis
 * ÉCRASE `media_url`, `videoUrl` et `renderedVideoUrl`. Un montage lisible
 * était remplacé par un fichier qui ne l'est pas.
 *
 * La correction n'est donc pas de « rebrancher » l'URL, qui l'était déjà :
 * c'est de rendre le post COMPLET, pour que rien ne propose de le refaire.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');
const rendu = readFileSync(resolve(__dirname, '../lib/autopilot/render.ts'), 'utf-8');
const dockerfile = readFileSync(resolve(__dirname, '../../Dockerfile'), 'utf-8');

const MP4 = '/storage/v1/object/public/videos/u1/autopilote-job1.mp4';
const JPG = '/storage/v1/object/public/images/u1/autopilote-job1.jpg';

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: ['https://cdn.test/rush.webm'], ...p,
});

/** La ligne de post telle que le cron l'insère, montage rendu. */
const ligne = (thumb: string | null = JPG) => {
  const c = cfg();
  const post = preparePosts({ config: c, topic: 'yoga', count: 1, now: 1_754_300_000_000 })[0];
  const design = buildAutopilotDesign(post);
  return toPostRow({
    userId: 'u1', post, config: c, videoUrl: MP4,
    metadata: buildAutopilotMetadata({ post, design, videoUrl: MP4, thumbnailUrl: thumb, mode: c.mode }),
  });
};

describe('Les trois champs portent le mp4 rendu', () => {
  it('`media_url`, `videoUrl` et `renderedVideoUrl`', () => {
    const row = ligne();
    expect(row.media_url).toBe(MP4);
    expect(row.metadata.videoUrl).toBe(MP4);
    expect(row.metadata.renderedVideoUrl).toBe(MP4);
    expect(row.media_type).toBe('video');
  });

  it('aucun `.webm`, et jamais un fichier de `rush/`', () => {
    const row = ligne();
    for (const champ of [row.media_url, row.metadata.videoUrl, row.metadata.renderedVideoUrl]) {
      expect(String(champ)).toMatch(/\.mp4$/);
      expect(String(champ)).not.toContain('/rush/');
    }
  });

  it('le rush du montage reste noté à part, sans jamais devenir le média', () => {
    // Il sert à une régénération ultérieure ; le confondre avec le montage
    // est précisément ce qui donnait un post illisible.
    const row = ligne();
    expect(row.metadata.rushUrls).toEqual(['https://cdn.test/rush.webm']);
    expect(row.media_url).not.toBe('https://cdn.test/rush.webm');
  });
});

describe('Le post est COMPLET — rien ne propose de le refaire', () => {
  it('il porte sa vignette', () => {
    const row = ligne();
    expect(row.metadata.thumbnailUrl).toBe(JPG);
    expect(row.metadata.posterUrl).toBe(JPG);
  });

  it('et la version du compositeur', () => {
    expect(ligne().metadata.composerVersion).toBe(CURRENT_COMPOSER_VERSION);
  });

  it('il se déclare RENDU CÔTÉ SERVEUR', () => {
    expect(ligne().metadata.serverRendered).toBe(true);
  });

  it('les trois conditions qui affichaient le bouton sont retombées', () => {
    // `!renderedVideoUrl || !thumbnailUrl || composerVersion !== courant`
    const m = ligne().metadata as Record<string, unknown>;
    expect(!m.renderedVideoUrl).toBe(false);
    expect(!m.thumbnailUrl).toBe(false);
    expect(m.composerVersion !== CURRENT_COMPOSER_VERSION).toBe(false);
  });

  it('une vignette manquante ne fabrique pas une URL vide', () => {
    // `''` passerait le test `!thumbnailUrl` du Calendrier et rendrait une
    // image cassée : mieux vaut l'absence franche.
    const m = ligne(null).metadata as Record<string, unknown>;
    expect(m.thumbnailUrl).toBeUndefined();
  });
});

describe('Le Calendrier ne peut plus écraser un montage serveur', () => {
  it('la régénération est refusée sur un post `serverRendered`', () => {
    expect(calendrier).toContain('!meta?.serverRendered && (regenerating');
  });

  it('c est bien elle qui produisait le webm', () => {
    // `montage-<horodatage>.webm`, `purpose: 'rush'` → `media/<uid>/rush/…`,
    // exactement le fichier observé en production.
    expect(composer).toContain('const filename = `montage-${Date.now()}.${ext}`;');
    expect(composer).toContain("purpose: 'rush'");
  });

  it('et elle écrasait bien les trois champs', () => {
    const bloc = calendrier.slice(calendrier.indexOf('const regenerateMontage'));
    expect(bloc).toContain('renderedVideoUrl: renderedUrl,');
  });
});

describe('La vignette est extraite du montage lui-même', () => {
  it('par ffmpeg, sur le fichier rendu', () => {
    expect(rendu).toContain("'-frames:v', '1'");
    expect(rendu).toContain('function ffmpegPath()');
  });

  it('à UNE seconde, pas à zéro', () => {
    // La première image est souvent une transition ou un fond nu.
    expect(rendu).toContain("'-ss', '1'");
  });

  it('AVANT le téléversement, qui supprime le fichier temporaire', () => {
    const i = rendu.indexOf('extraireVignette(outputPath');
    const j = rendu.indexOf('const videoUrl = await uploadToStorage');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  it('un échec d extraction ne casse pas le cycle', () => {
    // Un montage sans vignette vaut mieux qu'un cycle interrompu.
    expect(rendu).toContain('return null;');
    expect(rendu).toContain('vignette non extraite');
  });
});

describe('Chromium a ses bibliothèques dans l image', () => {
  it('le jeu validé en production est installé', () => {
    for (const lib of ['libnss3', 'libgbm1', 'libasound2', 'libatk-bridge2.0-0', 'libxkbcommon0']) {
      expect(dockerfile, lib).toContain(lib);
    }
  });

  it('dans le stage FINAL, pas dans le builder', () => {
    const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
    expect(runner).toContain('libnss3');
  });

  it('ffmpeg y est aussi — la vignette en dépend', () => {
    const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
    expect(runner).toContain('ffmpeg');
  });
});
