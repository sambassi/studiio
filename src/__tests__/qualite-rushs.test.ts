/**
 * M1 — QUALITÉ DES RUSHES : `evaluerQualiteRushs` (pur, sans IA).
 *
 * Fixtures synthétiques dont les valeurs reprennent les mesures RÉELLES
 * (analyse serveur ffmpeg, 16/10) : rush net 0,13–0,30 de netteté, rush
 * flouté 0,033, assombri 0,006 de luminance, surexposé 0,98, nuit contrastée
 * 0,05 de luminance pour 0,15–0,17 de contraste.
 *
 * Non-régression : le diagnostic ne touche ni les analyses ni le plan —
 * `planMontage` rend le MÊME plan, à l'octet, avant et après.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { planMontage, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';
import {
  evaluerQualiteRushs, libelleQualite, qualiteRushsPourMetadata, SEUILS_QUALITE, VERSION_QUALITE_RUSHS,
} from '@/lib/creer/qualite-rushs';

/** Empreinte 8×8 dont les blocs s'étalent sur [base, base + contraste]. */
const empreinte = (base: number, contraste: number, graine: number) =>
  Array.from({ length: 64 }, (_, i) => base + contraste * (((graine * 31 + i * 17) % 97) / 96));

function rush(url: string, duree: number, profil: (t: number) => Partial<EchantillonRush> & { contraste?: number }): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 0.5) {
    const { contraste = 0.6, ...p } = profil(t);
    const lum = p.luminosite ?? 0.45;
    echantillons.push({
      t, mouvement: 0.05, luminosite: lum, nettete: 0.15, audio: 0.3,
      empreinte: empreinte(Math.max(0, lum - contraste / 2), contraste, Math.floor(t * 2) + url.length),
      ...p,
    });
  }
  return { url, duree, echantillons };
}

const U = (n: string) => `https://studiio.pro/storage/v1/object/public/media/u1/${n}.mp4`;
const NET_A = rush(U('net-a'), 12, (t) => ({ nettete: 0.18 + 0.01 * Math.sin(t), mouvement: 0.03 + 0.02 * Math.abs(Math.sin(t)) }));
const NET_B = rush(U('net-b'), 10, (t) => ({ nettete: 0.27, mouvement: 0.08 + 0.01 * Math.cos(t), luminosite: 0.43 }));
const NET_C = rush(U('net-c'), 14, () => ({ nettete: 0.07, mouvement: 0.02, luminosite: 0.7, contraste: 0.88 }));
const FLOU = rush(U('flou'), 12, () => ({ nettete: 0.033, mouvement: 0.0002, contraste: 0.19 }));
const SOMBRE = rush(U('sombre'), 12, () => ({ luminosite: 0.006, nettete: 0.04, mouvement: 0.003, contraste: 0.08 }));
const SUREXPOSE = rush(U('surexpose'), 12, () => ({ luminosite: 0.976, nettete: 0.007, mouvement: 0.003, contraste: 0.06 }));
const FIGE = rush(U('fige'), 10, () => ({ mouvement: 0 }));
const VIDE = rush(U('vide'), 10, () => ({ contraste: 0.01, nettete: 0.002 }));
const NUIT = rush(U('nuit'), 12, (t) => ({ luminosite: 0.025, nettete: 0.066, mouvement: 0.03 + 0.01 * Math.sin(t), contraste: 0.17 }));
const FLOU_ARTISTIQUE = rush(U('file'), 9, (t) => ({ nettete: 0.028, mouvement: 0.05 + 0.02 * Math.sin(t) }));
const COURT = rush(U('court'), 1.2, () => ({}));

const de = (analyses: AnalyseRush[], url: string, opts?: Parameters<typeof evaluerQualiteRushs>[1]) =>
  evaluerQualiteRushs(analyses, opts).rushs.find((q) => q.url === url)!;
const BASE = [NET_A, NET_B, NET_C];

