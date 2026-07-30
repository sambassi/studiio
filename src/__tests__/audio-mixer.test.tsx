import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AudioMixer from '../components/creer/AudioMixer';
import type { AudioKeyframe } from '../lib/creer/audioDucking';

/**
 * Mixer épuré.
 *
 * Le panneau réglait le même son à deux endroits : trois curseurs globaux
 * d'un côté, un bloc « Écouter le mixage » avec ses propres niveaux de
 * l'autre, plus Auto-mix et un éditeur de keyframes en permanence à
 * l'écran. La cible : une ligne par piste, un bouton de lecture, le reste
 * replié.
 *
 * Deux invariants comptent plus que l'apparence, et ce sont eux que ces
 * tests gardent : **rien n'est perdu** (auto-mix et keyframes restent
 * atteignables) et **l'export ne change pas** (les volumes s'écrivent sur
 * les keyframes exactement comme avant).
 */

const KF = (over: Partial<AudioKeyframe> = {}): AudioKeyframe => ({
  id: 'kf-0',
  time: 0,
  musicVolume: 1,
  rushVolume: 0.5,
  voiceVolume: 1,
  ...over,
});

const base = {
  totalDuration: 20,
  rushUrl: 'https://exemple.test/rush.mp4',
  musicUrl: 'https://exemple.test/musique.mp3',
  voiceUrl: 'https://exemple.test/voix.mp3',
  autoDuckRunning: false,
  onAutoDuck: () => {},
  introDuration: 4,
  cardsDuration: 6,
  ctaDuration: 4,
  videoSeqStart: 10,
  videoSeqDuration: 6,
};

function renderMixer(over: Partial<React.ComponentProps<typeof AudioMixer>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <AudioMixer keyframes={[KF()]} onChange={onChange} {...base} {...over} />,
  );
  return { ...utils, onChange };
}

const slider = (label: string) => screen.getByLabelText(`Volume — ${label}`) as HTMLInputElement;

afterEach(cleanup);

describe('Un seul bloc, une ligne par piste', () => {
  it('affiche les trois pistes, et rien de plus', () => {
    renderMixer();
    for (const label of ['Musique', 'Son de la vidéo', 'Voix off']) {
      expect(slider(label)).toBeDefined();
      expect(screen.getByLabelText(`Couper — ${label}`)).toBeDefined();
    }
    // Un seul bouton de lecture pour tout le mixage.
    expect(screen.getAllByRole('button', { name: /Écouter/ })).toHaveLength(1);
  });

  it('n’a plus de curseurs en double', () => {
    // C'était le cœur du problème : les niveaux globaux vivaient ici ET
    // dans le bloc de lecture.
    renderMixer();
    expect(screen.getAllByRole('slider')).toHaveLength(3);
  });

  it('affiche le niveau du PREMIER keyframe', () => {
    renderMixer({ keyframes: [KF({ musicVolume: 0.4, rushVolume: 0.9, voiceVolume: 0.7 })] });
    expect(slider('Musique').value).toBe('40');
    expect(slider('Son de la vidéo').value).toBe('90');
    expect(slider('Voix off').value).toBe('70');
  });

  it('grise une piste sans source', () => {
    // Régler le volume d'une musique absente n'a aucun sens.
    renderMixer({ musicUrl: null });
    expect(slider('Musique').disabled).toBe(true);
    expect(slider('Voix off').disabled).toBe(false);
  });
});

