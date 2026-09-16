import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import ProgressStatus, { formaterDuree, pourcentageWorkflow, type EtapeProgression } from '@/components/ux/ProgressStatus';

/**
 * LA progression : un pourcentage n'est affiché que s'il est FOURNI ; sinon
 * la barre est indéterminée. Le seul chiffre calculé est celui du workflow
 * (étapes terminées / total), nommé à part. Le temps écoulé vient d'un
 * horodatage — il survit à un rechargement.
 */

afterEach(cleanup);
const barre = () => screen.getByRole('progressbar');

describe('ProgressStatus — déterminé', () => {
  it.each([[0], [50], [100]])('⚠️ %i %% : affiché, aria-valuenow exact, largeur de barre égale', (p) => {
    render(<ProgressStatus titre="Rendu du montage" statut={p === 100 ? 'succes' : 'en_cours'} pourcentage={p} />);
    expect(document.querySelector('[data-progress-pourcentage]')!.textContent).toBe(`${p} %`);
    expect(barre().getAttribute('aria-valuenow')).toBe(String(p));
    expect(barre().getAttribute('aria-valuemin')).toBe('0');
    expect(barre().getAttribute('aria-valuemax')).toBe('100');
    expect(barre().getAttribute('aria-label')).toBe('Rendu du montage');
    expect((barre().firstElementChild as HTMLElement).style.width).toBe(`${p}%`);
    expect(document.querySelector('[data-progress-status]')!.getAttribute('data-progress-determinee')).toBe('oui');
  });

  it('les valeurs hors bornes sont ramenées à 0–100 ; jamais de NaN', () => {
    render(<ProgressStatus titre="x" statut="en_cours" pourcentage={137} />);
    expect(barre().getAttribute('aria-valuenow')).toBe('100');
    cleanup();
    render(<ProgressStatus titre="x" statut="en_cours" pourcentage={-3} />);
    expect(barre().getAttribute('aria-valuenow')).toBe('0');
    cleanup();
    render(<ProgressStatus titre="x" statut="en_cours" pourcentage={Number.NaN} />);
    expect(barre().getAttribute('aria-valuenow')).toBe('0');
  });
});

