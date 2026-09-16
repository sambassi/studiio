import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import Notification from '@/components/ux/Notification';

/** LA notification : quatre niveaux dits et non seulement colorés, message en trois temps, actions, motif replié. */

afterEach(cleanup);

describe('Notification', () => {
  it('⚠️ quatre niveaux : rôle ARIA, libellé du niveau lisible (pas seulement la couleur), attribut data', () => {
    const cas = [
      ['succes', 'status', 'Succès'], ['info', 'status', 'Information'],
      ['avertissement', 'alert', 'Attention'], ['erreur', 'alert', 'Erreur'],
    ] as const;
    for (const [niveau, role, libelle] of cas) {
      const { unmount } = render(<Notification niveau={niveau} titre={`Titre ${niveau}`} />);
      const boite = document.querySelector(`[data-notification="${niveau}"]`)!;
      expect(boite, niveau).not.toBeNull();
      expect(boite.getAttribute('role')).toBe(role);
      expect(boite.textContent).toContain(`${libelle} :`);
      expect(boite.textContent).toContain(`Titre ${niveau}`);
      unmount();
    }
    // Succès et information ne se ressemblent pas.
    render(<Notification niveau="succes" titre="a" />); render(<Notification niveau="info" titre="b" />);
    const [s, i] = [document.querySelector('[data-notification="succes"]')!, document.querySelector('[data-notification="info"]')!];
    expect(s.className).not.toBe(i.className);
  });

  it('⚠️ message en trois temps : titre, détail en liste numérotée, conseils en puces ; motif technique replié', () => {
    render(
      <Notification
        niveau="erreur"
        titre="Votre vidéo de consentement n’a pas été acceptée."
        detail={['votre nom affiché est correct', 'vous lisez la phrase exactement']}
        conseils={['Face caméra, visage visible']}
        motif="did_validationerror — audio-text mismatch"
      />,
    );
    const items = [...document.querySelectorAll('[data-notification-detail] li')].map((l) => l.textContent);
    expect(items).toEqual(['votre nom affiché est correct', 'vous lisez la phrase exactement']);
    expect(document.querySelector('[data-notification-detail]')!.tagName).toBe('OL');
    expect(document.querySelector('[data-notification-conseils]')!.textContent).toContain('Face caméra');
    const motif = document.querySelector('[data-notification-motif]') as HTMLDetailsElement;
    expect(motif.open).toBe(false);
    expect(motif.textContent).toContain('Détail technique');
    expect(motif.textContent).toContain('audio-text mismatch');
  });

  it('un détail simple est un paragraphe ; sans détail ni motif, rien de vide n’est rendu', () => {
    render(<Notification niveau="info" titre="Brouillon retrouvé." detail="Vous reprenez où vous en étiez." />);
    expect(document.querySelector('[data-notification-detail]')!.tagName).toBe('P');
    expect(document.querySelector('[data-notification-motif]')).toBeNull();
    expect(document.querySelector('[data-notification-actions]')).toBeNull();
    expect(document.querySelector('[data-notification-fermer]')).toBeNull();
  });

  it('⚠️ actions : la principale et la secondaire déclenchent leur geste ; fermer appelle onFermer', () => {
    const principale = vi.fn(); const secondaire = vi.fn(); const fermer = vi.fn();
    render(
      <Notification niveau="avertissement" titre="Phrase expirée." actionPrincipale={{ libelle: 'Obtenir une nouvelle phrase', onClick: principale }} actionSecondaire={{ libelle: 'Voir les consignes', onClick: secondaire }} onFermer={fermer} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Obtenir une nouvelle phrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voir les consignes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }));
    expect(principale).toHaveBeenCalledTimes(1);
    expect(secondaire).toHaveBeenCalledTimes(1);
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-notification-action="principale"]')!.className).toContain('button-primary');
    expect(document.querySelector('[data-notification-action="secondaire"]')!.className).toContain('button-ghost');
  });
});