describe('evaluerQualiteRushs — verdicts mesurés', () => {
  it('rushes nets (même très différents entre eux) : ok, aucun motif', () => {
    const d = evaluerQualiteRushs(BASE);
    expect(d.version).toBe(VERSION_QUALITE_RUSHS);
    expect(d.rushs.map((q) => q.verdict)).toEqual(['ok', 'ok', 'ok']);
    expect(d.rushs.every((q) => q.motifs.length === 0 && libelleQualite(q) === null)).toBe(true);
  });

  it('flou uniforme sans mouvement : inutilisable, motif chiffré relatif ET absolu', () => {
    const q = de([...BASE, FLOU], FLOU.url);
    expect(q.verdict).toBe('inutilisable');
    expect(q.motifs[0]).toMatchObject({ code: 'flou', gravite: 'fort' });
    expect(q.motifs[0].texte).toMatch(/^flou : netteté 0,033 contre 0,18 pour vos autres rushes, seuil 0,045$/);
    expect(libelleQualite(q)).toBe('Inutilisable : flou');
  });

  it('sombre (quasi noir, sans contraste) : inutilisable', () => {
    const q = de([...BASE, SOMBRE], SOMBRE.url);
    expect(q.verdict).toBe('inutilisable');
    expect(q.motifs.map((m) => m.code)).toContain('trop_sombre');
    expect(q.motifs.find((m) => m.code === 'trop_sombre')!.texte).toMatch(/luminance moyenne 0,006 < 0,12/);
    // Netteté NON jugée sur une image noire : pas de double peine « flou ».
    expect(q.motifs.some((m) => m.code === 'flou')).toBe(false);
    expect(libelleQualite(q)).toBe('Inutilisable : trop sombre');
  });

  it('surexposé : inutilisable', () => {
    const q = de([...BASE, SUREXPOSE], SUREXPOSE.url);
    expect(q.verdict).toBe('inutilisable');
    expect(q.motifs[0].texte).toMatch(/^surexposé : luminance moyenne 0,98 > 0,85/);
  });

  it('image figée : à vérifier seulement (un plan fixe peut être voulu)', () => {
    const q = de([...BASE, FIGE], FIGE.url);
    expect(q.verdict).toBe('a_verifier');
    expect(q.motifs).toEqual([expect.objectContaining({ code: 'fige', gravite: 'faible', texte: 'image figée : 100 % des images identiques à la précédente' })]);
  });

  it('image uniforme (quasi vide) : inutilisable', () => {
    expect(de([...BASE, VIDE], VIDE.url)).toMatchObject({ verdict: 'inutilisable', motifs: expect.arrayContaining([expect.objectContaining({ code: 'quasi_vide' })]) });
  });

  it('trop court : à vérifier, durée utile chiffrée', () => {
    const q = de([...BASE, COURT], COURT.url);
    expect(q.verdict).toBe('a_verifier');
    expect(q.motifs.find((m) => m.code === 'trop_court')!.texte).toBe('trop court : 1,2 s utiles (minimum 1,5 s)');
  });
});

describe('protections — nuit intentionnelle, flou artistique', () => {
  it('nuit contrastée (quasi noire mais zones claires, mouvement) : au plus à vérifier, protection dite', () => {
    const q = de([...BASE, NUIT], NUIT.url);
    expect(q.verdict).toBe('a_verifier');
    expect(q.motifs.every((m) => m.gravite === 'faible')).toBe(true);
    expect(q.protections.join(' ')).toMatch(/nuit possible/);
  });

  it('même luminance SANS contraste : inutilisable (la protection tient au contraste mesuré)', () => {
    const plate = rush(U('nuit-plate'), 12, () => ({ luminosite: 0.025, nettete: 0.066, contraste: 0.05 }));
    expect(de([...BASE, plate], plate.url).verdict).toBe('inutilisable');
  });

  it('flou uniforme AVEC mouvement (filé / bokeh) : à vérifier, jamais inutilisable', () => {
    const q = de([...BASE, FLOU_ARTISTIQUE], FLOU_ARTISTIQUE.url);
    expect(q.verdict).toBe('a_verifier');
    expect(q.motifs[0]).toMatchObject({ code: 'flou', gravite: 'faible' });
    expect(q.protections.join(' ')).toMatch(/filé ou effet possible/);
  });

  it('jamais inutilisable sur un seul critère faible : rush seulement « un peu » moins net que les autres', () => {
    const doux = rush(U('doux'), 12, () => ({ nettete: 0.05 }));
    const q = de([...BASE, doux], doux.url);
    expect(q.verdict).not.toBe('inutilisable');
  });
});

