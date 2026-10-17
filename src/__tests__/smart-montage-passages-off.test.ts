/**
 * M3-a PR1 — NON-RÉGRESSION OCTET POUR OCTET du mode actuel (« grille »).
 *
 * Les empreintes sha256 ci-dessous ont été prises sur `main` (b5a248d)
 * AVANT l'ajout de l'option `selection` : sans l'option, ou avec
 * `selection: 'grille'`, `planMontage` doit rendre EXACTEMENT le même JSON
 * sur les 6 rushes réels mesurés et sur une matière synthétique variée
 * (formats, rush unique / multi-rush, musique ou non, cartes, durées
 * insuffisantes, plages déjà montées).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { planMontage, type AnalyseRush, type OptionsMontage, type ProfilMontage } from '@/lib/creer/smart-montage';
import { decisionMontagePourMetadata } from '@/lib/creer/fiche-contenu';
import fixture from './fixtures/passages-rushes-reels.json';
import empreintes from './fixtures/passages-off-empreintes.json';

const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const REELS = fixture.rushes as AnalyseRush[];

/** Rush synthétique déterministe (aucun aléa) : plans, gestes, son, N&B. */
function synth(nom: string, duree: number, graine: number, opts: { nb?: boolean; son?: boolean; pas?: number } = {}): AnalyseRush {
  const pas = opts.pas ?? 0.5;
  const ech = [];
  for (let i = 0; i * pas < duree; i++) {
    const t = Math.round(i * pas * 1000) / 1000;
    const plan = Math.floor(t / (3 + (graine % 3)));
    const v = (k: number) => (Math.sin(graine * 7.1 + plan * 3.3 + k * 1.7) + 1) / 2;
    const coupe = i > 0 && Math.floor(((i - 1) * pas) / (3 + (graine % 3))) !== plan;
    ech.push({
      t,
      mouvement: i === 0 ? 0 : coupe ? 0.3 : 0.02 + 0.06 * v(i % 5),
      luminosite: 0.3 + 0.4 * v(1),
      nettete: 0.05 + 0.05 * v(2),
      audio: opts.son ? 0.2 + 0.5 * v(i % 3) : 0,
      empreinte: Array.from({ length: 64 }, (_, k) => Math.round(v(k + plan) * 1000) / 1000),
      saturation: opts.nb ? 0.01 : 0.1 + 0.3 * v(4),
    });
  }
  return { url: `https://studiio.pro/storage/v1/object/public/media/u1/${nom}.mp4`, duree, echantillons: ech };
}

const SYNTH = [
  synth('s-a', 12, 1, { son: true }), synth('s-b', 9, 2), synth('s-c', 20, 3, { son: true }),
  synth('s-nb', 8, 4, { nb: true }), synth('s-gop', 14, 5, { pas: 4.2 }),
];

const CONTEXTES = {
  danse: { theme: 'danse afro cardio', sujet: 'cours de danse énergie', cartes: ['Brûle des calories', 'Bouge en rythme', 'Énergie'] },
  nutrition: { theme: 'nutrition', sujet: 'bien manger au quotidien', objectif: 'conseils' },
  lifestyle: { theme: 'lifestyle', sujet: 'marque de mode et style', cartes: ['Style', 'Élégance'] },
};

export function scenarios(): Array<{ nom: string; analyses: AnalyseRush[]; cible: number; options: OptionsMontage }> {
  const out: Array<{ nom: string; analyses: AnalyseRush[]; cible: number; options: OptionsMontage }> = [];
  const jeux: Record<string, AnalyseRush[]> = {
    reels6: REELS, perso2: REELS.slice(0, 2), pexels4: REELS.slice(2), unique: REELS.slice(0, 1),
    synth: SYNTH, mixte: [...REELS.slice(0, 3), ...SYNTH.slice(0, 2)], vide: [],
  };
  const profils: Array<ProfilMontage | undefined> = [undefined, 'CARDIO_DANCE', 'LIFESTYLE_BRAND', 'TUTORIAL_EDUCATION', 'EVENT_IMMERSIVE', 'STANDARD'];
  for (const [nomJeu, analyses] of Object.entries(jeux)) {
    const complet = nomJeu === 'reels6' || nomJeu === 'mixte';
    for (const cible of complet ? [5, 20, 46, 60, 90] : [20, 60]) {
      for (const [nomCtx, contexte] of Object.entries(CONTEXTES)) {
        for (const profil of complet ? profils : [undefined, 'CARDIO_DANCE', 'STANDARD'] as Array<ProfilMontage | undefined>) {
          for (const musique of [false, true]) {
            if (nomJeu !== 'reels6' && (profil === 'EVENT_IMMERSIVE' || profil === 'TUTORIAL_EDUCATION') && musique) continue;
            const rythme = musique ? (cible <= 46 ? fixture.rythme46 : fixture.rythme60) : null;
            out.push({ nom: `${nomJeu}/${cible}/${nomCtx}/${profil ?? 'auto'}/${musique ? 'musique' : 'sans'}`, analyses, cible, options: { contexte, rythme, ...(profil ? { profil } : {}) } });
          }
        }
      }
    }
  }
  // Anciens projets : plages déjà montées dans le cycle, longueur imposée, sans contexte.
  out.push({ nom: 'exclues', analyses: REELS, cible: 30, options: { plagesExclues: { 'media/u1/converted_1791985445290.mp4': [[10, 20]] } } });
  out.push({ nom: 'longueur', analyses: REELS, cible: 30, options: { longueurExtrait: 2 } });
  out.push({ nom: 'sans-options', analyses: REELS, cible: 30, options: undefined as unknown as OptionsMontage });
  out.push({ nom: 'cible-nulle', analyses: REELS, cible: 0, options: {} });
  return out;
}

