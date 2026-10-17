/**
 * M1 — Créer : badges de qualité sous la liste des médias, et les deux
 * gestes. Par DÉFAUT rien n'est écarté ; « Écarter ce rush » passe par le
 * retrait manuel existant ; « Utiliser quand même » ne change rien au montage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import QualiteRushs, { CLE_ACCEPTES } from '@/components/creer/QualiteRushs';
import { retirerMedia, rushsDeListe, type MediaVideo } from '@/lib/creer/medias-video';
import type { AnalyseRush, EchantillonRush } from '@/lib/creer/smart-montage';

const U = (n: string) => `https://studiio.pro/storage/v1/object/public/media/u1/${n}.mp4`;
function analyse(url: string, p: Partial<EchantillonRush>): AnalyseRush {
  const echantillons: EchantillonRush[] = [];
  for (let t = 0; t < 10; t += 0.5) {
    echantillons.push({
      t, mouvement: 0.05 + 0.01 * Math.sin(t), luminosite: 0.45, nettete: 0.2, audio: 0.2,
      empreinte: Array.from({ length: 64 }, (_, i) => ((Math.floor(t * 2) * 31 + i * 17) % 97) / 97), ...p,
    });
  }
  return { url, duree: 10, echantillons };
}
const MESURES: Record<string, AnalyseRush> = {
  [U('net-1')]: analyse(U('net-1'), {}),
  [U('net-2')]: analyse(U('net-2'), { nettete: 0.25 }),
  [U('noir')]: analyse(U('noir'), { luminosite: 0.005, empreinte: Array(64).fill(0.005) }),
  [U('flou')]: analyse(U('flou'), { nettete: 0.03, mouvement: 0.0005 }),
};
const media = (id: string, n: string, source: MediaVideo['source'] = 'rush'): MediaVideo => ({ id, source, url: U(n), type: 'video', duree: 10 });
const LISTE: MediaVideo[] = [media('a', 'net-1'), media('b', 'noir'), media('c', 'net-2', 'stock-video'), media('d', 'flou', 'mediatheque')];
const analyser = vi.fn(async (u: string) => MESURES[u] ?? null);

describe('QualiteRushs — badges et gestes', () => {
  it('badges chiffrés pour les rushes à problème seulement ; rushes nets : rien', async () => {
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} />);
    await waitFor(() => expect(document.querySelectorAll('[data-qualite-rush]')).toHaveLength(2));
    const noir = document.querySelector('[data-qualite-rush="media/u1/noir.mp4"]')!;
    expect(noir.getAttribute('data-verdict')).toBe('inutilisable');
    expect(noir.querySelector('[data-qualite-badge]')!.textContent).toBe('Inutilisable : trop sombre');
    expect(noir.textContent).toMatch(/luminance moyenne 0,005 < 0,12/);
    expect(noir.textContent).toMatch(/Média 2/);
    expect(noir.querySelector('[data-qualite-choisi]')).not.toBeNull(); // importé : choisi par vous
    const flou = document.querySelector('[data-qualite-rush="media/u1/flou.mp4"]')!;
    expect(flou.querySelector('[data-qualite-badge]')!.textContent).toBe('Inutilisable : flou');
    expect(flou.textContent).toMatch(/netteté 0,03 contre 0,2[23] pour vos autres rushes/);
    expect(document.querySelector('[data-qualite-rush="media/u1/net-1.mp4"]')).toBeNull();
    expect(screen.getAllByText('Écarter ce rush')).toHaveLength(2);
    expect(screen.getAllByText('Utiliser quand même')).toHaveLength(2);
  });

  it('par défaut : AUCUN retrait (onEcarter jamais appelé sans clic)', async () => {
    const onEcarter = vi.fn(() => true);
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} />);
    await waitFor(() => expect(document.querySelectorAll('[data-qualite-rush]')).toHaveLength(2));
    expect(onEcarter).not.toHaveBeenCalled();
  });

  it('« Écarter ce rush » : demande le retrait de CE rush ; avec le retrait existant, il quitte le montage', async () => {
    const onEcarter = vi.fn(() => true);
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"] [data-qualite-ecarter]')!);
    expect(onEcarter).toHaveBeenCalledWith(U('noir'));
    // Ce que fait `retirerRush` dans Créer : `retirerMedia` sur la liste.
    const apres = retirerMedia(LISTE, LISTE.findIndex((m) => m.url === U('noir')));
    expect(rushsDeListe(apres).map((r) => r.url)).not.toContain(U('noir'));
    expect(rushsDeListe(apres).map((r) => r.url)).toEqual(rushsDeListe(LISTE).map((r) => r.url).filter((u) => u !== U('noir')));
  });

  it('« Utiliser quand même » : avertissement masqué, rien retiré, liste inchangée', async () => {
    const onEcarter = vi.fn(() => true);
    const liste = JSON.parse(JSON.stringify(LISTE));
    render(<QualiteRushs medias={liste} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"]')).not.toBeNull());
    act(() => { fireEvent.click(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"] [data-qualite-accepter]')!); });
    expect(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"]')).toBeNull();
    expect(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"]')).not.toBeNull();
    expect(onEcarter).not.toHaveBeenCalled();
    expect(liste).toEqual(LISTE);
  });

  it('jamais d’analyse d’une URL non durable (blob:) ni de l’avatar', async () => {
    const a = vi.fn(async () => null);
    const liste: MediaVideo[] = [{ id: 'x', source: 'rush', url: 'blob:http://x/1', type: 'video' }, { id: 'y', source: 'avatar', url: U('av'), type: 'video' }];
    render(<QualiteRushs medias={liste} estDurable={(u) => !u.startsWith('blob:')} onEcarter={() => true} analyser={a} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(a).not.toHaveBeenCalled();
  });
});

describe('QualiteRushs — bornes et bugs corrigés', () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } });

  it('rush retiré PENDANT sa mesure : le panneau ne reste pas « Vérification… »', async () => {
    let resoudre: (a: AnalyseRush | null) => void = () => {};
    const lent = vi.fn(() => new Promise<AnalyseRush | null>((r) => { resoudre = r; }));
    const { rerender } = render(<QualiteRushs medias={[media('a', 'net-1')]} estDurable={() => true} onEcarter={() => true} analyser={lent} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rushs-analyse]')).not.toBeNull());
    rerender(<QualiteRushs medias={[]} estDurable={() => true} onEcarter={() => true} analyser={lent} />);
    expect(document.querySelector('[data-qualite-rushs-analyse]')).toBeNull();
    resoudre(null);
  });

  it('analyse qui ne répond jamais : abandonnée après le délai, état propre', async () => {
    const jamais = vi.fn(() => new Promise<AnalyseRush | null>(() => {}));
    render(<QualiteRushs medias={[media('a', 'net-1')]} estDurable={() => true} onEcarter={() => true} analyser={jamais} delaiMs={30} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rushs-analyse]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-qualite-rushs]')).toBeNull(), { timeout: 1000 });
  });

  it('export en cours : AUCUNE analyse lancée, reprise après', async () => {
    const a = vi.fn(async (u: string) => MESURES[u] ?? null);
    const { rerender } = render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={a} enPause />);
    await new Promise((r) => setTimeout(r, 20));
    expect(a).not.toHaveBeenCalled();
    rerender(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={a} enPause={false} />);
    await waitFor(() => expect(document.querySelectorAll('[data-qualite-rush]')).toHaveLength(2));
  });

  it('« Écarter » d’un rush introuvable : rien fait, message', async () => {
    const onEcarter = vi.fn(() => false);
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"] [data-qualite-ecarter]')!);
    expect(document.querySelector('[data-qualite-introuvable]')!.textContent).toMatch(/rien n.a été retiré/);
  });

  it('rush de moins d’une seconde : « trop court pour être analysé », sans analyse', async () => {
    const a = vi.fn(async () => null);
    render(<QualiteRushs medias={[{ ...media('z', 'mini'), duree: 0.8 }]} estDurable={() => true} onEcarter={() => true} analyser={a} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/mini.mp4"]')).not.toBeNull());
    expect(document.querySelector('[data-qualite-rush="media/u1/mini.mp4"]')!.textContent).toMatch(/trop court pour être analysé : 0,8 s/);
    expect(a).not.toHaveBeenCalled();
  });

  it('« Utiliser quand même » mémorisé : ne réapparaît pas au rechargement', async () => {
    const { unmount } = render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"] [data-qualite-accepter]')!);
    unmount();
    expect(JSON.parse(window.localStorage.getItem(CLE_ACCEPTES)!)).toEqual(['media/u1/flou.mp4']);
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => true} analyser={analyser} />);
    await waitFor(() => expect(document.querySelector('[data-qualite-rush="media/u1/noir.mp4"]')).not.toBeNull());
    expect(document.querySelector('[data-qualite-rush="media/u1/flou.mp4"]')).toBeNull();
  });
});

describe('Créer — câblage minimal', () => {
  const aw = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
  it('le panneau suit la liste des médias et « Écarter » = le retrait manuel existant', () => {
    expect(aw).toContain('<QualiteRushs medias={listeMedias} estDurable={urlDurable} onEcarter={ecarterRushQualite} enPause={sending} contexte={contextePertinence} onFiches={retenirFichesPanneau} />');
    // « Écarter » n'emprunte JAMAIS le repli `clearRush` de `retirerRush`.
    const f = aw.slice(aw.indexOf('const ecarterRushQualite = (url: string): boolean => {'), aw.indexOf('const choisirDureeMedia'));
    expect(f).toContain('if (i < 0) return false;');
    expect(f).not.toContain('clearRush');
    expect(aw.match(/<QualiteRushs /g)).toHaveLength(1);
  });
  it('export : la MÊME analyse mémorisée que le panneau ; le diagnostic ne nourrit pas planMontage', () => {
    expect(aw).toContain('const a = await analyserRushMemo(rushsDurables[i].url, (f) =>');
    expect(aw).not.toMatch(/await analyserRush\(/);
    // M3-a PR3 : calcul déplacé dans `preparerPlanMontage`, qui ne reçoit que les analyses (jamais le diagnostic).
    expect(readFileSync('src/lib/creer/preparer-plan-montage.ts', 'utf8')).toContain('plan = planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage });');
    expect(readFileSync('src/lib/creer/preparer-plan-montage.ts', 'utf8')).not.toMatch(/qualite/i);
    const panneau = readFileSync('src/components/creer/QualiteRushs.tsx', 'utf8');
    expect(panneau).toContain('return analyserRushMemo(url, undefined, { borne: true });');
  });
  it('Créer écrit le diagnostic CONSULTATIF dans le post, même forme que l’Autopilote', () => {
    // M2-a : même clé, même helper des deux côtés (`decisionMontagePourMetadata`,
    // `{ version: 1, qualiteRushs }` à l'identique tant qu'aucune fiche n'apprend rien).
    expect(aw).toContain('...decisionMontagePourMetadata(qualiteRushsCreer, contenuRushsCreer, pertinenceRushsCreer),');
    const pr = readFileSync('src/lib/autopilot/produire.ts', 'utf8');
    expect(pr).toContain('return qualiteRushsPourMetadata(d);');
    expect(pr).toContain('})(), contenuRushs, pertinenceRushs),');
  });
});
