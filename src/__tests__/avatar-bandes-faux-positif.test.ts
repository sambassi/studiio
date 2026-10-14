// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * FAUX POSITIF du détecteur de bandes (revue de release après #565).
 *
 * Un VRAI avatar 9:16 plein cadre, sur fond de studio UNI, dont le sujet
 * touche le haut et le bas du cadre (fond à gauche et à droite) était lu
 * comme « pillarbox » : colonnes de bord unies et symétriques + axe vertical
 * entier suffisaient. Résultat : coupe 532×944 remise en 1080×1920 (zoom ≈ 2×)
 * d'une vidéo parfaitement bonne. Le chemin NOIR (cropdetect) avait le même
 * défaut sur fond de studio noir ; un sujet large ou rond sur fond uni
 * passait aussi pour un letterbox 16:9 / 1:1.
 *
 * Principe produit : CONSERVATEUR — mieux vaut laisser une bande douteuse que
 * recadrer une bonne vidéo. Règle retenue (matrice QA, 22 fixtures) :
 *   (b) fichier déjà au ratio demandé : letterbox seul en vertical, pillarbox
 *       seul en horizontal ;
 *   (c2) chaque bande finit sur un BORD DROIT (étendue de l'image ≥ 90 % de
 *       la ligne frontière, médiane des images) — sur les deux chemins.
 *
 * Aucun appel fournisseur : vidéos synthétiques (ffmpeg lavfi).
 */
import {
  bandesIncrustees, bordsFrancs, formeBandesAdmise, planCadrage, ratioDemande, retirerBandesIncrustees, zoneBandesUnies,
} from '../lib/avatar/cadrage-jumeau';

type Rect = { x: number; y: number; l: number; h: number };

/** Image en luminance : fond `fond`, pixels « image » bruités là où `dedans(x, y)`. */
function forme(l: number, h: number, fond: number, dedans: (x: number, y: number) => boolean, graine = 1): Uint8Array {
  const px = new Uint8Array(l * h).fill(fond);
  let s = graine;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      if (!dedans(x, y)) continue;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      // Bruit tenu à distance du fond (> tolérance) pour un fond clair OU sombre.
      px[y * l + x] = fond > 127 ? 20 + (s % 160) : 80 + (s % 170);
    }
  }
  return px;
}
const rect = (r: Rect) => (x: number, y: number) => x >= r.x && x < r.x + r.l && y >= r.y && y < r.y + r.h;
const R916 = ratioDemande('9:16')!;
const SRC = { l: 720, h: 1280 };
/** Décision complète sur pixels : ce que fait `retirerBandesIncrustees` (zone unie). */
const decision = (px: Uint8Array, src = SRC, r: number | null = R916) => {
  const z = zoneBandesUnies(px, src);
  return z && bordsFrancs(px, src, z) ? planCadrage(src, z, r) : null;
};