describe('un seul rush : plancher absolu seulement', () => {
  it('rush net seul : ok', () => {
    expect(evaluerQualiteRushs([NET_C]).rushs[0].verdict).toBe('ok');
  });
  it('rush flou seul : à vérifier (aucune comparaison possible), motif sans « autres rushes »', () => {
    const q = evaluerQualiteRushs([FLOU]).rushs[0];
    expect(q.verdict).toBe('a_verifier');
    expect(q.motifs[0].texte).toBe('flou : netteté 0,033, seuil 0,045');
    expect(q.motifs[0].reference).toBeNull();
  });
  it('rush noir seul : inutilisable (l’exposition ne dépend pas des autres)', () => {
    expect(evaluerQualiteRushs([SOMBRE]).rushs[0].verdict).toBe('inutilisable');
  });
  it('rush seul extrêmement flou : inutilisable', () => {
    const tresFlou = rush(U('tres-flou'), 10, () => ({ nettete: 0.01, mouvement: 0.001 }));
    expect(evaluerQualiteRushs([tresFlou]).rushs[0].verdict).toBe('inutilisable');
    expect(SEUILS_QUALITE.netetePlancherSeul).toBeLessThan(SEUILS_QUALITE.netetePlancher);
  });
});

describe('choix de l’utilisateur (C-MEDIA-MANUAL) et forme des métadonnées', () => {
  it('rush choisi par l’utilisateur : signalé « choisi par vous », verdict inchangé', () => {
    const q = de([...BASE, FLOU], FLOU.url, { choisisParUtilisateur: [FLOU.url] });
    expect(q.choisiParVous).toBe(true);
    expect(q.verdict).toBe('inutilisable');
    expect(de([...BASE, FLOU], NET_A.url, { choisisParUtilisateur: [FLOU.url] }).choisiParVous).toBe(false);
  });

  it('meilleurs passages : fenêtres existantes du moteur (3 au plus), aucune pour un rush raté', () => {
    const d = evaluerQualiteRushs([...BASE, SOMBRE]);
    const a = d.rushs.find((q) => q.url === NET_A.url)!;
    expect(a.meilleursPassages.length).toBeGreaterThan(0);
    expect(a.meilleursPassages.length).toBeLessThanOrEqual(3);
    expect(d.rushs.find((q) => q.url === SOMBRE.url)!.meilleursPassages).toEqual([]);
  });

  it('metadata v1 compacte : verdicts + motifs + version, aucune URL', () => {
    const m = qualiteRushsPourMetadata(evaluerQualiteRushs([...BASE, FLOU], { choisisParUtilisateur: [FLOU.url] }));
    expect(m.version).toBe(1);
    expect(JSON.stringify(m)).not.toMatch(/https?:/);
    expect(m.rushs.at(-1)).toMatchObject({ cle: 'media/u1/flou.mp4', verdict: 'inutilisable', choisiParVous: true });
  });

  it('doublons et rushes sans mesure : ignorés, jamais une exception', () => {
    const vide: AnalyseRush = { url: U('x'), duree: 0, echantillons: [] };
    expect(evaluerQualiteRushs([NET_A, NET_A, vide]).rushs).toHaveLength(1);
    expect(evaluerQualiteRushs([]).rushs).toEqual([]);
  });
});

describe('non-régression : planMontage IDENTIQUE à l’octet', () => {
  const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const jeux: Array<[string, AnalyseRush[], number]> = [
    ['3 rushes nets', BASE, 20],
    ['nets + dégradés', [...BASE, FLOU, SOMBRE, FIGE, NUIT], 30],
    ['danse', [NET_A, NET_B, FLOU_ARTISTIQUE], 15],
  ];
  it.each(jeux)('%s : diagnostic sans effet sur les analyses ni sur le plan', (_n, analyses, cible) => {
    const copie = JSON.parse(JSON.stringify(analyses));
    const avant = planMontage(copie, cible, { contexte: { theme: 'danse cardio' } });
    evaluerQualiteRushs(analyses, { choisisParUtilisateur: analyses.map((a) => a.url) });
    expect(analyses).toEqual(copie); // aucune mutation
    const apres = planMontage(analyses, cible, { contexte: { theme: 'danse cardio' } });
    expect(hash(apres)).toBe(hash(avant));
    expect(hash(apres)).toMatchSnapshot();
  });
});

describe('affichage des chiffres', () => {
  it('jamais « 0,12 < 0,12 » : une décimale de plus quand l’arrondi confond mesure et seuil', () => {
    const limite = rush(U('limite'), 10, () => ({ luminosite: 0.1159, contraste: 0.2 }));
    const q = evaluerQualiteRushs([limite]).rushs[0];
    expect(q.motifs[0].texte).toBe('trop sombre : luminance moyenne 0,116 < 0,12');
  });
});
