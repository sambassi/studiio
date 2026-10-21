import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';
import PlanAvantGeneration from '@/components/creer/PlanAvantGeneration';
import { BriefRecurrentRecap } from '@/components/creer/BriefVideo';
import { etapesMontageApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';

/**
 * Autopilote ÉPURÉ (docs/UX-PREMIUM.md) — les longues explications passent
 * derrière une icône Info ; l'information existe toujours et se lit après
 * ouverture. Restent visibles : coût, problèmes, lecture, durée, chronologie.
 */
afterEach(cleanup);

const ouvrir = (marqueur: string) => {
  const bulle = document.querySelector(`[data-infobulle="${marqueur}"]`) as HTMLElement;
  expect(bulle, marqueur).toBeTruthy();
  const panneau = bulle.querySelector('[data-infobulle-panneau]') as HTMLElement;
  expect(panneau.hidden).toBe(true);
  fireEvent.click(bulle.querySelector('[data-infobulle-bouton]')!);
  expect(panneau.hidden).toBe(false);
  return panneau;
};

describe('« Ce que dira chaque vidéo » — synthétique', () => {
  const brief = { sujet: '', objectif: 'motiver', message: 'Chaque petit pas compte', public: 'Personnes qui veulent se lancer', cta: 'Commence aujourd’hui', duree: 30, rythme: 'dynamique' } as never;

  it('grille libellé / valeur, coût visible en une ligne, note et score admin à la demande', () => {
    render(<BriefRecurrentRecap brief={brief} sujets={['motivation']} admin />);
    const recap = document.querySelector('[data-autopilot-brief-recap]') as HTMLElement;
    // Champs à vérifier : présents, en <dl>.
    const dl = recap.querySelector('dl')!;
    expect(dl).toBeTruthy();
    expect(dl.textContent).toContain('Chaque petit pas compte');
    expect(recap.querySelector('[data-autopilot-brief-recap-duree]')!.textContent).toContain('30 s');
    // Le COÛT reste visible, hors infobulle.
    const cout = recap.querySelector('[data-autopilot-brief-recap-cout]') as HTMLElement;
    expect(cout.textContent).toBe('Aucun coût à cette étape');
    expect(cout.closest('[data-infobulle]')).toBeNull();
    // Note longue et score admin : dans l'infobulle, lisibles après ouverture.
    const note = recap.querySelector('[data-autopilot-brief-recap-note]') as HTMLElement;
    expect(note.closest('[data-infobulle="brief-recap"]')).toBeTruthy();
    const panneau = ouvrir('brief-recap');
    expect(panneau.textContent).toContain('rien n’est généré ni facturé ici');
    expect(panneau.querySelector('[data-autopilot-brief-recap-score]')).toBeTruthy();
  });

  it('un PROBLÈME de cohérence reste affiché en clair, jamais dans l’infobulle', () => {
    render(<BriefRecurrentRecap brief={{ objectif: 'remplir ma salle de sport' } as never} sujets={['finance']} />);
    const alerte = document.querySelector('[data-autopilot-brief-recap-incoherent]') as HTMLElement;
    expect(alerte).toBeTruthy();
    expect(alerte.closest('[data-infobulle]')).toBeNull();
  });
});

describe('« Aperçu de mon montage » — lecture, durée, chronologie visibles ; explication à la demande', () => {
  const resume: ResumeMediasApercu = {
    gabarit: [{ id: 'b', type: 'rush' }],
    actives: { rushes: true, avatar: false, stock: false },
    rushesPerso: ['https://studiio.pro/storage/v1/object/public/media/u1/plage.mp4'],
    stock: [],
    avatar: { disponible: false, vignette: null },
  } as ResumeMediasApercu;

  it('sousTitreEnInfo : pas de ligne grise, une icône Info près du titre', () => {
    const r = etapesMontageApercuAutopilote(resume, { dureeCta: 4 });
    render(
      <ApercuMontageListe etapes={r.etapes} lignes={r.lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens"
        titre="Aperçu de mon montage" sousTitre="Vos médias réels, dans l'ordre du plan, puis le CTA. Durées indicatives." sousTitreEnInfo />,
    );
    expect(document.querySelector('[data-apercu-montage-lecture]')).toBeTruthy();
    expect(document.querySelector('[data-apercu-montage-revoir]')).toBeTruthy();
    expect(document.querySelector('[data-apercu-montage-temps]')).toBeTruthy();
    expect(screen.getByLabelText('Chronologie du montage')).toBeTruthy();
    const sous = document.querySelector('[data-apercu-montage-sous-titre]') as HTMLElement;
    expect(sous.tagName).not.toBe('P');
    const panneau = ouvrir('apercu-montage');
    expect(panneau.textContent).toContain('Durées indicatives');
  });

  it('par défaut (Créer) : la ligne de sous-titre reste visible, aucune icône', () => {
    const r = etapesMontageApercuAutopilote(resume, { dureeCta: 4 });
    render(<ApercuMontageListe etapes={r.etapes} lignes={r.lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" />);
    expect((document.querySelector('[data-apercu-montage-sous-titre]') as HTMLElement).tagName).toBe('P');
    expect(document.querySelector('[data-infobulle]')).toBeNull();
  });
});

describe('« Plan avant génération » — fonctionnement à la demande', () => {
  it('annonce du CTA et avertissement de durée derrière l’icône Info du titre', () => {
    const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/plage.mp4';
    render(
      <PlanAvantGeneration
        gabarit={[{ id: 'b', type: 'rush' }]} suggestion={[]} rushesPerso={[RUSH]} stock={[]}
        vignetteAvatar={null} avatarDisponible={false}
        onChange={() => {}} onRechercher={() => {}}
        duree={{ cible: 30, rythme: null }}
      />,
    );
    // Les chiffres restent visibles.
    expect(document.querySelector('[data-plan-duree-cible]')!.textContent).toBe('30 s');
    const panneau = ouvrir('plan');
    expect(panneau.querySelector('[data-plan-cta-annonce]')!.textContent).toContain('médias réels');
    expect(panneau.querySelector('[data-plan-duree-avertissement]')).toBeTruthy();
  });
});
