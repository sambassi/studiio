/**
 * Durée insuffisante après écart des rushs flous : même avertissement dans
 * Créer et Autopilote (`raccourciNecessaire`), jamais de rallonge ni de flou réintroduit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { raccourciNecessaire } from '@/lib/creer/raccourci';

const src = (p: string) => readFileSync(p, 'utf8');

describe('raccourciNecessaire', () => {
  it('sans flou écarté : message d’avant, inchangé', () => {
    const r = raccourciNecessaire(30, 4, 1)!;
    expect(r.message).toBe('Vos rushs actuels permettent une vidéo d’environ 4 secondes sans répétition. Pour obtenir une vidéo de 30 secondes, ajoutez davantage de rushs.');
  });
  it('mentionne les rushs flous écartés, avec accord', () => {
    expect(raccourciNecessaire(30, 4, 1, 1)!.message).toContain('1 rush trop flou écarté du montage.');
    expect(raccourciNecessaire(30, 4, 1, 2)!.message).toContain('2 rushs trop flous écartés du montage.');
    expect(raccourciNecessaire(30, 4, 1, 1)!.message).toContain('4 secondes');
    expect(raccourciNecessaire(30, 4, 1, 1)!.message).toContain('30 secondes');
  });
  it('pas d’avertissement si la durée est atteinte', () => {
    expect(raccourciNecessaire(30, 29.5, 2, 1)).toBeNull();
  });
});

describe('repli sans plan : même avertissement dans Autopilote et Créer', () => {
  const autopilote = src('src/lib/autopilot/produire.ts');
  const creer = src('src/app/dashboard/creer/AssistantWizard.tsx');
  it('Autopilote renseigne montageRaccourci dans le repli, avec le nombre de flous', () => {
    expect(autopilote).toContain('montageRaccourci = raccourciNecessaire(cibleMontage, duree, 1, flous.size)');
  });
  it('Créer demande le choix puis affiche le même message dans le repli', () => {
    expect(creer).toContain('raccourciNecessaire(demandeVideo, secondesNets, nets.length, flous.size)');
    expect(creer).toContain('raccourciRepli?.message');
  });
  it('le repli Créer ne rallonge pas : la durée vidéo est plafonnée aux secondes nettes', () => {
    expect(creer).toContain('Math.min(plateau.videoDuration, Math.max(1, Math.floor(secondesNets)))');
  });
});

// Aperçu de Créer : plan vide (rush net court + rush flou) → l'avertissement de durée est déjà là, avant l'export.
import { preparerPlanMontage } from '@/lib/creer/preparer-plan-montage';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';

function rush(url: string, duree: number, nettete: number): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < duree; t += 1) {
    echantillons.push({ t, mouvement: 0.1, luminosite: 0.5, nettete, audio: 0.02, empreinte: Array.from({ length: 64 }, (_, i) => ((i * 7 + t * 13) % 100) / 100) });
  }
  return { url, duree, echantillons, pisteAudio: true };
}
const entree = (urls: string[]) => ({
  rushs: urls.map((url) => ({ url })), cibleEcran: 30, debutVideo: 0, methode: 'A', contexte: { theme: null, titre: null, sousTitre: null, objectif: null, cartes: [] },
}) as unknown as Parameters<typeof preparerPlanMontage>[0];

describe('aperçu de Créer, plan vide', () => {
  it('un rush net de 3 s + un flou : avertissement avec durée disponible et flou écarté', () => {
    const net = rush('https://x/n.mp4', 3, 0.7);
    const flou = rush('https://x/f.mp4', 40, 0.1);
    const prep = preparerPlanMontage(entree([net.url, flou.url]), { analysesBrutes: [net, flou], rythme: null, ameliore: true });
    expect(prep.plan).toBeNull();
    expect(prep.raccourci?.possible).toBe(3);
    expect(prep.raccourci?.message).toContain('1 rush trop flou écarté');
  });
  it('sans rush flou : aucun avertissement ajouté (comportement d’avant)', () => {
    const a = rush('https://x/a.mp4', 3, 0.7);
    const prep = preparerPlanMontage(entree([a.url]), { analysesBrutes: [a], rythme: null });
    expect(prep.plan).toBeNull();
    expect(prep.raccourci).toBeNull();
  });
});