describe('Faux positif — règles pures', () => {
  // c04 : sujet centré 360 px de large, du haut au bas du cadre.
  const SUJET = { x: 180, y: 0, l: 360, h: 1280 };

  it.each([255, 243, 128, 0])('c04 — 9:16 plein cadre, fond uni %i, sujet du haut au bas : AUCUN recadrage', (fond) => {
    const z = zoneBandesUnies(forme(SRC.l, SRC.h, fond, rect(SUJET)), SRC);
    expect(planCadrage(SRC, z, R916)).toBeNull();
  });

  it('a3 — chemin cropdetect (fond de studio NOIR) : colonnes noires autour du sujet ≠ pillarbox', () => {
    expect(planCadrage(SRC, { l: 360, h: 1280, x: 180, y: 0 }, R916)).toBeNull();
    // Le reproduit à 1080×1920 (coupe 532×944 avant correction).
    expect(planCadrage({ l: 1080, h: 1920 }, { l: 532, h: 1920, x: 274, y: 0 }, R916)).toBeNull();
  });

  it('(b) fichier au ratio demandé : letterbox seul en vertical, pillarbox seul en horizontal ; sinon les deux', () => {
    const letter = { l: 720, h: 398, x: 0, y: 441 };
    const pillar = { l: 396, h: 720, x: 442, y: 0 };
    expect(formeBandesAdmise(SRC, letter, 9 / 16)).toBe(true);
    expect(formeBandesAdmise(SRC, { l: 360, h: 1280, x: 180, y: 0 }, 9 / 16)).toBe(false);
    expect(formeBandesAdmise({ l: 1280, h: 720 }, pillar, 16 / 9)).toBe(true);
    expect(formeBandesAdmise({ l: 1280, h: 720 }, { l: 1280, h: 398, x: 0, y: 161 }, 16 / 9)).toBe(false);
    // a6 : fichier 16:9 rendu pour une demande 9:16 (image 9:16 au centre) : admis.
    expect(formeBandesAdmise({ l: 1920, h: 1080 }, { l: 608, h: 1080, x: 656, y: 0 }, 9 / 16)).toBe(true);
    // Fichier carré : les deux.
    expect(formeBandesAdmise({ l: 1080, h: 1080 }, { l: 1080, h: 600, x: 0, y: 240 }, 1)).toBe(true);
    expect(formeBandesAdmise({ l: 1080, h: 1080 }, { l: 608, h: 1080, x: 236, y: 0 }, 1)).toBe(true);
  });

  it('a1 — sujet LARGE (ellipse coupée, boîte ≈ 16:9) sur fond clair : pas de bord droit, aucun recadrage', () => {
    const px = forme(720, 1280, 243, (x, y) => Math.abs(y - 640) < 203 && Math.hypot((x - 360) / 360, (y - 640) / 253) < 1.08);
    const z = zoneBandesUnies(px, SRC)!;
    expect(bandesIncrustees(SRC, z)).toBe(true); // la géométrie seule s'y trompait
    expect(bordsFrancs(px, SRC, z)).toBe(false);
    expect(decision(px)).toBeNull();
  });

  it('a2 — sujet ROND (disque, boîte ≈ 1:1) sur fond clair : aucun recadrage', () => {
    const px = forme(720, 1280, 243, (x, y) => Math.hypot(x - 360, y - 640) < 360);
    expect(decision(px)).toBeNull();
  });

  it('épaules pleine largeur + tête sur fond clair (boîte 16:9) : la tête n\'est pas un bord droit', () => {
    const px = forme(720, 1280, 243, (x, y) => rect({ x: 280, y: 437, l: 160, h: 80 })(x, y) || rect({ x: 0, y: 517, l: 720, h: 326 })(x, y));
    expect(decision(px)).toBeNull();
  });

  it.each([
    ['c06 bandes claires + 16:9', 243, { x: 0, y: 437, l: 720, h: 406 }],
    ['c07 bandes noires + 16:9', 0, { x: 0, y: 437, l: 720, h: 406 }],
    ['c08 bandes claires + 1:1', 243, { x: 0, y: 280, l: 720, h: 720 }],
    ['a7 bandes claires + 4:3', 243, { x: 0, y: 370, l: 720, h: 540 }],
  ] as const)('%s : bords droits, recadrage cover 9:16 DANS l\'image', (_n, fond, utile) => {
    const px = forme(720, 1280, fond, rect(utile));
    const p = decision(px)!;
    expect(p).not.toBeNull();
    expect(p.sortie).toEqual({ l: 720, h: 1280 });
    expect(p.coupe.l / p.coupe.h).toBeCloseTo(9 / 16, 1);
    expect(p.coupe.y).toBeGreaterThanOrEqual(utile.y);
    expect(p.coupe.y + p.coupe.h).toBeLessThanOrEqual(utile.y + utile.h);
  });

  it('n4b bandes claires + contenu 16:9 dont le haut est un ciel PÂLE (~10 de luminance du fond) : toujours recadré', () => {
    const utile = { x: 0, y: 437, l: 720, h: 406 };
    const px = forme(720, 1280, 243, rect(utile));
    // Les 80 premières lignes du contenu : un ciel uni à 233, proche de la bande (243).
    for (let y = utile.y; y < utile.y + 80; y++) px.fill(233, y * 720, (y + 1) * 720);
    const p = decision(px)!;
    expect(p).not.toBeNull();
    expect(p.sortie).toEqual({ l: 720, h: 1280 });
    expect(p.coupe.y).toBeGreaterThanOrEqual(utile.y);
    expect(p.coupe.y + p.coupe.h).toBeLessThanOrEqual(utile.y + utile.h);
  });

  it('bords droits : aucun côté amputé, ou pixels illisibles → false (dans le doute, rien)', () => {
    expect(bordsFrancs(new Uint8Array(0), SRC, { l: 720, h: 398, x: 0, y: 441 })).toBe(false);
    expect(bordsFrancs(forme(720, 1280, 243, () => true), SRC, { l: 720, h: 1280, x: 0, y: 0 })).toBe(false);
  });
});

