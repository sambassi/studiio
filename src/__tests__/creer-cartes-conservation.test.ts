/**
 * LES CARTES NE PERDENT PLUS LEURS REGLAGES AVANCES.
 *
 * ── LE DEFAUT ────────────────────────────────────────────────────────────
 *
 * `creer-avance` persiste SEPT champs par carte (`page.tsx:5202-5210`) :
 * `emoji`, `label`, `value`, `description`, `color`, `position`, `textOnly`.
 *
 * L'Assistant n'en porte que CINQ a l'ecran (`GeneratedCard`), et
 * `construireValeurs` reconstruisait chaque carte DE ZERO a partir de ces
 * cinq-la, en repeignant `color` avec l'accent global. Le tableau partait
 * ensuite EN BLOC (`from-wizard.ts:189`), et `mergePostMetadata` remplace une
 * cle de premier niveau entiere.
 *
 * Resultat : `position` et `textOnly` disparaissaient de TOUTES les cartes, et
 * leurs couleurs propres etaient ecrasees — pour une seule carte modifiee, et
 * meme pour un simple changement de couleur d'accent. Colonne `jsonb` sans
 * historique : perte definitive et silencieuse.
 *
 * ── LA CORRECTION ────────────────────────────────────────────────────────
 *
 * On part de la carte D'ORIGINE et on n'applique que les champs que l'ecran
 * regle reellement. L'appariement se fait par `id` — jamais par index, qu'une
 * suppression ou un reordonnancement decalerait.
 */

import { describe, it, expect } from 'vitest';
import {
  indexerCartesOrigine,
  cartesPourEnregistrement,
  type CarteEcran,
} from '@/lib/creer/postMetadata/cartes';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '@/lib/creer/postMetadata/to-post';

/** Metadata `creer-avance` realiste : trois cartes, sept champs chacune. */
const META_AVANCE = Object.freeze({
  cards: [
    {
      emoji: 'Dumbbell', label: 'Carte A', value: '95%', description: 'Desc A',
      color: '#FF0000', position: { x: 20, y: 30 }, textOnly: false,
    },
    {
      emoji: 'Flame', label: 'Carte B', value: '80%', description: 'Desc B',
      color: '#00FF00', position: { x: 60, y: 30 }, textOnly: true,
      // Cle qu'aucun code ne declare : elle doit traverser.
      reglageInconnu: { profond: ['a', 1] },
    },
    {
      emoji: 'Heart', label: 'Carte C', value: '70%', description: 'Desc C',
      color: '#0000FF', position: { x: 40, y: 70 }, textOnly: false,
    },
  ],
});

/** Ce que l'ecran porte apres `to-wizard` + `sanitizeDraft`. */
const ECRAN: readonly CarteEcran[] = [
  { id: 'card-lu-0', icon: 'Dumbbell', title: 'Carte A', value: '95%', description: 'Desc A' },
  { id: 'card-lu-1', icon: 'Flame', title: 'Carte B', value: '80%', description: 'Desc B' },
  { id: 'card-lu-2', icon: 'Heart', title: 'Carte C', value: '70%', description: 'Desc C' },
];

/** L'accent du post `creer-avance` : aucune carte ne le suit. */
const ACCENT_CHARGE = '#a855f7';

function sortie(cartes: readonly CarteEcran[], accent = ACCENT_CHARGE) {
  return cartesPourEnregistrement(
    cartes, indexerCartesOrigine(META_AVANCE), accent, ACCENT_CHARGE,
  );
}

describe('cartes — contre-epreuve : l\'ancien comportement detruisait bien', () => {
  it('reconstruire a plat depuis les cinq champs de l\'ecran perd position et textOnly', () => {
    // Reproduction litterale de l'ancien `construireValeurs:6312-6315`.
    const ancien = ECRAN.map((c) => ({
      emoji: c.icon, label: c.title, value: c.value,
      description: c.description, color: ACCENT_CHARGE,
    })) as Record<string, unknown>[];

    for (const carte of ancien) {
      expect(Object.prototype.hasOwnProperty.call(carte, 'position')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(carte, 'textOnly')).toBe(false);
    }
    expect(ancien[0].color).toBe(ACCENT_CHARGE); // la couleur propre #FF0000 est perdue
  });
});

