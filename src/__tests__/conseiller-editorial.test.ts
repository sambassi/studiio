/**
 * CONSEILLER ÉDITORIAL — textes, lisibilité / placement, montage.
 *
 * Cas de référence : la vidéo « DANSE » (Autopilote, staging, 30/09) —
 * mesures RÉELLES de ses 3 rushes et de son rendu hybride (fixtures).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import danseTextes from '@/__tests__/fixtures/conseiller-danse-textes.json';
import { conseillerVideo, conseilsDepuisMetadata } from '@/lib/creer/conseiller';
import { conseilsTextes, reecrireAccroche, reecrireCta, racine, tempsLecture, type TextesVideo } from '@/lib/creer/conseiller/textes';
import { conseilsMontage, scoreDifferenceVisuelle, nomRush } from '@/lib/creer/conseiller/montage';
import {
  geometrieTexte, conseilsLisibilite, contraste, voileAlpha, activite, BASE_L, BASE_H, ZONES, type ElementLisibilite,
} from '@/lib/creer/conseiller/lisibilite';
import { saturationRgb } from '@/lib/creer/smart-montage';
import type { AnalyseRush } from '@/lib/creer/smart-montage';
import type { RushSegment } from '@/lib/creer/multi-rush';

const DANSE_TEXTES: TextesVideo = {
  profil: 'CARDIO_DANCE',
  theme: 'DANSE',
  titre: 'DANSE',
  sousTitre: 'Danser active plus de muscles que la plupart des sports',
  cartes: [['MÉMOIRE BOOSTÉE', '-76%'], ['CARDIO COMPLET', '3-en-1'], ['OS RENFORCÉS', '+2%/an'], ['ANTI-ÂGE', '-10 ans'], ['300+ MUSCLES', '300+']]
    .map(([titre, valeur]) => ({ titre, valeur })),
  cta: 'LE SPORT LE PLUS COMPLET',
  fenetres: {
    titre: [0, 3.608], cta: [21.788, 24.288],
    cartes: [{ fin: 7.246, debut: 4.246, index: 0 }, { fin: 10.722, debut: 7.722, index: 1 }, { fin: 14.198, debut: 11.198, index: 2 },
      { fin: 17.674, debut: 14.674, index: 3 }, { fin: 21.15, debut: 18.15, index: 4 }],
  },
};

describe('vidéo de référence DANSE', () => {
  const rapport = conseillerVideo({
    profil: 'CARDIO_DANCE',
    textes: DANSE_TEXTES,
    plan: danse.plan as RushSegment[],
    analyses: danse.analyses as AnalyseRush[],
    rythme: danse.rythme,
    lisibilite: danseTextes as unknown as ElementLisibilite[],
  });
  const par = (id: string) => rapport.conseils.find((c) => c.id === id);

  it('accroche trop encombrante → question courte reprise de ses propres mots, 2 à 3 s', () => {
    const c = par('texte:accroche')!;
    expect(c.priorite).toBe('IMPORTANTE');
    expect(c.mesures?.mots).toBe(11);
    expect(c.propositionReecrite).toBe('Le sport le plus complet ?');
    expect(c.dureeRecommandee).toBe('2 à 3 secondes');
    expect(c.placementRecommande).toMatch(/^haut/);
  });

  it('textes secondaires difficiles à lire : accroche et CTA trop petits (mesurés en px)', () => {
    expect(par('lisibilite:taille:accroche')?.mesures).toMatchObject({ lignePetitePx: 28, ligneGrandePx: 36 });
    expect(par('lisibilite:taille:cta')?.priorite).toBe('IMPORTANTE');
  });

  it('badges des cartes trop petits et peu contrastés — UN conseil pour les 5 cartes', () => {
    const taille = par('lisibilite:taille:cartes')!;
    expect(taille.cible.split(',')).toHaveLength(5);
    expect(taille.probleme).toContain('Les 5 cartes sont trop petites');
    const c = par('lisibilite:contraste:cartes')!;
    expect(c.priorite).toBe('IMPORTANTE');
    expect(c.mesures?.contrastePire).toBeLessThan(2);
  });

  it('alternance couleur / noir et blanc : les 2 rushes « _nb » sont reconnus, 10 ruptures', () => {
    const c = par('rushes:noir-blanc')!;
    expect(c.priorite).toBe('IMPORTANTE');
    expect(c.cible).toContain('05_danse-en-couple_nb');
    expect(c.cible).toContain('13_homme-casque-gros-plan_nb');
    expect(c.mesures).toMatchObject({ ruptures: 10, extraitsNoirBlanc: 5 });
  });

  it('scènes répétitives : même rush, quelques secondes d\'écart, images proches ; rush dominant à 73 %', () => {
    expect(par('montage:repetition')?.mesures?.paires).toBeGreaterThanOrEqual(3);
    expect(par('rushes:dominant')?.mesures?.partRushDominant).toBe(0.73);
    expect(rapport.scoreDifferenceVisuelle).not.toBeNull();
  });

  it('CTA vague → une action ; le slogan ne revient pas en ligne secondaire (déjà repris par l\'accroche)', () => {
    const c = par('texte:cta')!;
    expect(c.propositionReecrite).toBe('Rejoins la session');
    expect(c.conseil).not.toContain('en petit');
  });

  it('rythme : ouverture trop lente pour la danse ; coupes VÉRIFIÉES sur les temps de la musique (aucune alerte)', () => {
    expect(par('rythme:accroche')?.mesures?.dureeMax).toBeGreaterThan(1.2);
    expect(par('rythme:musique')).toBeUndefined();
  });

  it('couverture honnête : visages jamais prétendus ; tout le reste mesuré ; trié par priorité', () => {
    expect(rapport.couverture).toEqual({ textes: true, lisibilite: true, placement: true, couleur: true, repetition: true, rythme: true, visages: false });
    const rangs = rapport.conseils.map((c) => ({ IMPORTANTE: 0, MOYENNE: 1, FAIBLE: 2 })[c.priorite]);
    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    expect(conseilsDepuisMetadata(JSON.parse(JSON.stringify(rapport)))).not.toBeNull();
  });

  it('mots compréhensibles, jamais de jargon technique', () => {
    const tout = rapport.conseils.map((c) => `${c.probleme} ${c.conseil}`).join(' ');
    expect(tout).not.toMatch(/threshold|seuil|empreinte|saturation|WCAG|luminance|percentile|densité/i);
  });
});

describe('textes', () => {
  it('temps de lecture et racines', () => {
    expect(tempsLecture(10)).toBe(3.4);
    expect(racine('Danser')).toBe(racine('DANSE'));
    expect(racine('le')).toBeNull();
  });

  it('accroche courte et lisible : aucun conseil', () => {
    expect(conseilsTextes({ profil: 'CARDIO_DANCE', titre: 'Le sport le plus complet ?', fenetres: { titre: [0, 3], cartes: [], cta: null } })).toEqual([]);
  });

  it('pas de formule courte disponible : aucune réécriture inventée', () => {
    expect(reecrireAccroche({ profil: 'STANDARD', sousTitre: 'une phrase beaucoup trop longue sans aucune virgule pour la couper proprement ici' })).toBeNull();
  });

  it('CTA : verbe d\'action reconnu (pas de conseil) ; objectif d\'essai → « Réserve ton essai »', () => {
    expect(conseilsTextes({ profil: 'CARDIO_DANCE', cta: 'Rejoins la session', fenetres: { titre: null, cartes: [], cta: [20, 23] } })).toEqual([]);
    expect(reecrireCta({ profil: 'STANDARD', objectif: 'faire réserver un cours d\'essai' })).toBe('Réserve ton essai');
    expect(reecrireCta({ profil: 'STANDARD', theme: 'comptabilité' })).toBe('Lien en bio');
  });

  it('carte trop brève ou trop longue', () => {
    const c = conseilsTextes({ profil: 'CARDIO_DANCE', cartes: [{ titre: 'Brûle des calories et muscle tout le corps', valeur: '500' }], fenetres: { titre: null, cta: null, cartes: [{ index: 0, debut: 4, fin: 5 }] } });
    expect(c[0].id).toBe('texte:carte:0');
    expect(c[0].priorite).toBe('IMPORTANTE');
  });

  it('thème absent de l\'accroche', () => {
    const c = conseilsTextes({ profil: 'STANDARD', theme: 'Yoga', titre: 'Respire mieux ce soir', fenetres: null });
    expect(c.some((x) => x.id === 'texte:theme')).toBe(true);
  });
});

// ── Montage, sur des analyses synthétiques ──
const empreinte = (v: number) => Array.from({ length: 64 }, (_, i) => (i % 2 ? v : 1 - v));
const rush = (nom: string, sat: number | undefined, lum = 0.5, base = 0.2): AnalyseRush => ({
  url: `https://x/storage/v1/object/public/media/u/${nom}.mp4`, duree: 40,
  echantillons: Array.from({ length: 40 }, (_, t) => ({
    t, mouvement: 0.2, luminosite: lum, nettete: 0.3, audio: 0, empreinte: empreinte(base + (t % 10) / 25),
    ...(sat === undefined ? {} : { saturation: sat }),
  })),
});
const seg = (r: AnalyseRush, debut: number, fin: number, depuis: number, phase = 'BUILD'): RushSegment => ({ url: r.url, debut, fin, depuis, jusqua: depuis + (fin - debut), phase });

describe('montage', () => {
  it('noir et blanc mêlé à la couleur : signalé ; analyse sans couleur : rien prétendu', () => {
    const a = rush('couleur', 0.06); const b = rush('nb', 0.014, 0.5, 0.6);
    const plan = [seg(a, 0, 2, 0), seg(b, 2, 4, 10), seg(a, 4, 6, 20)];
    const r = conseilsMontage({ profil: 'CARDIO_DANCE', plan, analyses: [a, b] });
    expect(r.conseils.find((c) => c.id === 'rushes:noir-blanc')?.mesures?.ruptures).toBe(2);
    const sans = conseilsMontage({ profil: 'CARDIO_DANCE', plan, analyses: [rush('couleur', undefined), rush('nb', undefined, 0.5, 0.6)] });
    expect(sans.couleur).toBe(false);
    expect(sans.conseils.some((c) => c.id === 'rushes:noir-blanc')).toBe(false);
  });

  it('ambiances lumineuses très différentes', () => {
    const a = rush('studio', 0.06, 0.25); const b = rush('plein-soleil', 0.06, 0.75, 0.6);
    const r = conseilsMontage({ profil: 'STANDARD', plan: [seg(a, 0, 2, 0), seg(b, 2, 4, 10)], analyses: [a, b] });
    expect(r.conseils.some((c) => c.id === 'rushes:ambiance')).toBe(true);
  });

  it('coupes hors des temps de la musique : signalé', () => {
    const a = rush('a', 0.06); const b = rush('b', 0.06, 0.5, 0.6);
    const plan = [seg(a, 0, 1.3, 0), seg(b, 1.3, 2.7, 10), seg(a, 2.7, 4.1, 20), seg(b, 4.1, 5.5, 30)];
    const r = conseilsMontage({ profil: 'CARDIO_DANCE', plan, analyses: [a, b], rythme: { beats: [0, 1, 2, 3, 4, 5, 6], forts: [0, 2, 4] } });
    expect(r.conseils.find((c) => c.id === 'rythme:musique')?.mesures).toMatchObject({ coupes: 3, surTemps: 0 });
  });

  it('score de différence visuelle 0..1 et nom lisible d\'un rush', () => {
    expect(scoreDifferenceVisuelle([
      { index: 0, rush: 'a', saturation: null, luminosite: 0, mouvement: 0, empreinte: empreinte(0) },
      { index: 1, rush: 'b', saturation: null, luminosite: 0, mouvement: 0, empreinte: empreinte(0.25) },
    ])).toBe(1);
    expect(nomRush('https://x/storage/v1/object/public/media/u/1790753838254-05_danse-en-couple_nb.mp4')).toBe('05_danse-en-couple_nb');
  });
});

describe('lisibilité / placement', () => {
  /** Image RVBA : deux lignes de texte blanc (8 et 4 rangées, traits verticaux) sur un cadre translucide. */
  const image = (L: number, H: number) => {
    const px = new Uint8Array(L * H * 4);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 60; x++) { const o = (y * L + x) * 4; px.set([255, 255, 255, 30], o); }
    for (const [a, b] of [[12, 20], [23, 27]]) for (let y = a; y < b; y++) for (let x = 12; x < 58; x += 2) { const o = (y * L + x) * 4; px.set([250, 250, 250, 255], o); }
    return px;
  };

  it('géométrie : boîte, hauteur de chaque ligne (px sur 1920), couleur, cadre translucide', () => {
    const g = geometrieTexte(image(80, 100), 80, 100);
    expect(g.lignesPx).toEqual([154, 77]);
    expect(g.lumTexte).toBeGreaterThan(0.95);
    expect(g.cadre?.opacite).toBeCloseTo(30 / 255, 2);
    expect(geometrieTexte(new Uint8Array(400), 10, 10).boite).toBeNull();
  });

  it('voile et contraste', () => {
    expect(voileAlpha(0)).toBeCloseTo(0.45);
    expect(voileAlpha(0.5)).toBe(0);
    expect(voileAlpha(1)).toBeCloseTo(0.55);
    expect(contraste(1, 0)).toBe(21);
    expect(contraste(0.9, 0.85)).toBeLessThan(1.5);
  });

  it('zone la plus calme : le mouvement d\'une moitié se mesure', () => {
    const imgs = [0, 1, 2].map((k) => Float32Array.from({ length: BASE_L * BASE_H }, (_, i) => ((i % BASE_L) < BASE_L / 2 ? (k % 2) : 0.5)));
    const gauche = activite(imgs, ZONES.find((z) => z.nom === 'bas-gauche')!);
    const droite = activite(imgs, ZONES.find((z) => z.nom === 'bas-droite')!);
    expect(gauche).toBeGreaterThan(droite);
  });

  it('accroche sur la zone qui bouge, alors qu\'une zone est calme → placement mesuré proposé', () => {
    const e: ElementLisibilite = {
      cible: 'accroche', texte: 'Test', debut: 0, fin: 3,
      geometrie: { boite: [0.1, 0.45, 0.9, 0.55], lignesPx: [90], lumTexte: 0.95, cadre: null },
      fond: [0.05, 0.2], activiteTexte: 1,
      zones: ZONES.map((z) => ({ nom: z.nom, activite: z.nom === 'haut' ? 0.2 : 1 })),
    };
    const c = conseilsLisibilite([e]);
    expect(c.map((x) => x.id)).toEqual(['placement:accroche']);
    expect(c[0].placementRecommande).toMatch(/^haut \(zone mesurée/);
    expect(c[0].conseil).toContain('ne reconnaît pas encore les visages');
  });
});