/** Empreintes du mode actuel, prises AVANT le code M3-a (b5a248d), une par scénario. */
const AVANT = empreintes as { globale: string; scenarios: Record<string, string> };

describe('M3-a PR1 — mode actuel inchangé octet pour octet', () => {
  const liste = scenarios();
  let plans: ReturnType<typeof planMontage>[] = [];
  beforeAll(() => { plans = liste.map((s) => planMontage(s.analyses, s.cible, s.options)); }, 180_000);

  it('sans option : chaque scénario a l\'empreinte prise avant le code', () => {
    if (process.env.M3A_IMPRIMER) {
      writeFileSync(process.env.M3A_IMPRIMER, JSON.stringify({ globale: sha(plans), scenarios: Object.fromEntries(liste.map((s, i) => [s.nom, sha(plans[i])])) }, null, 0));
    }
    expect(Object.keys(AVANT.scenarios).length).toBe(liste.length);
    const differents = liste.filter((s, i) => AVANT.scenarios[s.nom] !== sha(plans[i])).map((s) => s.nom);
    expect(differents).toEqual([]);
    expect(sha(plans)).toBe(AVANT.globale);
  });

  it("selection: 'grille' explicite = sortie identique à l'absence d'option", () => {
    const grille = liste.map((s) => planMontage(s.analyses, s.cible, { ...(s.options ?? {}), selection: 'grille' } as OptionsMontage));
    expect(sha(grille)).toBe(AVANT.globale);
  }, 180_000);

  it('PR2 : analyses porteuses de silences mesurés, sonde et son continu ⇒ grille IDENTIQUE (sans option et `grille`)', () => {
    const avecSon = (a: AnalyseRush): AnalyseRush => ({
      ...a,
      pisteAudio: a.url.includes('converted_') ? true : a.url.includes('pexels') ? false : null,
      silences: a.url.includes('converted_1791985445290') ? [[0, 10.25], [11.9, 12.35], [14.5, 15.25], [15.65, 16.45], [18.75, 19.7], [20.1, 32]] : [[0.2, 0.9]],
      sonContinu: a.url.includes('converted_1792081208949'),
    });
    const enrichis = liste.map((s) => ({ ...s, analyses: s.analyses.map(avecSon) }));
    expect(sha(enrichis.map((s) => planMontage(s.analyses, s.cible, s.options)))).toBe(AVANT.globale);
    expect(sha(enrichis.map((s) => planMontage(s.analyses, s.cible, { ...(s.options ?? {}), selection: 'grille' } as OptionsMontage)))).toBe(AVANT.globale);
  }, 360_000);

  it('aucun segment du mode actuel ne porte de champ du mode passages', () => {
    for (const p of plans) for (const seg of p ?? []) expect('passage' in seg || 'parole' in seg).toBe(false);
  });

  it('decisionMontagePourMetadata sans 4e argument : sortie identique', () => {
    expect(decisionMontagePourMetadata(null, null)).toEqual({});
    expect(decisionMontagePourMetadata(null, null, null)).toEqual({});
    expect(JSON.stringify(decisionMontagePourMetadata({ a: 1 }, null, { p: 2 }))).toBe('{"decisionMontage":{"version":1,"qualiteRushs":{"a":1},"pertinenceRushs":{"p":2}}}');
  });
});