describe('cartes — une modification simple ne perd rien', () => {
  it('1. modifier UNIQUEMENT le texte', () => {
    const modifie = ECRAN.map((c) => (c.id === 'card-lu-1' ? { ...c, title: 'Carte B MODIFIEE' } : c));
    const r = sortie(modifie);
    expect(r[1].label).toBe('Carte B MODIFIEE');
    expect(r[1].position).toStrictEqual({ x: 60, y: 30 });
    expect(r[1].textOnly).toBe(true);
    expect(r[1].color).toBe('#00FF00');
  });

  it('2. modifier UNIQUEMENT la couleur d\'accent', () => {
    const r = sortie(ECRAN, '#00BFFF');
    // Aucune carte ne suivait l'accent : leurs couleurs propres survivent.
    expect(r.map((c) => c.color)).toEqual(['#FF0000', '#00FF00', '#0000FF']);
    expect(r.map((c) => c.position)).toStrictEqual([
      { x: 20, y: 30 }, { x: 60, y: 30 }, { x: 40, y: 70 },
    ]);
  });

  it('3. modifier UNIQUEMENT l\'icone', () => {
    const modifie = ECRAN.map((c) => (c.id === 'card-lu-0' ? { ...c, icon: 'Rocket' } : c));
    const r = sortie(modifie);
    expect(r[0].emoji).toBe('Rocket');
    expect(r[0].position).toStrictEqual({ x: 20, y: 30 });
    expect(r[0].textOnly).toBe(false);
    expect(r[0].color).toBe('#FF0000');
  });

  it('4. position, textOnly et couleurs survivent sur les TROIS cartes', () => {
    const modifie = ECRAN.map((c) => (c.id === 'card-lu-1' ? { ...c, title: 'X' } : c));
    const r = sortie(modifie);
    const source = META_AVANCE.cards;
    for (let i = 0; i < 3; i++) {
      expect(r[i].position).toStrictEqual(source[i].position);
      expect(r[i].textOnly).toBe(source[i].textOnly);
      expect(r[i].color).toBe(source[i].color);
    }
  });

  it('5. objets imbriques et cles inconnues traversent intacts', () => {
    const r = sortie(ECRAN);
    expect(r[1].reglageInconnu).toStrictEqual({ profond: ['a', 1] });
  });

  it('6. l\'ordre est conserve, et chaque carte garde SES reglages', () => {
    const r = sortie(ECRAN);
    expect(r.map((c) => c.label)).toEqual(['Carte A', 'Carte B', 'Carte C']);
    expect(r.map((c) => c.position)).toStrictEqual([
      { x: 20, y: 30 }, { x: 60, y: 30 }, { x: 40, y: 70 },
    ]);
  });

  it('7. sans aucune modification, la sortie est identique a la source', () => {
    expect(sortie(ECRAN)).toStrictEqual(META_AVANCE.cards);
  });

  it('9. modifier une carte n\'a AUCUN effet sur les autres', () => {
    const modifie = ECRAN.map((c) => (c.id === 'card-lu-0' ? { ...c, title: 'SEULE A CHANGE' } : c));
    const r = sortie(modifie);
    expect(r[1]).toStrictEqual(META_AVANCE.cards[1]);
    expect(r[2]).toStrictEqual(META_AVANCE.cards[2]);
  });
});

describe('cartes — appariement par id, jamais par index', () => {
  it('un reordonnancement fait suivre les reglages a LEUR carte', () => {
    const reordonne = [ECRAN[2], ECRAN[0], ECRAN[1]];
    const r = sortie(reordonne);
    expect(r.map((c) => c.label)).toEqual(['Carte C', 'Carte A', 'Carte B']);
    expect(r.map((c) => c.position)).toStrictEqual([
      { x: 40, y: 70 }, { x: 20, y: 30 }, { x: 60, y: 30 },
    ]);
    expect(r.map((c) => c.color)).toEqual(['#0000FF', '#FF0000', '#00FF00']);
  });

  it('une suppression laisse les restantes intactes', () => {
    const r = sortie([ECRAN[0], ECRAN[2]]);
    expect(r).toHaveLength(2);
    expect(r[0]).toStrictEqual(META_AVANCE.cards[0]);
    expect(r[1]).toStrictEqual(META_AVANCE.cards[2]);
  });

  it('une carte NEUVE garde le comportement d\'aujourd\'hui : cinq champs, couleur d\'accent', () => {
    const neuve: CarteEcran = {
      id: 'card-zx9-4', icon: 'Star', title: 'Neuve', value: '10', description: 'D',
    };
    const r = sortie([neuve, ...ECRAN]);
    expect(r[0]).toStrictEqual({
      emoji: 'Star', label: 'Neuve', value: '10', description: 'D', color: ACCENT_CHARGE,
    });
    // Et les cartes relues ne sont pas contaminees.
    expect(r[1]).toStrictEqual(META_AVANCE.cards[0]);
  });
});