// ── Fichiers réels : la chaîne complète `retirerBandesIncrustees` ─────────────
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ?? null;
const avecFfmpeg = FFMPEG ? describe : describe.skip;
const run = (args: string[]) => execFileSync(FFMPEG!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const infos = (f: string) => String(spawnSync(FFMPEG!, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr);
const dims = (i: string) => { const m = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(i)!; return { l: Number(m[1]), h: Number(m[2]) }; };

/** Fond uni `fond` (l×h) + sujet testsrc2 (sl×sh) posé en (x, y), 1 s, avec son. */
function plan(f: string, [l, h]: [number, number], fond: string, [sl, sh]: [number, number], [x, y]: [number, number]) {
  run(['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${fond}:s=${l}x${h}:r=30:d=1`,
    '-f', 'lavfi', '-i', `testsrc2=size=${sl}x${sh}:rate=30:d=1`,
    '-f', 'lavfi', '-i', 'sine=f=440:d=1',
    '-filter_complex', `[0:v][1:v]overlay=${x}:${y}:shortest=1,setsar=1[v]`, '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
}

/** Fond uni + sujet testsrc2 découpé par un masque `geq` (forme non rectangulaire), 720×1280. */
function masque(f: string, fond: string, expr: string) {
  run(['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${fond}:s=720x1280:r=30:d=1`,
    '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:d=1',
    '-f', 'lavfi', '-i', 'sine=f=440:d=1',
    '-filter_complex', `[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${expr.replace(/,/g, '\\,')}'[s];[0:v][s]overlay=0:0:shortest=1,setsar=1[v]`,
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
}

let dossier = '';
avecFfmpeg('Faux positif — vraie chaîne ffmpeg (aucun appel fournisseur)', () => {
  const F: Record<string, string> = {};
  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'bandes-faux-positif-'));
    const p = (k: string) => (F[k] = join(dossier, `${k}.mp4`));
    // GARDER — vrais 9:16 plein cadre.
    plan(p('blanc-haut-bas'), [1080, 1920], 'white', [540, 1920], [270, 0]);
    plan(p('gris-haut-bas'), [720, 1280], '0x808080', [360, 1280], [180, 0]);
    plan(p('noir-haut-bas'), [720, 1280], 'black', [360, 1280], [180, 0]);
    plan(p('blanc-haut'), [720, 1280], 'white', [360, 900], [180, 0]);
    plan(p('blanc-bas'), [720, 1280], 'white', [360, 900], [180, 380]);
    // a1 sujet large (boîte ≈ 16:9), a2 disque (boîte ≈ 1:1), sur fond clair.
    masque(p('a1-sujet-large'), '0xF0F3F9', '255*lt(abs(Y-640),203)*lt(hypot((X-360)/360,(Y-640)/253),1.08)');
    masque(p('a2-disque'), '0xF0F3F9', '255*lt(hypot(X-360,Y-640),360)');
    run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x720:rate=30:d=1', '-f', 'lavfi', '-i', 'sine=d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('carre-propre')]);
    run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:d=1', '-f', 'lavfi', '-i', 'sine=d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('paysage-propre')]);
    // RECADRER — vraies bandes incrustées par le fournisseur.
    plan(p('claires-16-9'), [720, 1280], '0xF0F3F9', [720, 406], [0, 437]);
    plan(p('noires-16-9'), [720, 1280], 'black', [720, 406], [0, 437]);
    plan(p('claires-1-1'), [720, 1280], '0xF0F3F9', [720, 720], [0, 280]);
    plan(p('claires-16-9-1080'), [1080, 1920], '0xF0F3F9', [1080, 610], [0, 655]);
    plan(p('claires-4-3'), [720, 1280], '0xF0F3F9', [720, 540], [0, 370]);
    // a6 : le fournisseur rend un fichier 16:9 qui contient l'image 9:16 (demande 9:16).
    plan(p('a6-pillarbox-16-9'), [1280, 720], 'black', [406, 720], [437, 0]);
  });
  afterAll(() => { if (dossier) rmSync(dossier, { recursive: true, force: true }); });

  const garder = ['blanc-haut-bas', 'gris-haut-bas', 'noir-haut-bas', 'blanc-haut', 'blanc-bas', 'carre-propre', 'paysage-propre', 'a1-sujet-large', 'a2-disque'];
  it.each(garder)('GARDER %s : fichier rendu tel quel (aucun zoom)', async (k) => {
    const buf = readFileSync(F[k]);
    const r = await retirerBandesIncrustees(buf, { aspectRatio: '9:16', ffmpeg: FFMPEG! });
    expect(r.plan).toBeNull();
    expect(r.corrige).toBe(false);
    expect(r.buffer).toBe(buf);
  });

  it.each([
    ['claires-16-9', { l: 720, h: 1280 }, { y: 437, h: 406 }],
    ['noires-16-9', { l: 720, h: 1280 }, { y: 437, h: 406 }],
    ['claires-1-1', { l: 720, h: 1280 }, { y: 280, h: 720 }],
    ['claires-16-9-1080', { l: 1080, h: 1920 }, { y: 655, h: 610 }],
    ['claires-4-3', { l: 720, h: 1280 }, { y: 370, h: 540 }],
    ['a6-pillarbox-16-9', { l: 720, h: 1280 }, { y: 0, h: 720 }],
  ] as const)('RECADRER %s : plein cadre 9:16, coupe dans l\'image, sans étirement, son conservé', async (k, sortie, utile) => {
    const r = await retirerBandesIncrustees(readFileSync(F[k]), { aspectRatio: '9:16', ffmpeg: FFMPEG! });
    expect(r.corrige).toBe(true);
    const p = r.plan!;
    expect(p.sortie).toEqual(sortie);
    // Même facteur sur x et y : aucune déformation.
    expect(p.sortie.l / p.coupe.l).toBeCloseTo(p.sortie.h / p.coupe.h, 1);
    // `cropdetect round=2` (chemin noir, inchangé depuis avant #565) peut
    // arrondir la frontière d'UN pixel vers la bande sur un décalage impair.
    expect(p.coupe.y).toBeGreaterThanOrEqual(utile.y - 1);
    expect(p.coupe.y + p.coupe.h).toBeLessThanOrEqual(utile.y + utile.h);
    const out = join(dossier, `${k}-propre.mp4`);
    writeFileSync(out, r.buffer);
    const i = infos(out);
    expect(dims(i)).toEqual(sortie);
    expect(i).toMatch(/Audio:/);
  });
});