describe('L’export ne change pas', () => {
  it('écrit le volume sur TOUS les keyframes', () => {
    // N'écrire que sur le premier laisserait la courbe reprendre l'ancien
    // niveau à la seconde suivante : le réglage semblerait ignoré à
    // l'export. C'est exactement ce que faisaient les curseurs globaux.
    const { onChange } = renderMixer({
      keyframes: [KF({ id: 'a', time: 0 }), KF({ id: 'b', time: 5, musicVolume: 0.2 })],
    });
    fireEvent.change(slider('Musique'), { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(next).toHaveLength(2);
    expect(next.every((k) => k.musicVolume === 0.3)).toBe(true);
    // Les autres pistes ne bougent pas.
    expect(next[0].rushVolume).toBe(0.5);
    expect(next[0].voiceVolume).toBe(1);
  });

  it('ne touche qu’à la piste réglée', () => {
    const { onChange } = renderMixer();
    fireEvent.change(slider('Son de la vidéo'), { target: { value: '80' } });
    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(next[0].rushVolume).toBe(0.8);
    expect(next[0].musicVolume).toBe(1);
  });

  it('n’ajoute aucun champ aux keyframes', () => {
    // La coupure passe par le volume, pas par un champ nouveau : le
    // compositeur lit exactement les mêmes clés qu'avant.
    const { onChange } = renderMixer();
    fireEvent.click(screen.getByLabelText('Couper — Musique'));
    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(Object.keys(next[0]).sort()).toEqual(
      ['id', 'musicVolume', 'rushVolume', 'time', 'voiceVolume'],
    );
  });
});

describe('Couper le son', () => {
  it('met la piste à zéro', () => {
    const { onChange } = renderMixer();
    fireEvent.click(screen.getByLabelText('Couper — Voix off'));
    expect((onChange.mock.calls[0][0] as AudioKeyframe[])[0].voiceVolume).toBe(0);
  });

  it('rétablit le niveau d’avant, pas 100 %', () => {
    // Sans mémoire du niveau, rétablir ramènerait la piste au maximum et
    // écraserait le réglage de l'utilisateur.
    const { onChange, rerender } = renderMixer({ keyframes: [KF({ musicVolume: 0.35 })] });
    fireEvent.click(screen.getByLabelText('Couper — Musique'));
    expect((onChange.mock.calls[0][0] as AudioKeyframe[])[0].musicVolume).toBe(0);

    // Le parent renvoie l'état coupé, comme le ferait React.
    rerender(
      <AudioMixer keyframes={[KF({ musicVolume: 0 })]} onChange={onChange} {...base} />,
    );
    fireEvent.click(screen.getByLabelText('Rétablir — Musique'));
    expect((onChange.mock.calls[1][0] as AudioKeyframe[])[0].musicVolume).toBe(0.35);
  });

  it('change d’icône selon l’état', () => {
    renderMixer({ keyframes: [KF({ musicVolume: 0 })] });
    expect(screen.getByLabelText('Rétablir — Musique').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Couper — Voix off').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Rien n’est perdu — « Avancé » reste à un clic', () => {
  it('replie auto-mix et keyframes par défaut', () => {
    renderMixer();
    expect(screen.queryByRole('button', { name: /Auto-mix/ })).toBeNull();
    const advanced = screen.getByRole('button', { name: /Avancé/ });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
  });

  it('les rend accessibles au clic', () => {
    renderMixer();
    fireEvent.click(screen.getByRole('button', { name: /Avancé/ }));
    expect(screen.getByRole('button', { name: /Auto-mix/ })).toBeDefined();
  });

  it('ne réaffiche PAS les curseurs globaux dans « Avancé »', () => {
    // Ils y feraient réapparaître le doublon qu'on vient de supprimer.
    renderMixer();
    fireEvent.click(screen.getByRole('button', { name: /Avancé/ }));
    expect(screen.queryByText(/Volume musique global/)).toBeNull();
    // Les trois curseurs de piste restent les seuls du bloc… plus ceux des
    // keyframes individuels, qui vivent dans la timeline.
    expect(screen.getAllByLabelText(/^Volume — /)).toHaveLength(3);
  });
});

describe('Les composants réutilisés gardent leur rendu d’avant', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '../components/creer', f), 'utf-8');

  it('les drapeaux ont un défaut qui reproduit l’existant', () => {
    // `/dashboard/creer` monte ces deux composants directement : un défaut
    // différent y changerait l'affichage sans qu'on ait touché le fichier.
    expect(src('AudioDuckingTimeline.tsx')).toMatch(/showLevels = true/);
    expect(src('AudioMixPreview.tsx')).toMatch(/compact = false/);
  });

  it('le mixer, lui, les passe explicitement', () => {
    const mixer = src('AudioMixer.tsx');
    expect(mixer).toMatch(/showLevels=\{false\}/);
    expect(mixer).toMatch(/compact\n/);
  });

  it('`/dashboard/creer` n’est pas touché', () => {
    // La consigne : une autre session travaille sur ce fichier.
    const page = readFileSync(
      resolve(__dirname, '../app/dashboard/creer/page.tsx'),
      'utf-8',
    );
    // Il monte toujours les deux composants historiques, sans drapeau.
    expect(page).toMatch(/<AudioDuckingTimeline/);
    expect(page).toMatch(/<AudioMixPreview/);
    expect(page).not.toMatch(/AudioMixer/);
    // Et il ne passe AUCUN des nouveaux drapeaux : son rendu est donc celui
    // d'avant, par construction. (« compact » apparaît ailleurs dans ce
    // fichier comme nom de style de carte — d'où la vérification ciblée sur
    // les deux balises plutôt que sur le mot seul.)
    for (const tag of ['<AudioDuckingTimeline', '<AudioMixPreview']) {
      const from = page.indexOf(tag);
      expect(from).toBeGreaterThan(-1);
      const block = page.slice(from, page.indexOf('/>', from));
      expect(block).not.toMatch(/showLevels/);
      expect(block).not.toMatch(/compact/);
    }
  });
});
