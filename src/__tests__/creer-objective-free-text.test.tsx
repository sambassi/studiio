/**
 * CREER_PREMIUM_3C — L'OBJECTIF EN UNE PHRASE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CES BANCS TIENNENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. QUE LE PARCOURS A DISPARU de l'écran de création — but, priorités,
 *      confirmation, et le verrou qui empêchait de monter tant qu'il restait
 *      ouvert ;
 *   2. QUE LE MOTEUR NE PERD RIEN. Une phrase produit le MÊME
 *      `ObjectifCommunication` que le parcours produisait, et `politiqueDePlan`
 *      le lit sans savoir d'où il vient ;
 *   3. QUE RIEN N'EST INVENTÉ. Une phrase qui ne déclare aucune intention rend
 *      `generique` — le comportement d'un objectif vide, pas une intention
 *      devinée.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import ObjectifLibrePanel from '@/components/creer/ObjectifLibrePanel';
import {
  objectifDepuisTexte, lireObjectifLibre, texteDepuisObjectif,
  normaliserTexte, EXEMPLES_OBJECTIF,
} from '@/lib/autopilot/analyse/objectif-texte-libre';
import { estObjectifGenerique, normaliserObjectif }
  from '@/lib/autopilot/analyse/objectif-communication';
import { politiqueDePlan } from '@/lib/autopilot/analyse/objectif-score';

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA LECTURE D'UNE PHRASE
// ═══════════════════════════════════════════════════════════════════════════
describe('3C — une phrase devient une intention', () => {
  it('un événement est reconnu', () => {
    const o = lireObjectifLibre(
      'Donner envie de venir à mon événement Afroboost et montrer l’ambiance.',
    );
    expect(o.type).toBe('evenement');
  });

  it('une réservation est reconnue', () => {
    expect(lireObjectifLibre('Donner envie de réserver un essai cette semaine.').type)
      .toBe('reservations');
  });

  it('un témoignage est reconnu', () => {
    expect(lireObjectifLibre('Mettre en avant ce que cette cliente pense de mon service.').type)
      .toBe('temoignage');
  });

  it('une vente est reconnue', () => {
    expect(lireObjectifLibre('Donner envie d’acheter mon nouveau produit.').type)
      .toBeTruthy();
  });

  it('les accents et la ponctuation ne changent rien', () => {
    expect(normaliserTexte('Événement — L’AMBIANCE !')).toBe('evenement l ambiance');
    expect(lireObjectifLibre('EVENEMENT').type).toBe('evenement');
    expect(lireObjectifLibre('événement').type).toBe('evenement');
  });

  /**
   * ⚠️ AUCUNE INTENTION N'EST INVENTÉE. Deviner à partir de « une belle vidéo
   * de mon activité » ferait peser sur le montage un choix que personne n'a
   * fait — et `politiqueDePlan` retomberait alors sur un classement qui n'a
   * aucune raison d'être.
   */
  it('une phrase sans intention nette reste GÉNÉRIQUE', () => {
    for (const p of [
      'Une belle vidéo de mon activité.',
      'Quelque chose de sympa pour cette semaine.',
      '',
    ]) {
      expect(lireObjectifLibre(p).type, `« ${p} »`).toBe('generique');
    }
  });

  it('le résultat est DÉTERMINISTE — deux appels, même réponse', () => {
    /* Sans cela, l'identité du plan changerait d'une fois sur l'autre et le
       même montage serait recalculé puis refacturé. */
    const p = 'Réserver une place à mon événement et acheter mon offre.';
    expect(lireObjectifLibre(p)).toEqual(lireObjectifLibre(p));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE CONTRAT DU MOTEUR
// ═══════════════════════════════════════════════════════════════════════════
describe('3C — le moteur reçoit exactement ce qu il attendait', () => {
  it('la sortie EST un objectif normalisé', () => {
    const o = objectifDepuisTexte('Donner envie de réserver un essai.');
    /* Construire l'objet à la main produirait une forme que la relecture
       refuserait en silence : on passe par le normaliseur du contrat. */
    expect(o).toEqual(normaliserObjectif(o));
    expect(o.type).toBe('reservations');
  });

  it('LA PHRASE EST CONSERVÉE, pas remplacée par une étiquette', () => {
    const phrase = 'Montrer que mon cours est accessible aux débutants.';
    const o = objectifDepuisTexte(phrase);
    expect(o.objectifPrincipal).toBe(phrase);
    expect(texteDepuisObjectif(o)).toBe(phrase);
  });

  it('un objectif vide est GÉNÉRIQUE, comme un compte qui n a rien déclaré', () => {
    const o = objectifDepuisTexte('   ');
    expect(estObjectifGenerique(o)).toBe(true);
    expect(o.objectifPrincipal).toBeNull();
  });

  it('`politiqueDePlan` le lit sans savoir d où il vient', () => {
    /* ⚠️ LA PREUVE QUE LE MOTEUR EST INTACT : la même fonction, le même
       verdict, sur un objectif né d'une phrase. */
    const fenetres = [
      { rang: 1, scoreMontage: 90, signaux: null },
      { rang: 2, scoreMontage: 80, signaux: null },
    ];
    const p = politiqueDePlan(fenetres, objectifDepuisTexte('Événement'), 'm3g-v2');
    expect(p.algorithmePlan).toBeTruthy();
    expect(p.ordreRangs).toEqual([1, 2]);
  });

  it('un objectif générique fait retomber la politique sur m3g-v2', () => {
    const p = politiqueDePlan(
      [{ rang: 1, scoreMontage: 90, signaux: null }],
      objectifDepuisTexte(''), 'm3g-v2',
    );
    expect(p.algorithmePlan).toBe('m3g-v2');
    expect(p.objectiveAware).toBe(false);
  });

  it('aucun fournisseur n est appelé', () => {
    const src = readFileSyncLocal('src/lib/autopilot/analyse/objectif-texte-libre.ts');
    for (const interdit of ['fetch(', 'anthropic', 'openai', 'groq', 'await ']) {
      expect(src, `le classement ne doit pas contenir « ${interdit} »`)
        .not.toContain(interdit);
    }
  });
});

function readFileSyncLocal(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(`${process.cwd()}/${rel}`, 'utf8');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. L'ÉCRAN
// ═══════════════════════════════════════════════════════════════════════════
describe('3C — l écran ne demande plus qu une phrase', () => {
  const champ = () => document.querySelector('[data-objectif-champ]') as HTMLTextAreaElement;

  it('un champ de texte, et aucune étape', () => {
    render(<ObjectifLibrePanel />);
    expect(champ()).not.toBeNull();
    /* Le parcours en trois étapes n'a plus de place ici. */
    expect(document.querySelector('[data-mon-objectif-etape]')).toBeNull();
    expect(document.body.textContent).not.toContain('Priorités');
    expect(document.body.textContent).not.toContain('Confirmation');
  });

  it('il annonce qu il est FACULTATIF', () => {
    /* Sans cette phrase, un champ vide fait chercher une étape à finir. */
    render(<ObjectifLibrePanel />);
    expect(document.body.textContent).toContain('Facultatif');
  });

  it('six exemples, et ce sont des raccourcis', () => {
    render(<ObjectifLibrePanel />);
    expect(document.querySelectorAll('[data-objectif-exemple]')).toHaveLength(
      EXEMPLES_OBJECTIF.length,
    );
  });

  it('cliquer un exemple remplit une PHRASE modifiable', () => {
    const onAppliquer = vi.fn();
    render(<ObjectifLibrePanel onAppliquerACetteVideo={onAppliquer} />);
    act(() => {
      (document.querySelector('[data-objectif-exemple="Événement"]') as HTMLButtonElement)
        .click();
    });
    expect(champ().value).toContain('événement');
    expect(onAppliquer).toHaveBeenCalledTimes(1);
    expect(onAppliquer.mock.calls[0][0].type).toBe('evenement');
  });

  it('l objectif est appliqué au RELÂCHEMENT, pas à chaque frappe', () => {
    const onAppliquer = vi.fn();
    render(<ObjectifLibrePanel onAppliquerACetteVideo={onAppliquer} />);
    act(() => { fireEvent.change(champ(), { target: { value: 'Donner envie de réserver' } }); });
    /* Trente écritures de brouillon par phrase, sinon. */
    expect(onAppliquer).not.toHaveBeenCalled();
    act(() => { fireEvent.blur(champ()); });
    expect(onAppliquer).toHaveBeenCalledTimes(1);
    expect(onAppliquer.mock.calls[0][0].type).toBe('reservations');
  });

  it('vider le champ rend `null` — jamais un objectif inventé', () => {
    const onAppliquer = vi.fn();
    render(<ObjectifLibrePanel
      onAppliquerACetteVideo={onAppliquer}
      objectifCetteVideo={objectifDepuisTexte('Réserver')}
    />);
    act(() => { fireEvent.change(champ(), { target: { value: '  ' } }); });
    act(() => { fireEvent.blur(champ()); });
    expect(onAppliquer).toHaveBeenCalledWith(null);
  });

  it('un objectif déjà appliqué se réaffiche À L IDENTIQUE', () => {
    /* On rend la phrase de la personne, pas l'étiquette qu'on en a déduite. */
    const phrase = 'Donner envie de venir à mon événement et montrer l’ambiance.';
    render(<ObjectifLibrePanel objectifCetteVideo={objectifDepuisTexte(phrase)} />);
    expect(champ().value).toBe(phrase);
  });

  it('un rendu du parent n écrase pas la saisie en cours', () => {
    /* ⚠️ LE DÉFAUT QUI A COÛTÉ LA SÉLECTION DES RUSHES, dans sa version
       objectif : un effet qui réécrit l'état à chaque rendu du parent. */
    const { rerender } = render(<ObjectifLibrePanel objectifCetteVideo={null} />);
    act(() => { fireEvent.change(champ(), { target: { value: 'Ma phrase en cours' } }); });
    rerender(<ObjectifLibrePanel objectifCetteVideo={null} />);
    expect(champ().value).toBe('Ma phrase en cours');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE PARCOURS DE CRÉATION
// ═══════════════════════════════════════════════════════════════════════════
describe('3C — plus rien ne bloque « Créer ma vidéo »', () => {
  it('le verrou d édition a disparu du panneau', () => {
    /* Il existait parce qu'un parcours pouvait rester ouvert sans être validé.
       Un champ facultatif n'a pas cet état intermédiaire. */
    const src = readFileSyncLocal('src/components/creer/AutopilotPanel.tsx');
    expect(src).not.toContain('actionBloquee={objectifEnEdition}');
    expect(src).toContain('ObjectifLibrePanel');
    expect(src).not.toContain('MonObjectifPanel');
  });
});
