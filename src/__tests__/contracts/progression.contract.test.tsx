/**
 * CONTRAT C-PROGRESS — aucun faux pourcentage. Un pourcentage n'est affiché
 * que s'il est FOURNI (mesuré) ; sinon la barre est indéterminée. Aucune
 * progression n'est dérivée de l'horloge (courbe asymptotique, % fixe).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, screen } from '@testing-library/react';
import ProgressStatus, { pourcentageWorkflow, type EtapeProgression } from '@/components/ux/ProgressStatus';

afterEach(cleanup);
const barre = () => screen.getByRole('progressbar');
const sansCommentaires = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const lire = (p: string) => sansCommentaires(readFileSync(join(process.cwd(), p), 'utf8'));

describe('C-PROGRESS — composant partagé', () => {
  it('sans pourcentage fourni : aucun chiffre, pas d’aria-valuenow, barre indéterminée', () => {
    render(<ProgressStatus titre="Entraînement" statut="en_cours" />);
    expect(document.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
    expect(barre().getAttribute('data-progress-barre')).toBe('indeterminee');
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
  });

  it('pourcentage fourni : affiché tel quel, borné 0–100, jamais NaN', () => {
    render(<ProgressStatus titre="Rendu" statut="en_cours" pourcentage={37} />);
    expect(document.querySelector('[data-progress-pourcentage]')!.textContent).toBe('37 %');
    expect(barre().getAttribute('aria-valuenow')).toBe('37');
    cleanup();
    render(<ProgressStatus titre="Rendu" statut="en_cours" pourcentage={Number.NaN} />);
    expect(barre().getAttribute('aria-valuenow')).toBe('0');
  });

  it('workflow : compté sur les étapes RÉELLES, nommé à part, jamais présenté comme le % de l’opération', () => {
    const etapes: EtapeProgression[] = [
      { libelle: 'A', etat: 'terminee' }, { libelle: 'B', etat: 'courante' }, { libelle: 'C', etat: 'a_venir' }, { libelle: 'D', etat: 'a_venir' },
    ];
    expect(pourcentageWorkflow(etapes)).toBe(25);
    expect(pourcentageWorkflow([])).toBeNull();
    render(<ProgressStatus titre="Entraînement" statut="en_cours" etapes={etapes} />);
    expect(document.querySelector('[data-progress-workflow]')!.textContent).toContain('Progression du workflow');
    expect(document.querySelector('[data-progress-pourcentage]')).toBeNull();
    expect(barre().hasAttribute('aria-valuenow')).toBe(false);
  });
});

describe('C-PROGRESS — aucune progression dérivée du temps dans le code', () => {
  it('Mon avatar (page + panneau) : ni courbe exp, ni setProgress nourri par l’horloge', () => {
    for (const p of ['src/app/dashboard/avatar/page.tsx', 'src/components/avatar/AvatarVideoDid.tsx']) {
      const s = lire(p);
      expect(s, p).not.toMatch(/Math\.exp\s*\(/);
      expect(s, p).not.toMatch(/\d+\s*\*\s*\(\s*1\s*-\s*Math\./);
      expect(s, p).not.toMatch(/setProgress\([^)]*(elapsed|Date\.now|performance\.now|ecoule)/);
      expect(s, p).not.toMatch(/fakeProgress|progressionSimulee/);
    }
  });
  it('Créer (jumeau) : plus de 5 % fixe ; seul « Rendu » (frames mesurées) porte un pourcentage', () => {
    const s = lire('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(s).not.toMatch(/setRenderProgress\(5\)/);
    expect(s).toMatch(/jumeauPhase\.phase === 'rendu' \? \{ pourcentage: renderProgress \} : \{\}/);
  });
});