let ffmpegOk = true;
try { require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; }

describe('analyse serveur : couleur mesurée, mesures existantes inchangées', () => {
  it.skipIf(!ffmpegOk)('mire couleur ≫ même mire en noir et blanc', async () => {
    const { execFileSync } = await import('child_process');
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const d = mkdtempSync(join(tmpdir(), 'studiio-sat-'));
    const couleur = join(d, 'c.mp4'); const gris = join(d, 'g.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=6', '-pix_fmt', 'yuv420p', '-g', '25', '-y', couleur]);
    execFileSync('ffmpeg', ['-v', 'error', '-i', couleur, '-vf', 'hue=s=0', '-pix_fmt', 'yuv420p', '-g', '25', '-y', gris]);
    const { analyserRushServeur } = await import('@/lib/creer/analyse-rush-serveur');
    const ac = await analyserRushServeur(couleur, 6);
    const ag = await analyserRushServeur(gris, 6);
    const moy = (a: typeof ac) => a!.echantillons.reduce((t, e) => t + (e.saturation ?? NaN), 0) / a!.echantillons.length;
    expect(moy(ac)).toBeGreaterThan(0.2);
    expect(moy(ag)).toBeLessThan(0.025);
    // Le gris (mouvement, netteté, empreinte) est le même qu'avant : seule la saturation s'ajoute.
    expect(ac!.echantillons.every((e) => Array.isArray(e.empreinte) && e.empreinte.length === 64)).toBe(true);
  }, 120_000);
});

describe('mesures et câblage', () => {
  it('saturation : gris = 0, couleur pure = 1', () => {
    expect(saturationRgb([128, 128, 128, 10, 10, 10])).toBe(0);
    expect(saturationRgb([255, 0, 0])).toBe(1);
  });

  it('l\'Autopilote écrit les conseils, sans jamais les appliquer ni bloquer la production', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain('conseils = conseillerVideo({');
    expect(p).toContain("console.warn(`${journal} ${userId} — conseils impossibles :`");
    expect(p).toContain('...(conseils ? { conseils } : null),');
    const r = readFileSync(resolve(process.cwd(), 'src/lib/render/hybride/rendu.ts'), 'utf-8');
    expect(r).toContain('analyseBase: path.join(dossier, \'base.gray\')');
  });

  it('le Calendrier affiche le bloc de conseils', () => {
    const c = readFileSync(resolve(process.cwd(), 'src/app/dashboard/calendar/page.tsx'), 'utf-8');
    expect(c).toContain('<ConseilsVideo postId={fullPreviewPost.id} metadata={fullPreviewPost.metadata} />');
  });
});
