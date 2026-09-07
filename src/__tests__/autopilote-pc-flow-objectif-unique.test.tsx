/**
 * PARCOURS PC — UN SEUL OBJECTIF, ET LE BOUTON EN DERNIER.
 *
 * ---------------------------------------------------------------------------
 * LES DEUX DEFAUTS MESURES EN DIRECT LE 2026-09-07
 * ---------------------------------------------------------------------------
 *
 *   1. L'ecran pouvait afficher DEUX objectifs contradictoires : le resume
 *      annoncait « Promouvoir un evenement » pendant que le wizard, juste
 *      dessous, montrait « Promouvoir un service ». Aucune facon de savoir
 *      lequel partirait au montage — c'etait l'evenement, puisque rien
 *      n'avait ete valide, mais rien ne le disait.
 *
 *   2. « Creer ma video » apparaissait AVANT l'objectif et le style : on
 *      pouvait lancer un montage sans avoir dit pourquoi la video existe.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT. Pas des libelles : un ORDRE et une UNICITE.
 * Un test qui se contente de chercher « Valider l'objectif » n'aurait rien vu
 * du premier defaut, puisque les deux valeurs coexistaient sans que le
 * libelle change.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MonObjectifPanel = (await import('@/components/creer/MonObjectifPanel')).default;
const { normaliserObjectif } = await import('@/lib/autopilot/analyse/objectif-communication');

const EVENEMENT = normaliserObjectif({ type: 'evenement' });
const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

function monter(props: Record<string, unknown> = {}) {
  const enregistrer = vi.fn(async (_o: unknown) => true);
  const pourLaVideo = vi.fn((_o: unknown) => {});
  const edition = vi.fn((_b: boolean) => {});
  const vue = render(
    <MonObjectifPanel
      objectifEnregistre={EVENEMENT}
      chargement={false}
      onEnregistrerDefaut={enregistrer}
      onAppliquerACetteVideo={pourLaVideo}
      onEditionChange={edition}
      objectifCetteVideo={null}
      {...props}
    />,
  );
  return { vue, enregistrer, pourLaVideo, edition };
}

const ouvrir = () => fireEvent.click(document.querySelector('[data-mon-objectif-toggle]')!);
const suivant = () => fireEvent.click(document.querySelector('[data-mon-objectif-suivant]')!);
const valider = () => fireEvent.click(document.querySelector('[data-mon-objectif-cette-video]')!);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Un seul objectif à l’écran, toujours', () => {
  it('1.1 fermé : une valeur, et une seule', () => {
    monter({ objectifCetteVideo: normaliserObjectif({ type: 'service' }) });
    expect(document.querySelector('[data-mon-objectif-video]')?.textContent)
      .toContain('Promouvoir un service');
  });

  it('1.2 OUVERT : la valeur disparaît — le wizard EST l’objectif', () => {
    // ⚠️ LE COEUR DU LOT. C'est cette coexistence qui a fait douter Bassi.
    monter({ objectifCetteVideo: normaliserObjectif({ type: 'service' }) });
    ouvrir();
    expect(document.querySelector('[data-mon-objectif-video]')).toBeNull();
    expect(document.querySelector('[data-mon-objectif-etat]')).toBeNull();
  });

  it('1.3 le résumé de l’objectif n’existe jamais en double', () => {
    // ⚠️ NE PAS CHERCHER LA CHAINE « Promouvoir un service » : le wizard la
    // liste comme CHOIX possible, c'est legitime. Ce qui ne doit jamais
    // exister en double, c'est l'element qui AFFIRME l'objectif retenu.
    monter({ objectifCetteVideo: normaliserObjectif({ type: 'service' }) });
    const resumes = () => document.querySelectorAll('[data-mon-objectif-video]').length;
    expect(resumes()).toBe(1);
    ouvrir();
    expect(resumes()).toBe(0);
    fireEvent.click(document.querySelector('[data-mon-objectif-type="temoignage"]')!);
    expect(resumes()).toBe(0);
  });

  it('1.4 refermer sans valider RÉTABLIT l’ancien objectif', () => {
    const { pourLaVideo } = monter({
      objectifCetteVideo: normaliserObjectif({ type: 'service' }),
    });
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="temoignage"]')!);
    fireEvent.click(document.querySelector('[data-mon-objectif-toggle]')!);
    expect(document.querySelector('[data-mon-objectif-video]')?.textContent)
      .toContain('Promouvoir un service');
    // Aucun changement silencieux.
    expect(pourLaVideo).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Valider l’objectif', () => {
  it('2.1 le libellé « Utiliser pour cette vidéo » a disparu du produit', () => {
    const src = lire('src/components/creer/MonObjectifPanel.tsx');
    expect(src).not.toContain('Utiliser pour cette vidéo');
    expect(src).toContain('Valider l’objectif');
  });

  it('2.2 valider applique la valeur, et le résumé suit immédiatement', () => {
    const { pourLaVideo } = monter();
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="service"]')!);
    suivant(); suivant();
    valider();
    expect(pourLaVideo).toHaveBeenCalledTimes(1);
    expect(pourLaVideo.mock.calls[0][0]).toMatchObject({ type: 'service' });
    // Le wizard se referme : la valeur redevient visible, une seule fois.
    expect(document.querySelector('[data-mon-objectif-wizard]')).toBeNull();
  });

  it('2.3 case décochée : le défaut du compte ne bouge pas', () => {
    const { enregistrer, pourLaVideo } = monter();
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="service"]')!);
    suivant(); suivant();
    expect((document.querySelector('[data-mon-objectif-aussi-defaut]') as HTMLInputElement).checked)
      .toBe(false);
    valider();
    expect(pourLaVideo).toHaveBeenCalledTimes(1);
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('2.4 case cochée : le défaut suit, explicitement', async () => {
    const { enregistrer } = monter();
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="service"]')!);
    suivant(); suivant();
    fireEvent.click(document.querySelector('[data-mon-objectif-aussi-defaut]')!);
    valider();
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(enregistrer.mock.calls[0][0]).toMatchObject({ type: 'service' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le verrou des modifications non validées', () => {
  it('3.1 ouvrir sans rien changer ne bloque RIEN', () => {
    // ⚠️ SINON LE BOUTON SE BLOQUERAIT A LA MOINDRE CURIOSITE. La comparaison
    // porte sur la forme canonique, pas sur l'identite des objets : chaque
    // touche renormalise et rend un objet neuf.
    const { edition } = monter();
    ouvrir();
    expect(edition.mock.calls.every(([b]) => b === false)).toBe(true);
  });

  it('3.2 changer sans valider signale une édition en cours', () => {
    const { edition } = monter();
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="service"]')!);
    expect(edition.mock.calls.at(-1)?.[0]).toBe(true);
    expect(document.querySelector('[data-mon-objectif-non-valide]')
      ?.getAttribute('data-mon-objectif-non-valide')).toBe('oui');
  });

  it('3.3 valider lève le verrou', () => {
    const { edition } = monter();
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="service"]')!);
    suivant(); suivant();
    valider();
    expect(edition.mock.calls.at(-1)?.[0]).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’ordre du parcours — le bouton est la conclusion', () => {
  const sessions = lire('src/components/creer/SessionsTournagePanel.tsx');
  const passages = lire('src/components/creer/PassagesSuggeres.tsx');

  it('4.1 rush, puis les décisions, puis format et durée', () => {
    const rushes = sessions.indexOf('══ RUSHES');
    const decisions = sessions.indexOf('{decisions}');
    const format = sessions.indexOf('══ FORMAT ET DUREE');
    expect(rushes).toBeGreaterThan(-1);
    expect(decisions).toBeGreaterThan(rushes);
    expect(format).toBeGreaterThan(decisions);
  });

  it('4.2 « Avancé » a quitté sa place et descend avant le bouton', () => {
    // Il n'est plus un bloc du panneau : il voyage dans le creneau.
    expect(sessions).toContain('avantAction={ligneAvance}');
    expect(sessions.indexOf('avantAction={ligneAvance}')).toBeGreaterThan(
      sessions.indexOf('══ FORMAT ET DUREE'));
  });

  it('4.3 dans l’écran des passages : audio, puis le créneau, puis le bouton', () => {
    const audio = passages.indexOf('<ReglagesAudio');
    // lastIndexOf : la premiere occurrence est le repli de chargement.
    const creneau = passages.lastIndexOf('{avantAction}');
    const bouton = passages.indexOf('data-chaine-bouton');
    expect(audio).toBeGreaterThan(-1);
    expect(creneau).toBeGreaterThan(audio);
    expect(bouton).toBeGreaterThan(creneau);
  });

  it('4.4 objectif et style vivent DANS le créneau, et nulle part ailleurs', () => {
    const panneau = lire('src/components/creer/AutopilotPanel.tsx');
    // Extraction du bloc `decisions={( ... )}` par equilibrage de parentheses :
    // un index compare a un autre prop ne prouve rien sur l'imbrication.
    const debut = panneau.indexOf('decisions={(');
    expect(debut).toBeGreaterThan(-1);
    let profondeur = 0, fin = -1;
    for (let i = panneau.indexOf('(', debut); i < panneau.length; i += 1) {
      if (panneau[i] === '(') profondeur += 1;
      else if (panneau[i] === ')') { profondeur -= 1; if (profondeur === 0) { fin = i; break; } }
    }
    expect(fin).toBeGreaterThan(debut);
    const creneau = panneau.slice(debut, fin);
    expect(creneau).toContain('<MonObjectifPanel');
    expect(creneau).toContain('<MonStylePanel');

    // Et ils ne sont rendus qu'une seule fois dans tout le fichier.
    const dehors = panneau.slice(0, debut) + panneau.slice(fin);
    expect(dehors).not.toContain('<MonObjectifPanel');
    expect(dehors).not.toContain('<MonStylePanel');
  });

  it('4.5 le bouton refuse de partir tant que l’objectif n’est pas validé', () => {
    expect(passages).toContain("disabled={chaine.sorte === 'encours' || actionBloquee === true}");
    expect(passages).toContain('Valide d’abord ton objectif.');
    // ⚠️ EXPLICITE, PAS D'APPLICATION CACHEE au moment du clic.
    expect(passages).not.toContain('appliquerAvantCreation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. « Avancé » ne disparaît pas en route', () => {
  const sessions = lire('src/components/creer/SessionsTournagePanel.tsx');

  it('5.1 la ligne descend près du bouton quand la chaîne est là', () => {
    expect(sessions).toContain('avantAction={ligneAvance}');
  });

  it('5.2 et reste atteignable quand aucun rush n’est vérifié', () => {
    // ⚠️ LA REGRESSION ATTRAPEE PAR LA SUITE : deplacer la ligne dans le
    // creneau la faisait disparaitre pendant toute l'analyse du rush, donc
    // « Avance » devenait inatteignable.
    expect(sessions).toContain('{!chaineVisible && ligneAvance}');
  });

  it('5.3 jamais les deux à la fois', () => {
    // Un seul rendu conditionnel, un seul passage au creneau : exclusifs.
    expect(sessions.match(/ligneAvance/g)?.length).toBe(3); // decl + creneau + repli
    expect(sessions.match(/data-validation-humaine/g)?.length).toBe(1);
    expect(sessions.match(/data-ouvrir-avance/g)?.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le créneau survit au chargement des passages', () => {
  it('6.1 « chargement » ne renvoie plus null quand un créneau est fourni', () => {
    // ⚠️ SINON « Avancé » CLIGNOTE : present, absent le temps du chargement,
    // puis present. Attrape par le test 6.1 du lot 1.
    expect(lire('src/components/creer/PassagesSuggeres.tsx'))
      .toContain('if (chargement) return avantAction ? <>{avantAction}</> : null;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le créneau est rendu exactement une fois, quel que soit l’état', () => {
  it('7.1 analyse non réussie : c’est AnalyseRush qui le rend', () => {
    const src = lire('src/components/creer/AnalyseRush.tsx');
    expect(src).toContain("{analyse?.etat !== 'reussie' && avantAction}");
    expect(src).toContain("{analyse.etat === 'reussie' && (");
  });

  it('7.2 le repli est à la racine, hors de toute garde d’analyse', () => {
    // ⚠️ IL A DEJA ETE PLACE AU MAUVAIS ENDROIT : dans le bloc `{analyse && (`,
    // donc invisible tant qu'aucune analyse n'existait. Le repli doit suivre
    // la fermeture de ce bloc, pas y vivre.
    const src = lire('src/components/creer/AnalyseRush.tsx');
    const repli = src.indexOf("{analyse?.etat !== 'reussie' && avantAction}");
    const finBloc = src.lastIndexOf('      )}', repli);
    const passages = src.indexOf('<PassagesSuggeres');
    expect(repli).toBeGreaterThan(passages);
    expect(finBloc).toBeGreaterThan(passages);
  });
});
