/**
 * M1 — Créer : badges de qualité sous la liste des médias, et les deux
 * gestes. Par DÉFAUT rien n'est écarté ; « Écarter ce rush » passe par le
 * retrait manuel existant ; « Utiliser quand même » ne change rien au montage.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import QualiteRushs from '@/components/creer/QualiteRushs';
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
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={() => {}} analyser={analyser} />);
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
    const onEcarter = vi.fn();
    render(<QualiteRushs medias={LISTE} estDurable={() => true} onEcarter={onEcarter} analyser={analyser} />);
    await waitFor(() => expect(document.querySelectorAll('[data-qualite-rush]')).toHaveLength(2));
    expect(onEcarter).not.toHaveBeenCalled();
  });

  it('« Écarter ce rush » : demande le retrait de CE rush ; avec le retrait existant, il quitte le montage', async () => {
    const onEcarter = vi.fn();
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
    const onEcarter = vi.fn();
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
    render(<QualiteRushs medias={liste} estDurable={(u) => !u.startsWith('blob:')} onEcarter={() => {}} analyser={a} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(a).not.toHaveBeenCalled();
  });
});

describe('Créer — câblage minimal', () => {
  const aw = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
  it('le panneau suit la liste des médias et « Écarter » = le retrait manuel existant', () => {
    expect(aw).toContain('<QualiteRushs medias={listeMedias} estDurable={urlDurable} onEcarter={retirerRush} />');
    expect(aw.match(/<QualiteRushs /g)).toHaveLength(1);
  });
  it('l’export n’en dépend pas : aucun diagnostic dans le chemin planMontage de Créer', () => {
    const debut = aw.indexOf("setRenderStage('Analyse des rushes…');");
    const fin = aw.indexOf('planMontageRushs = planMontage(analyses, cibleEcran', debut);
    expect(debut).toBeGreaterThan(0);
    expect(aw.slice(debut, fin)).not.toMatch(/qualite|Qualite/);
  });
});
