import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AudioDuckingTimeline, { sanitizeKeyframe, type AudioKeyframe } from '@/components/creer/AudioDuckingTimeline';

/**
 * Régression : ouvrir « Avancé » faisait tomber la page entière.
 *
 * `kf.time.toFixed()` lève quand `time` est `undefined`, et l'appel se
 * produisait DANS le map de rendu des keyframes — donc au déploiement du bloc
 * avancé, avec un seul keyframe abîmé venu d'un brouillon restauré.
 */

const ok = (over: Partial<AudioKeyframe> = {}): AudioKeyframe => ({
  id: 'k0', time: 2, musicVolume: 0.8, rushVolume: 0.5, voiceVolume: 1, ...over,
});

function renderTimeline(keyframes: AudioKeyframe[]) {
  const onChange = vi.fn();
  render(
    <AudioDuckingTimeline
      keyframes={keyframes}
      onChange={onChange}
      totalDuration={20}
      rushUrl={null}
      autoDuckRunning={false}
      onAutoDuck={vi.fn()}
    />,
  );
  return { onChange };
}

/** Déplie « Avancé » — c'est l'action qui déclenchait le crash. */
const openAdvanced = () => fireEvent.click(screen.getByText(/Avancé/));

describe('Bloc « Avancé » — plus de crash sur un keyframe abîmé', () => {
  it('rend la timeline avec un keyframe sans `time`', () => {
    // Reproduction exacte du bug de production.
    renderTimeline([{ id: 'broken', musicVolume: 0.8, rushVolume: 0.5 } as unknown as AudioKeyframe]);
    expect(() => openAdvanced()).not.toThrow();
    expect(screen.getByText(/keyframes/)).toBeInTheDocument();
  });

  it('rend avec chaque champ numérique manquant, un par un', () => {
    for (const missing of ['time', 'musicVolume', 'rushVolume', 'voiceVolume'] as const) {
      const kf = ok();
      delete (kf as Record<string, unknown>)[missing];
      renderTimeline([kf]);
      expect(() => openAdvanced(), missing).not.toThrow();
      cleanup();
    }
  });

  it('rend avec des valeurs aberrantes (NaN, Infinity, null, négatif)', () => {
    const bad = [
      ok({ time: Number.NaN }),
      ok({ time: Number.POSITIVE_INFINITY }),
      ok({ time: -5 }),
      ok({ musicVolume: Number.NaN }),
      ok({ time: null as unknown as number }),
      ok({ time: '3' as unknown as number }),
    ];
    for (const kf of bad) {
      renderTimeline([kf]);
      expect(() => openAdvanced(), JSON.stringify(kf.time)).not.toThrow();
      cleanup();
    }
  });

  it('n affiche jamais NaN à l écran', () => {
    renderTimeline([ok({ time: Number.NaN, musicVolume: Number.NaN })]);
    openAdvanced();
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('un keyframe abîmé n est pas PERDU : il reste modifiable', () => {
    // Écarter le keyframe au rendu l'aurait supprimé à la première
    // modification globale, puisque les mutations remappent cette liste.
    const { onChange } = renderTimeline([
      { id: 'broken', musicVolume: 0.8, rushVolume: 0.5 } as unknown as AudioKeyframe,
      ok({ id: 'good', time: 5 }),
    ]);
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '40' } });
    const next = onChange.mock.calls[0][0] as AudioKeyframe[];
    expect(next).toHaveLength(2);
    expect(next.map((k) => k.id).sort()).toEqual(['broken', 'good']);
    expect(next.every((k) => Number.isFinite(k.time))).toBe(true);
  });
});

describe('Réparation d un keyframe', () => {
  it('laisse un keyframe valide STRICTEMENT inchangé, même référence', () => {
    // La garantie « rien ne change quand la valeur existe ».
    const valid = ok();
    expect(sanitizeKeyframe(valid)).toBe(valid);
    const sansVoix = { id: 'a', time: 1, musicVolume: 1, rushVolume: 0.5 } as AudioKeyframe;
    expect(sanitizeKeyframe(sansVoix)).toBe(sansVoix);
  });

  it('remplace chaque champ abîmé par son repli', () => {
    const fixed = sanitizeKeyframe({ id: 'x' } as unknown as AudioKeyframe);
    expect(fixed).toMatchObject({ time: 0, musicVolume: 1, rushVolume: 0.5 });
  });

  it('garde `voiceVolume` absent absent — le contrat le veut optionnel', () => {
    const fixed = sanitizeKeyframe({ id: 'x', time: 1, musicVolume: 1, rushVolume: 0.5 } as AudioKeyframe);
    expect(fixed.voiceVolume).toBeUndefined();
  });

  it('ramène un temps négatif à zéro', () => {
    expect(sanitizeKeyframe(ok({ time: -3 })).time).toBe(0);
  });

  it('invente un identifiant seulement s il manque', () => {
    expect(sanitizeKeyframe({ time: 1.5, musicVolume: 1, rushVolume: 0.5 } as AudioKeyframe).id).toBeTruthy();
    expect(sanitizeKeyframe(ok({ id: 'garde-moi' })).id).toBe('garde-moi');
  });
});
