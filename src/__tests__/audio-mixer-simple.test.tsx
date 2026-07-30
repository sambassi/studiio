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

describe('Mixer vraiment unifié — plus de second jeu de niveaux', () => {
  it('affiche une jauge sous chaque piste quand les niveaux sont fournis', () => {
    const { container } = render(
      <AudioDuckingTimeline
        keyframes={[kf()]}
        onChange={vi.fn()}
        totalDuration={20}
        rushUrl={null}
        autoDuckRunning={false}
        onAutoDuck={vi.fn()}
        levels={{ music: 0.4, rush: 0.2, voice: 0.1 }}
      />,
    );
    // Trois jauges : une par piste, dans la ligne de la piste.
    expect(container.querySelectorAll('.h-0\\.5').length).toBeGreaterThanOrEqual(3);
  });

  it('sans niveaux fournis, aucune jauge — rendu inchangé pour /creer', () => {
    const { container } = render(
      <AudioDuckingTimeline
        keyframes={[kf()]}
        onChange={vi.fn()}
        totalDuration={20}
        rushUrl={null}
        autoDuckRunning={false}
        onAutoDuck={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.h-0\\.5').length).toBe(0);
  });

  it('propose de revenir à un mixage simple dès qu il y a plusieurs points', () => {
    const onChange = vi.fn();
    render(
      <AudioDuckingTimeline
        keyframes={[kf({ id: 'a', time: 0, musicVolume: 0.6 }), kf({ id: 'b', time: 4 }), kf({ id: 'c', time: 8 })]}
        onChange={onChange}
        totalDuration={20}
        rushUrl={null}
        autoDuckRunning={false}
        onAutoDuck={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/Avancé/));
    fireEvent.click(screen.getByText(/Revenir à un mixage simple/));

    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(next).toHaveLength(1);
    // Les volumes en cours sont conservés : on simplifie, on ne réinitialise pas.
    expect(next[0].musicVolume).toBe(0.6);
    expect(next[0].time).toBe(0);
  });

  it('ne propose rien quand la courbe est déjà simple', () => {
    render(
      <AudioDuckingTimeline
        keyframes={[kf()]}
        onChange={vi.fn()}
        totalDuration={20}
        rushUrl={null}
        autoDuckRunning={false}
        onAutoDuck={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/Avancé/));
    expect(screen.queryByText(/Revenir à un mixage simple/)).not.toBeInTheDocument();
  });
});
