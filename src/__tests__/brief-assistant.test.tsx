/**
 * Assistant de brief — le thème guide le brief, aide à le remplir sans
 * jamais écraser en silence, signale les contradictions, et ne laisse pas le
 * brief dicter seul les médias.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  analyserCoherenceBrief, placeholdersBrief, profilBrief, remplirBrief, suggestionChamp, suggestionsRapides,
  domainesDuSujet,
} from '@/lib/creer/brief-assistant';
import { BRIEF_PLACEHOLDERS, briefPourPrompt, longueurScriptCible, sanitizeBrief, type VideoBrief } from '@/lib/creer/brief';
import { construireRecherchesStock } from '@/lib/stock/requetes';
import { plansAutopilote } from '@/lib/stock/couverture';
import { scriptJumeauMontage } from '@/lib/autopilot/jumeau-async';
import BriefVideo, { BriefRecurrentRecap } from '@/components/creer/BriefVideo';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

const SPORT = /gym|workout|fitness|fitness class|strength/;

describe('A/B — les suggestions suivent le thème', () => {
  it('A. Finance → exemples et suggestions Finance', () => {
    expect(placeholdersBrief(['finance']).objectif).toBe('Ex. : apprendre à mieux gérer son budget');
    expect(suggestionsRapides(['finance'], 'objectif')).toContain('Éduquer sur l’épargne');
    expect(suggestionsRapides(['finance'], 'public')).toEqual(['Jeunes adultes', 'Débutants en finance', 'Entrepreneurs', 'Parents', 'Grand public']);
    expect(suggestionsRapides(['finance'], 'cta')).toContain('Apprends à mieux gérer ton argent');
  });

  it('B. Danse → suggestions Danse, différentes de Finance', () => {
    const danse = suggestionsRapides(['danse'], 'objectif');
    expect(danse).toContain('Donner envie de venir danser');
    expect(danse).not.toEqual(suggestionsRapides(['finance'], 'objectif'));
    expect(placeholdersBrief(['danse']).cta).toMatch(/cours d’essai/);
  });

  it('aucun thème → les exemples d’avant, aucun assistant', () => {
    expect(placeholdersBrief([])).toBe(BRIEF_PLACEHOLDERS);
    expect(profilBrief([])).toBeNull();
    expect(suggestionChamp([], 'objectif', '')).toBeNull();
  });
});

describe('C/D — contradictions', () => {
  it('C. Finance + « remplir ma salle de sport » → contradiction, score bas', () => {
    const c = analyserCoherenceBrief(['finance'], { objectif: 'remplir ma salle de sport' });
    expect(c.niveau).toBe('a-verifier');
    expect(c.conflits).toHaveLength(1);
    expect(c.conflits[0].message).toBe('Votre objectif semble parler de sport alors que le thème sélectionné est Finance.');
    expect(c.score).toBe(0);
  });

  it('brief Finance cohérent → « bonne », score élevé', () => {
    const c = analyserCoherenceBrief(['finance'], {
      objectif: 'Aider les débutants à mieux gérer leur argent',
      message: 'La gestion de l’argent s’apprend',
      public: 'Jeunes adultes',
      cta: 'Commence maintenant',
    });
    expect(c.niveau).toBe('bonne');
    expect(c.conflits).toEqual([]);
    expect(c.score!).toBeGreaterThanOrEqual(80);
  });

  it('domaines voisins et motivation ne sont pas des contradictions', () => {
    expect(analyserCoherenceBrief(['danse'], { objectif: 'remplir ma salle de sport' }).conflits).toEqual([]);
    expect(analyserCoherenceBrief(['motivation'], { objectif: 'remplir ma salle de sport' }).conflits).toEqual([]);
    expect(analyserCoherenceBrief(['finance'], { objectif: 'Rester motivé pour épargner' }).conflits).toEqual([]);
  });

  it('D. « Adapter » propose un objectif Finance pertinent, différent du texte', () => {
    const s = suggestionChamp(['finance'], 'objectif', 'remplir ma salle de sport', 0)!;
    expect(s).toBeTruthy();
    expect(analyserCoherenceBrief(['finance'], { objectif: s }).conflits).toEqual([]);
  });
});

describe('E/F — jamais d’écrasement, jamais la même suggestion', () => {
  it('E. « M’aider à remplir » ne remplit que les champs vides', () => {
    const { brief, remplis } = remplirBrief(['finance'], { objectif: 'Mon objectif à moi' });
    expect(brief.objectif).toBe('Mon objectif à moi');
    expect(remplis).toEqual(['message', 'public', 'cta']);
    expect(brief.public).toBe('Jeunes adultes');
    const plein = { objectif: 'a', message: 'b', public: 'c', cta: 'd' };
    expect(remplirBrief(['finance'], plein)).toEqual({ brief: plein, remplis: [] });
  });

  it('F. « Suggérer » ne rend jamais exactement le texte présent', () => {
    for (const cle of ['objectif', 'message', 'public', 'cta'] as const) {
      for (const actuel of suggestionsRapides(['finance'], cle, 99)) {
        for (let rang = 0; rang < 6; rang += 1) {
          expect(suggestionChamp(['finance'], cle, actuel, rang)).not.toBe(actuel);
        }
      }
    }
    // Insensible à la casse et aux espaces.
    expect(suggestionChamp(['finance'], 'public', '  jeunes ADULTES ', 0)).not.toBe('Jeunes adultes');
  });
});

describe('G — thème personnalisé', () => {
  it('« récupération après le sport » → suggestions qui reprennent ce thème', () => {
    const p = profilBrief(['récupération après le sport'])!;
    expect(p.placeholders.objectif).toContain('récupération après le sport');
    expect(p.suggestions.objectif[0]).toContain('récupération après le sport');
    expect(domainesDuSujet('récupération après le sport')).toEqual(['sommeil', 'sport']);
    expect(analyserCoherenceBrief(['récupération après le sport'], { objectif: 'Mieux récupérer après la séance de sport' }).conflits).toEqual([]);
    expect(analyserCoherenceBrief(['récupération après le sport'], { objectif: 'Épargner pour sa retraite' }).conflits).toHaveLength(1);
  });

  it('thème personnalisé → recherche média adaptée (mots du thème)', () => {
    expect(construireRecherchesStock({ sujet: 'récupération après le sport' }).requetes.join(' | ')).toMatch(/rest recovery/);
  });
});

describe('H — le sujet passe avant le brief pour les médias', () => {
  it('Finance + objectif « remplir ma salle de sport » → médias Finance, jamais salle de sport', () => {
    const r = construireRecherchesStock({ sujet: 'Finance', objectif: 'remplir ma salle de sport' });
    expect(r.requetes[0]).toMatch(/personal finance/);
    expect(r.requetes.join(' | ')).not.toMatch(SPORT);
  });

  it('brief Finance cohérent → médias Finance', () => {
    const r = construireRecherchesStock({ sujet: 'Finance', objectif: 'Aider les débutants à mieux gérer leur argent', role: 'titre' });
    expect(r.requetes.join(' | ')).toMatch(/personal finance/);
    expect(r.requetes.join(' | ')).not.toMatch(SPORT);
  });

  it('plans Autopilote : un message de brief hors thème ne nourrit aucun plan', () => {
    const plans = plansAutopilote('Finance', 'remplir ma salle de sport');
    expect(plans.map((p) => p.texte).join(' ')).not.toMatch(/salle|sport/);
    expect(plansAutopilote('Danse', 'danser en groupe')[1].texte).toContain('danser en groupe');
  });

  it('sans activité au sujet, le brief reste la piste (comportement d’avant)', () => {
    expect(construireRecherchesStock({ sujet: 'Afroboost Neuchâtel', objectif: 'cours de danse' }).requetes[0]).toMatch(/dance/);
  });

  it('le texte de la séquence (script) garde la main', () => {
    expect(construireRecherchesStock({ texte: 'Votre budget du mois', sujet: 'Motivation', objectif: 'salle de sport' }).requetes[0]).toMatch(/personal finance/);
  });
});

describe('Durée et rythme dans le brief', () => {
  it('relus, bornés, rétro-compatibles', () => {
    expect(sanitizeBrief({ duree: 30, rythme: 'dynamique' })).toEqual({ duree: 30, rythme: 'dynamique' });
    expect(sanitizeBrief({ duree: 500, rythme: 'turbo' })).toEqual({});
    expect(sanitizeBrief({})).toEqual({});
    expect(briefPourPrompt({})).toBe('');
  });

  it('pilotent la longueur du script et le prompt', () => {
    expect(longueurScriptCible({ duree: 30 })).toBe(420);
    expect(longueurScriptCible({ duree: 30, rythme: 'dynamique' })).toBe(480);
    expect(longueurScriptCible({})).toBeNull();
    expect(briefPourPrompt({ duree: 15, rythme: 'calme' })).toMatch(/Durée cible de la vidéo : 15 secondes[\s\S]*Rythme : calme/);
  });

  it('le script de l’avatar est composé pour la durée cible, sans couper une phrase', () => {
    const post = {
      title: 'Finance',
      content: { subtitle: 'Trois réflexes pour reprendre la main sur votre budget chaque mois', tagLine: 'Commencez dès aujourd’hui avec une seule action concrète', cards: [] },
      brief: { message: 'Gérer son argent est une compétence qui s’apprend', duree: 5, rythme: 'normal' as const },
    } as unknown as Parameters<typeof scriptJumeauMontage>[0];
    const court = scriptJumeauMontage(post);
    // 5 s ≈ 70 caractères : titre et appel à l'action (obligatoires), entiers ; le reste ne tient pas.
    expect(court).toBe('Finance. Commencez dès aujourd’hui avec une seule action concrète');
    const sansDuree = scriptJumeauMontage({ ...post, brief: { message: post.brief!.message } });
    expect(sansDuree).toContain('Gérer son argent');
  });
});

function Hote({ initial, sujets, onCommit }: { initial: VideoBrief; sujets: string[]; onCommit?: (b: VideoBrief) => void }) {
  const [brief, setBrief] = useState<VideoBrief>(initial);
  return (
    <>
      <BriefVideo brief={brief} onChange={setBrief} onCommit={onCommit} sujets={sujets} avecDureeRythme onChangerTheme={() => {}} idPrefix="t" />
      <BriefRecurrentRecap brief={brief} sujets={sujets} admin />
    </>
  );
}

describe('UI — Brief récurrent', () => {
  it('A. Finance : exemples et suggestions rapides Finance', () => {
    render(<Hote initial={{}} sujets={['finance']} />);
    expect((screen.getByLabelText(/Objectif de la vidéo/) as HTMLTextAreaElement).placeholder).toBe('Ex. : apprendre à mieux gérer son budget');
    expect(within(document.querySelector('[data-brief-rapides="objectif"]') as HTMLElement).getByText('Éduquer sur l’épargne')).toBeTruthy();
  });

  it('C/D. contradiction affichée, « Adapter » la résout, « Continuer quand même » la masque', () => {
    const commit = vi.fn();
    render(<Hote initial={{ objectif: 'remplir ma salle de sport' }} sujets={['finance']} onCommit={commit} />);
    const alerte = document.querySelector('[data-brief-conflit="objectif"]') as HTMLElement;
    expect(alerte.textContent).toContain('Votre objectif semble parler de sport alors que le thème sélectionné est Finance.');
    expect(within(alerte).getByText('Adapter l’objectif au thème Finance')).toBeTruthy();
    expect(within(alerte).getByText('Changer le thème')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-brief-recap-incoherent]')!.textContent)
      .toContain('Une incohérence a été détectée entre le sujet Finance et l’objectif « remplir ma salle de sport ».');
    expect(document.querySelector('[data-autopilot-brief-recap-score]')!.textContent).toContain('0/100');

    fireEvent.click(within(alerte).getByText('Adapter l’objectif au thème Finance'));
    expect(document.querySelector('[data-brief-conflit]')).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Objectif de la vidéo/) as HTMLTextAreaElement).value).not.toBe('remplir ma salle de sport');
    expect(document.querySelector('[data-autopilot-brief-recap-coherent]')!.textContent).toContain('Brief cohérent avec le thème Finance');
    // Le texte remplacé se rétablit en un clic.
    fireEvent.click(document.querySelector('[data-brief-retablir="objectif"]')!);
    expect((screen.getByLabelText(/Objectif de la vidéo/) as HTMLTextAreaElement).value).toBe('remplir ma salle de sport');
    fireEvent.click(document.querySelector('[data-brief-continuer="objectif"]')!);
    expect(document.querySelector('[data-brief-conflit]')).toBeNull();
  });

  it('E. « M’aider à remplir » ne touche pas aux textes saisis', () => {
    render(<Hote initial={{ objectif: 'Mon objectif à moi' }} sujets={['finance']} />);
    fireEvent.click(screen.getByText('M’aider à remplir'));
    expect((screen.getByLabelText(/Objectif de la vidéo/) as HTMLTextAreaElement).value).toBe('Mon objectif à moi');
    expect((screen.getByLabelText(/Public visé/) as HTMLTextAreaElement).value).toBe('Jeunes adultes');
    expect(document.querySelector('[data-brief-annonce]')!.textContent).toContain('n’ont pas été touchés');
  });

  it('F. « Suggérer » change le texte à chaque clic', () => {
    render(<Hote initial={{}} sujets={['finance']} />);
    const champ = screen.getByLabelText(/Message à transmettre/) as HTMLTextAreaElement;
    const vus = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const avant = champ.value;
      fireEvent.click(document.querySelector('[data-brief-suggerer="message"]')!);
      expect(champ.value).not.toBe(avant);
      vus.add(champ.value);
    }
    expect(vus.size).toBe(3);
  });

  it('durée et rythme : enregistrés et repris dans le résumé', () => {
    const commit = vi.fn();
    render(<Hote initial={{}} sujets={['finance']} onCommit={commit} />);
    fireEvent.click(document.querySelector('[data-brief-duree="30"]')!);
    fireEvent.click(document.querySelector('[data-brief-rythme="dynamique"]')!);
    expect(commit).toHaveBeenLastCalledWith({ duree: 30, rythme: 'dynamique' });
    expect(document.querySelector('[data-autopilot-brief-recap-duree]')!.textContent).toContain('30 s');
    expect(document.querySelector('[data-autopilot-brief-recap-rythme]')!.textContent).toContain('Dynamique');
    expect(document.querySelector('[data-autopilot-brief-recap-sujet]')!.textContent).toContain('Finance');
  });

  it('sans thème : le bloc d’avant, sans assistant', () => {
    render(<BriefVideo brief={{}} onChange={() => {}} />);
    expect(screen.queryByText('M’aider à remplir')).toBeNull();
    expect(document.querySelector('[data-brief-suggerer]')).toBeNull();
    expect(document.querySelector('[data-brief-duree-rythme]')).toBeNull();
    expect((screen.getByLabelText(/Objectif de la vidéo/) as HTMLTextAreaElement).placeholder).toBe(BRIEF_PLACEHOLDERS.objectif);
  });
});
