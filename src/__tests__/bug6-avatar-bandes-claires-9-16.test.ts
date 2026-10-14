// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * BUG 6 — export 9:16 Autopilote avec avatar : grandes bandes CLAIRES en haut
 * et en bas sur les plans de l'avatar.
 *
 * MESURÉ sur le MP4 de production (1080×1920, SAR 1:1) : 655 px unis
 * #F0F3F9 en haut et en bas des seuls plans avatar, image utile 1080×610 =
 * un avatar 16:9 posé entier au centre. Le fichier fournisseur (9:16
 * demandé, sans `fit`) porte ces bandes de SA couleur de fond ; Remotion
 * (`objectFit: 'cover'` d'un 9:16 dans un 9:16) les recopie fidèlement.
 *
 * CAUSE : `retirerBandesIncrustees` ne mesurait la zone utile qu'avec
 * `cropdetect`, qui ne voit QUE le noir (seuil de luminance) : une bande
 * claire était prise pour de l'image, le fichier gardé tel quel.
 *
 * Aucun appel fournisseur : vidéos synthétiques (ffmpeg testsrc2).
 */
import {
  zoneBandesUnies, planCadrage, ratioDemande, retirerBandesIncrustees, argumentsEchantillons,
} from '../lib/avatar/cadrage-jumeau';
import { drawVideoSeq } from '../lib/video-composer';
import { montageFrame } from '../app/dashboard/calendar/page';

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ?? null;
const avecFfmpeg = FFMPEG ? describe : describe.skip;
const run = (args: string[]) => execFileSync(FFMPEG!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const infos = (f: string) => String(spawnSync(FFMPEG!, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr);

/** Image en luminance : `l × h`, fond `fond`, rectangle « image » bruité dans `zone`. */
function image(l: number, h: number, fond: number, zone: { x: number; y: number; l: number; h: number }, graine = 1): Uint8Array {
  const px = new Uint8Array(l * h).fill(fond);
  let s = graine;
  for (let y = zone.y; y < zone.y + zone.h; y++) {
    for (let x = zone.x; x < zone.x + zone.l; x++) { s = (s * 1103515245 + 12345) & 0x7fffffff; px[y * l + x] = 30 + (s % 180); }
  }
  return px;
}
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/**
 * Bandes UNIES (toute couleur, tolérance 8 par canal) en haut / bas / gauche /
 * droite de l'image `n` d'un fichier — la mesure appliquée au MP4 de prod.
 */
function bandesUnies(fichier: string, l: number, h: number, n = 10) {
  const raw = execFileSync(FFMPEG!, ['-v', 'error', '-i', fichier, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const p = (x: number, y: number) => { const i = (y * l + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  const unie = (pts: number[][]) => pts.every((q) => q.every((v, k) => Math.abs(v - pts[0][k]) <= 8));
  const ligne = (y: number) => unie(Array.from({ length: l >> 1 }, (_, i) => p(i * 2, y)));
  const col = (x: number) => unie(Array.from({ length: h >> 1 }, (_, i) => p(x, i * 2)));
  let haut = 0; while (haut < h && ligne(haut)) haut++;
  let bas = 0; while (bas < h && ligne(h - 1 - bas)) bas++;
  let gauche = 0; while (gauche < l && col(gauche)) gauche++;
  let droite = 0; while (droite < l && col(l - 1 - droite)) droite++;
  return { haut, bas, gauche, droite };
}

describe('BUG 6 — règles pures : bandes unies de toute couleur', () => {
  it('cas A — avatar 16:9 dans un 9:16 à bandes CLAIRES (#F0F3F9) : zone utile trouvée, plan cover 9:16 plein cadre', () => {
    const src = { l: 720, h: 1280 };
    const utile = { x: 0, y: 437, l: 720, h: 406 };
    const z = zoneBandesUnies(concat(image(720, 1280, 243, utile, 1), image(720, 1280, 243, utile, 2)), src)!;
    // Marge de 4 px sur chaque côté amputé : aucun liseré clair ne survit.
    expect(z).toEqual({ x: 0, y: 441, l: 720, h: 398 });
    const plan = planCadrage(src, z, ratioDemande('9:16'))!;
    expect(plan).not.toBeNull();
    expect(plan.sortie).toEqual({ l: 720, h: 1280 });
    // Ratio de la coupe = ratio de sortie : aucun étirement.
    expect(plan.coupe.l / plan.coupe.h).toBeCloseTo(9 / 16, 1);
    // Coupe DANS l'image utile (jamais de fond), centrée.
    expect(plan.coupe.y).toBeGreaterThanOrEqual(utile.y);
    expect(plan.coupe.y + plan.coupe.h).toBeLessThanOrEqual(utile.y + utile.h);
    expect(plan.coupe.x + plan.coupe.l / 2).toBeCloseTo(360, -1);
  });

  it('toute couleur de fond (claire, colorée, noire) — même règle', () => {
    const utile = { x: 0, y: 437, l: 720, h: 406 };
    for (const fond of [0, 120, 243, 255]) {
      const z = zoneBandesUnies(image(720, 1280, fond, utile), { l: 720, h: 1280 });
      expect(z && z.y).toBe(441);
    }
  });

  it('pillarbox (avatar 9:16 dans un 16:9 à bandes claires) : colonnes détectées', () => {
    const z = zoneBandesUnies(image(1280, 720, 243, { x: 438, y: 0, l: 404, h: 720 }), { l: 1280, h: 720 })!;
    expect(z).toEqual({ x: 442, y: 0, l: 396, h: 720 });
    expect(planCadrage({ l: 1280, h: 720 }, z, ratioDemande('16:9'))).not.toBeNull();
  });

  it('cas B — image PLEINE (9:16 propre) : aucune bande, aucun recadrage', () => {
    const z = zoneBandesUnies(image(720, 1280, 243, { x: 0, y: 0, l: 720, h: 1280 }), { l: 720, h: 1280 });
    expect(z).toEqual({ l: 720, h: 1280, x: 0, y: 0 });
    expect(planCadrage({ l: 720, h: 1280 }, z, ratioDemande('9:16'))).toBeNull();
  });

  it('cas C — avatar 1:1 dans un 9:16 à bandes claires : cover 9:16 dans le carré, sans étirement', () => {
    const utile = { x: 0, y: 280, l: 720, h: 720 };
    const z = zoneBandesUnies(image(720, 1280, 243, utile), { l: 720, h: 1280 })!;
    const plan = planCadrage({ l: 720, h: 1280 }, z, ratioDemande('9:16'))!;
    expect(plan.coupe.l / plan.coupe.h).toBeCloseTo(9 / 16, 1);
    expect(plan.coupe.y).toBeGreaterThanOrEqual(utile.y);
    expect(plan.coupe.y + plan.coupe.h).toBeLessThanOrEqual(utile.y + utile.h);
  });

  it('pas de faux positif : fond uni d\'UN seul côté, ou bande qui change de couleur dans le temps', () => {
    // Sujet en bas du cadre, ciel uni en haut seulement.
    const z1 = zoneBandesUnies(image(720, 1280, 243, { x: 0, y: 400, l: 720, h: 880 }), { l: 720, h: 1280 });
    expect(planCadrage({ l: 720, h: 1280 }, z1, ratioDemande('9:16'))).toBeNull();
    // La « bande » n'a pas la même couleur sur toutes les images : ce n'est pas un fond incrusté.
    const utile = { x: 0, y: 437, l: 720, h: 406 };
    const z2 = zoneBandesUnies(concat(image(720, 1280, 243, utile), image(720, 1280, 200, utile)), { l: 720, h: 1280 });
    expect(planCadrage({ l: 720, h: 1280 }, z2, ratioDemande('9:16'))).toBeNull();
  });

  it('entrées dégénérées : null, jamais d\'exception', () => {
    expect(zoneBandesUnies(new Uint8Array(0), { l: 720, h: 1280 })).toBeNull();
    expect(zoneBandesUnies(new Uint8Array(720 * 1280).fill(243), { l: 720, h: 1280 })).toBeNull();
    expect(zoneBandesUnies(new Uint8Array(10), { l: 0, h: 0 })).toBeNull();
  });

  it('échantillons : fichier LOCAL seulement, sortie brute dans un fichier, nombre d\'images borné', () => {
    const a = argumentsEchantillons('/tmp/e.mp4', '/tmp/s.gray');
    expect(a).toContain('-protocol_whitelist');
    expect(a[a.indexOf('-protocol_whitelist') + 1]).toBe('file');
    expect(a).toContain('rawvideo');
    expect(a[a.length - 1]).toBe('/tmp/s.gray');
    expect(Number(a[a.indexOf('-frames:v') + 1])).toBeLessThanOrEqual(30);
  });
});

describe('BUG 6 — l\'aval est en « cover » : composition, compositeur, Calendrier', () => {
  it('la composition Remotion pose CHAQUE vidéo (rush, avatar) en objectFit: cover — jamais contain', () => {
    const code = readFileSync(join(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf8');
    const videos = code.match(/<OffthreadVideo[\s\S]*?\/>/g) ?? [];
    expect(videos.length).toBeGreaterThanOrEqual(2);
    for (const v of videos) {
      expect(v).toMatch(/objectFit: 'cover'/);
      expect(v).not.toMatch(/contain/);
    }
  });

  it('compositeur navigateur : un avatar 16:9 ou 1:1 couvre le 9:16 (aucune bande)', () => {
    for (const src of [[1920, 1080], [1080, 1080], [1080, 1920]] as const) {
      const appels: number[][] = [];
      const ctx = new Proxy({}, {
        get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
        set: () => true,
      }) as unknown as CanvasRenderingContext2D;
      drawVideoSeq(ctx, 1080, 1920, { videoWidth: src[0], videoHeight: src[1] } as unknown as HTMLVideoElement, null, 0.5);
      const [x, y, l, h] = appels[0];
      expect(x).toBeLessThanOrEqual(0); expect(y).toBeLessThanOrEqual(0);
      expect(x + l).toBeGreaterThanOrEqual(1080); expect(y + h).toBeGreaterThanOrEqual(1920);
      // Même facteur sur x et y : aucun étirement.
      expect(l / src[0]).toBeCloseTo(h / src[1], 3);
    }
  });

  it('cas D — Calendrier : un MP4 9:16 est lu dans un cadre EXACTEMENT 9:16 (object-contain n\'ajoute rien)', () => {
    const f = montageFrame({ w: 1080, h: 1920 }, 'reel');
    const [a, b] = String(f.style.aspectRatio).split('/').map((v) => Number(v.trim()));
    expect(a / b).toBeCloseTo(1080 / 1920, 6);
    // Post sans `videoSize` : le 9:16 du format.
    expect(String(montageFrame(undefined, 'reel').style.aspectRatio).replace(/\s/g, '')).toBe('9/16');
    // Le lecteur ne masque rien par CSS : `object-contain` sur le cadre au ratio du fichier.
    const page = readFileSync(join(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf8');
    const lecteur = page.slice(page.indexOf('montageFrame(meta?.videoSize'), page.indexOf('Legacy HTML montage rebuild'));
    expect(lecteur).toMatch(/object-contain/);
    expect(lecteur).not.toMatch(/object-cover|scale\(/);
  });
});

let dossier = '';
const media: Record<string, string> = {};

avecFfmpeg('BUG 6 — fichiers réels (ffmpeg), sans aucun appel fournisseur', () => {
  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'bug6-bandes-claires-'));
    const t = (s: string) => `testsrc2=size=${s}:rate=30`;
    media.paysage = join(dossier, 'paysage.mp4');
    media.vertical = join(dossier, 'vertical.mp4');
    media.carre = join(dossier, 'carre.mp4');
    media.claires = join(dossier, 'claires.mp4');
    run(['-v', 'error', '-y', '-f', 'lavfi', '-i', t('1920x1080'), '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media.paysage]);
    run(['-v', 'error', '-y', '-f', 'lavfi', '-i', t('720x1280'), '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media.vertical]);
    run(['-v', 'error', '-y', '-f', 'lavfi', '-i', t('720x720'), '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media.carre]);
    // Ce que le fournisseur rend pour un avatar 16:9 demandé en 9:16 sans `fit` :
    // 720×1280, image utile 720×406 au centre, fond CLAIR #F0F3F9 (mesuré en prod).
    run(['-v', 'error', '-y', '-i', media.paysage, '-vf', 'scale=720:406,pad=720:1280:0:437:color=0xF0F3F9,setsar=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', media.claires]);
  });
  afterAll(() => { if (dossier) rmSync(dossier, { recursive: true, force: true }); });

  it('reproduction : le fichier fournisseur porte ~437 px de bandes claires en haut et en bas', () => {
    const b = bandesUnies(media.claires, 720, 1280);
    expect(b.haut).toBeGreaterThan(400);
    expect(b.bas).toBeGreaterThan(400);
  });

  it('cas A — correction : bandes claires retirées, 720×1280 plein cadre, son conservé', async () => {
    const r = await retirerBandesIncrustees(readFileSync(media.claires), { aspectRatio: '9:16', ffmpeg: FFMPEG! });
    expect(r.corrige).toBe(true);
    const propre = join(dossier, 'claires-propre.mp4');
    writeFileSync(propre, r.buffer);
    const i = infos(propre);
    expect(i).toMatch(/Video:[^\n]*720x1280/);
    expect(i).toMatch(/Audio:/);
    expect(bandesUnies(propre, 720, 1280)).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });

  it('cas B / C / paysage propre : jamais réencodés (aucun recadrage inutile)', async () => {
    for (const k of ['vertical', 'carre', 'paysage'] as const) {
      const buf = readFileSync(media[k]);
      const r = await retirerBandesIncrustees(buf, { aspectRatio: '9:16', ffmpeg: FFMPEG! });
      expect(r.corrige).toBe(false);
      expect(r.buffer).toBe(buf);
    }
  });
});