describe('ProgressStatus — indéterminé (fournisseur sans %)', () => {
  it('⚠️ sans `pourcentage` : AUCUN chiffre inventé, pas d’aria-valuenow, aria-busy, barre animée, texte « progression inconnue »', () => {
    render(<ProgressStatus titre="Entraînement de votre avatar" statut="en_cours" />);
    expect(document.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
    expect(barre().getAttribute('aria-busy')).toBe('true');
    expect(barre().getAttribute('aria-valuetext')).toContain('inconnue');
    expect(barre().getAttribute('data-progress-barre')).toBe('indeterminee');
    expect(document.querySelector('[data-progress-status]')!.getAttribute('data-progress-determinee')).toBe('non');
    expect(document.body.textContent).toContain('Cette page se met à jour automatiquement.');
  });

  it('⚠️ le workflow est calculé des étapes RÉELLES et nommé à part de l’opération inconnue', () => {
    const etapes: EtapeProgression[] = [
      { libelle: 'Téléchargement', etat: 'terminee' }, { libelle: 'Vérification', etat: 'terminee' },
      { libelle: 'Création', etat: 'terminee' }, { libelle: 'Entraînement', etat: 'courante' }, { libelle: 'Prêt', etat: 'a_venir' },
    ];
    render(<ProgressStatus titre="Entraînement de votre avatar" statut="en_cours" etapes={etapes} detail="Entraînement fournisseur en cours" />);
    expect(pourcentageWorkflow(etapes)).toBe(60);
    const w = document.querySelector('[data-progress-workflow]')!;
    expect(w.getAttribute('data-progress-workflow')).toBe('60');
    expect(w.textContent).toContain('Progression du workflow : 60 %');
    expect(w.textContent).toContain('progression inconnue');
    // Le gros chiffre de l'opération, lui, n'existe pas : 60 % n'est pas présenté comme l'entraînement.
    expect(document.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
    expect(document.querySelector('[data-progress-etape]')!.textContent).toBe('Étape 4 sur 5 — Entraînement');
    const etats = [...document.querySelectorAll('[data-progress-etape-etat]')].map((e) => e.getAttribute('data-progress-etape-etat'));
    expect(etats).toEqual(['terminee', 'terminee', 'terminee', 'courante', 'a_venir']);
    // Chaque état est DIT (sr-only), pas seulement coloré.
    expect(document.querySelector('[data-progress-etapes]')!.textContent).toContain('en cours : Entraînement');
    expect(pourcentageWorkflow([])).toBeNull();
  });

  it('etapeCourante / totalEtapes sans liste : la position est affichée, aucun workflow % n’est calculé', () => {
    render(<ProgressStatus titre="Montage" statut="en_cours" pourcentage={68} etapeCourante={4} totalEtapes={6} detail="12 clips sur 18 traités" />);
    expect(document.querySelector('[data-progress-etape]')!.textContent).toBe('Étape 4 sur 6');
    expect(document.querySelector('[data-progress-workflow]')).toBeNull();
    expect(document.querySelector('[data-progress-detail]')!.textContent).toBe('12 clips sur 18 traités');
  });
});

describe('ProgressStatus — temps', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('⚠️ la durée écoulée vient de l’horodatage de début (rechargement = même valeur) et avance chaque seconde ; l’estimé n’apparaît que s’il est fourni', () => {
    const debut = new Date('2026-09-16T09:58:18Z').toISOString(); // il y a 1:42
    render(<ProgressStatus titre="Entraînement" statut="en_cours" debutLe={debut} />);
    expect(document.querySelector('[data-progress-ecoulee]')!.textContent).toContain('01:42');
    expect(document.querySelector('[data-progress-reste]')).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(document.querySelector('[data-progress-ecoulee]')!.textContent).toContain('01:45');
    // « Rechargement » : un nouveau rendu avec le MÊME horodatage repart de la vraie durée, pas de zéro.
    cleanup();
    render(<ProgressStatus titre="Entraînement" statut="en_cours" debutLe={debut} resteEstime="~2 min" />);
    expect(document.querySelector('[data-progress-ecoulee]')!.textContent).toContain('01:45');
    expect(document.querySelector('[data-progress-reste]')!.textContent).toContain('~2 min');
  });

  it('formaterDuree : secondes, minutes, heures ; jamais négatif', () => {
    expect(formaterDuree(0)).toBe('00:00');
    expect(formaterDuree(102_000)).toBe('01:42');
    expect(formaterDuree(3_725_000)).toBe('1:02:05');
    expect(formaterDuree(-5000)).toBe('00:00');
  });
});

describe('ProgressStatus — échec, succès, compact', () => {
  it('⚠️ échec à une étape : la barre garde sa dernière valeur réelle, l’étape est ✕, le motif et les actions sont là', () => {
    const reessayer = vi.fn();
    const etapes: EtapeProgression[] = [
      { libelle: 'Source', etat: 'terminee' }, { libelle: 'Consentement', etat: 'terminee' }, { libelle: 'Création', etat: 'terminee' },
      { libelle: 'Entraînement', etat: 'echouee' }, { libelle: 'Prêt', etat: 'a_venir' },
    ];
    render(<ProgressStatus titre="Entraînement" statut="erreur" pourcentage={67} etapes={etapes} echec={{ etape: 'Entraînement', motif: 'La vidéo source n’a pas permis de créer l’avatar.', actions: [{ libelle: 'Réessayer', onClick: reessayer, principale: true }, { libelle: 'Voir comment corriger', onClick: () => {} }] }} />);
    expect(barre().getAttribute('aria-valuenow')).toBe('67');
    const echec = document.querySelector('[data-progress-echec]')!;
    expect(echec.getAttribute('role')).toBe('alert');
    expect(echec.textContent).toContain('Échec à l’étape « Entraînement »');
    expect(echec.textContent).toContain('Progression avant interruption : 3/5 étapes');
    expect(echec.textContent).toContain('La vidéo source n’a pas permis');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(reessayer).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll('[data-progress-etape-etat]')].map((e) => e.getAttribute('data-progress-etape-etat'))[3]).toBe('echouee');
    expect(document.body.textContent).not.toContain('se met à jour automatiquement');
  });

  it('⚠️ succès : 100 %, « ✓ Terminé », la suite est proposée', () => {
    const voir = vi.fn();
    render(<ProgressStatus titre="Votre avatar est prêt" statut="succes" suite={[{ libelle: 'Voir mon avatar', onClick: voir, principale: true }, { libelle: 'Tester mon avatar', onClick: () => {} }]} />);
    expect(document.querySelector('[data-progress-pourcentage]')!.textContent).toBe('100 %');
    expect(barre().getAttribute('aria-valuenow')).toBe('100');
    expect(document.querySelector('[data-progress-titre]')!.textContent).toBe('✓ Votre avatar est prêt');
    fireEvent.click(screen.getByRole('button', { name: 'Voir mon avatar' }));
    expect(voir).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tester mon avatar' })).toBeTruthy();
  });

  it('compact (mobile) : pourcentage, titre, position — sans description, sans liste d’étapes, barre fine', () => {
    render(<ProgressStatus titre="Montage en cours" statut="en_cours" pourcentage={68} etapeCourante={4} totalEtapes={6} description="longue description" compact etapes={[{ libelle: 'a', etat: 'terminee' }, { libelle: 'b', etat: 'courante' }]} />);
    expect(document.querySelector('[data-progress-pourcentage]')!.textContent).toBe('68 %');
    expect(document.querySelector('[data-progress-etape]')!.textContent).toContain('Étape 2 sur 2');
    expect(document.querySelector('[data-progress-description]')).toBeNull();
    expect(document.querySelector('[data-progress-etapes]')).toBeNull();
    expect(barre().className).toContain('h-1');
  });
});
