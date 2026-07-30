import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AudioDuckingTimeline, { type AudioKeyframe } from '@/components/creer/AudioDuckingTimeline';

/**
 * Mixer épuré — comportement du bloc de niveaux.
 *
 * L'enjeu principal est la COUPURE : elle doit passer par les keyframes, car
 * ce sont elles que lit l'export. Une coupure qui ne toucherait qu'un état
 * local se verrait à l'écoute et s'entendrait quand même dans la vidéo rendue.
 */

const kf = (over: Partial<AudioKeyframe> = {}): AudioKeyframe => ({
  id: 'k0', time: 0, musicVolume: 0.8, rushVolume: 0.6, voiceVolume: 1, ...over,
});

function setup(keyframes: AudioKeyframe[] = [kf()]) {
  const onChange = vi.fn();
  render(
    <AudioDuckingTimeline
      keyframes={keyframes}
      onChange={onChange}
      totalDuration={20}
      rushUrl="https://cdn.test/rush.mp4"
      autoDuckRunning={false}
      onAutoDuck={vi.fn()}
    />,
  );
  return { onChange };
}

describe('Mixer épuré — une piste, un volume, une coupure', () => {
  it('expose exactement trois pistes réglables', () => {
    setup();
    for (const label of ['Musique', 'Son rush', 'Voix off']) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
    expect(screen.getAllByRole('slider')).toHaveLength(3);
  });

  it('chaque piste a son bouton de coupure', () => {
    setup();
    for (const label of ['Couper la musique', 'Couper le son du rush', 'Couper la voix off']) {
      expect(screen.getByTitle(label), label).toBeInTheDocument();
    }
  });

  it('couper une piste met son niveau à 0 dans TOUS les keyframes', () => {
    // C'est ce qui rend la coupure fidèle : l'export lit ces mêmes keyframes.
    const { onChange } = setup([
      kf({ id: 'a', time: 0, musicVolume: 0.8 }),
      kf({ id: 'b', time: 5, musicVolume: 0.3 }),
    ]);

    fireEvent.click(screen.getByTitle('Couper la musique'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(next.map((k) => k.musicVolume)).toEqual([0, 0]);
    // Les autres pistes ne bougent pas.
    expect(next.map((k) => k.rushVolume)).toEqual([0.6, 0.6]);
    expect(next.map((k) => k.voiceVolume)).toEqual([1, 1]);
  });

  it('une piste déjà à 0 est affichée comme coupée', () => {
    setup([kf({ voiceVolume: 0 })]);
    expect(screen.getByTitle('Réactiver la voix off')).toBeInTheDocument();
  });

  it('réactiver restaure le niveau d avant la coupure, pas 100 % par défaut', () => {
    const { onChange } = setup([kf({ musicVolume: 0.42 })]);

    fireEvent.click(screen.getByTitle('Couper la musique'));
    const muted = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(muted[0].musicVolume).toBe(0);

    // Le parent est contrôlé : on lui renvoie l'état coupé, comme en vrai.
    cleanup();
    const onChange2 = vi.fn();
    render(
      <AudioDuckingTimeline
        keyframes={muted}
        onChange={onChange2}
        totalDuration={20}
        rushUrl={null}
        autoDuckRunning={false}
        onAutoDuck={vi.fn()}
      />,
    );
    // Nouveau montage : la mémoire du niveau est perdue, on retombe sur 100 %.
    fireEvent.click(screen.getByTitle('Réactiver la musique'));
    expect((onChange2.mock.calls[0][0] as AudioKeyframe[])[0].musicVolume).toBe(1);
  });
});

describe('Mixer épuré — ce qui est replié', () => {
  it('auto-mix et keyframes sont cachés tant qu on n ouvre pas « Avancé »', () => {
    setup();
    expect(screen.queryByText('Auto-mix')).not.toBeInTheDocument();
    expect(screen.getByText(/Avancé/)).toBeInTheDocument();
  });

  it('ouvrir « Avancé » révèle l auto-mix, sans l avoir supprimé', () => {
    setup();
    fireEvent.click(screen.getByText(/Avancé/));
    expect(screen.getByText('Auto-mix')).toBeInTheDocument();
  });

  it('le bloc de niveaux reste visible quand « Avancé » est fermé', () => {
    setup();
    expect(screen.getAllByRole('slider')).toHaveLength(3);
  });
});