describe('cartes — la couleur suit l\'accent quand elle le suivait deja', () => {
  const META_ASSISTANT = Object.freeze({
    cards: [
      { emoji: 'Star', label: 'A', value: '1', description: 'a', color: '#7C3AED' },
      { emoji: 'Zap', label: 'B', value: '2', description: 'b' }, // aucune couleur
    ],
  });
  const ECRAN_ASSISTANT: readonly CarteEcran[] = [
    { id: 'card-lu-0', icon: 'Star', title: 'A', value: '1', description: 'a' },
    { id: 'card-lu-1', icon: 'Zap', title: 'B', value: '2', description: 'b' },
  ];

  it('un post cree par l\'Assistant continue de suivre le selecteur d\'accent', () => {
    const r = cartesPourEnregistrement(
      ECRAN_ASSISTANT, indexerCartesOrigine(META_ASSISTANT), '#00BFFF', '#7C3AED',
    );
    expect(r.map((c) => c.color)).toEqual(['#00BFFF', '#00BFFF']);
  });

  it('une carte a couleur PROPRE ne suit jamais l\'accent', () => {
    const r = sortie(ECRAN, '#00BFFF');
    expect(r.map((c) => c.color)).toEqual(['#FF0000', '#00FF00', '#0000FF']);
  });
});

describe('cartes — purete', () => {
  it('la metadata source n\'est jamais mutee', () => {
    const empreinte = JSON.stringify(META_AVANCE);
    sortie(ECRAN.map((c) => ({ ...c, title: 'X' })), '#123456');
    expect(JSON.stringify(META_AVANCE)).toBe(empreinte);
  });

  it('une metadata sans cartes donne un index vide, et la sortie reste celle d\'aujourd\'hui', () => {
    const r = cartesPourEnregistrement(ECRAN, indexerCartesOrigine({}), '#111111', '#111111');
    expect(r).toStrictEqual(ECRAN.map((c) => ({
      emoji: c.icon, label: c.title, value: c.value, description: c.description, color: '#111111',
    })));
  });

  it('une metadata hostile ne fait pas exception', () => {
    for (const hostile of [null, undefined, 42, 'x', [], { cards: 'x' }, { cards: [null, 7] }]) {
      expect(() => cartesPourEnregistrement(ECRAN, indexerCartesOrigine(hostile), '#1', '#1')).not.toThrow();
    }
  });
});

/**
 * Le parcours reel : `to-wizard` -> ecran -> `from-wizard` -> fusion serveur.
 *
 * C'est ici que se verifie le test-temoin du lot : un enregistrement qui ne
 * touche a rien ne doit PAS envoyer `cards`. L'absence de la cle est une
 * garantie plus forte qu'une egalite : elle prouve qu'on ne reecrit rien.
 */
describe('cartes — bout en bout, jusqu\'a la fusion serveur', () => {
  const POST = { metadata: { ...META_AVANCE, branding: { accentColor: ACCENT_CHARGE } } };

  function valeurs(cartes: readonly CarteEcran[], accent = ACCENT_CHARGE) {
    return {
      cards: cartesPourEnregistrement(
        cartes, indexerCartesOrigine(POST.metadata), accent, ACCENT_CHARGE,
      ),
      accentColor: accent,
    };
  }

  it('10. enregistrer sans rien toucher : `cards` n\'est PAS envoye', () => {
    const base = valeurs(ECRAN);
    const envoi = metadataPourEnregistrement(POST.metadata, base, base);
    expect(envoi).not.toHaveProperty('cards');
    expect(envoi).toEqual({});
  });

  it('11. modifier une carte puis relire : les reglages avances sont la', () => {
    const base = valeurs(ECRAN);
    const modifie = valeurs(ECRAN.map((c) => (c.id === 'card-lu-2' ? { ...c, title: 'C!' } : c)));
    const apres = mergePostMetadata(
      POST.metadata, metadataPourEnregistrement(POST.metadata, modifie, base),
    ) as { cards: Record<string, unknown>[] };

    expect(apres.cards[2].label).toBe('C!');
    for (let i = 0; i < 3; i++) {
      expect(apres.cards[i].position).toStrictEqual(META_AVANCE.cards[i].position);
      expect(apres.cards[i].textOnly).toBe(META_AVANCE.cards[i].textOnly);
      expect(apres.cards[i].color).toBe(META_AVANCE.cards[i].color);
    }
    expect(apres.cards[1].reglageInconnu).toStrictEqual({ profond: ['a', 1] });
  });

  it('12. changer la couleur d\'accent SEULE n\'efface plus rien', () => {
    const base = valeurs(ECRAN);
    const modifie = valeurs(ECRAN, '#00BFFF');
    const apres = mergePostMetadata(
      POST.metadata, metadataPourEnregistrement(POST.metadata, modifie, base),
    ) as { cards: Record<string, unknown>[] };
    // Le declencheur reel du defaut : l'accent ne parle pas des cartes.
    expect(apres.cards).toStrictEqual(META_AVANCE.cards);
  });
});
