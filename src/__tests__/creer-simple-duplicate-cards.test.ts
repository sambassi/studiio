import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { duplicateCards, duplicateBoxes, maxCards } from '@/lib/creer/selection';
import type { CardBox } from '@/lib/creer/dragPosition';

/**
 * Duplication des cartes retenues — Mode simple.
 *
 * Deux dangers propres à cette opération :
 *
 * 1. **Dépasser ce que le compositeur sait dessiner.** `video-composer.ts`
 *    borne à 5 cartes en portrait, 6 sinon : au-delà, les cartes en trop
 *    disparaîtraient du montage de secours, et la colonne déborderait du
 *    conteneur photographié.
 * 2. **Poser la copie sur son original.** Superposées, on croit qu'il ne s'est
 *    rien passé, puis on déplace la mauvaise.
 */

const carte = (id: string) => ({ id, title: `Carte ${id}`, icon: 'Flame', value: '', description: '' });
const box = (x: number, y: number, w = 40, h = 10): CardBox => ({ x, y, w, h });

/** Générateur d'identifiants prévisible — les tests ne dépendent pas de l'heure. */
const ids = () => {
  let n = 0;
  return () => `copie-${++n}`;
};

describe('maxCards — la limite vient du compositeur, pas d une intuition', () => {
  it('portrait : 5', () => {
    expect(maxCards('9:16')).toBe(5);
  });

  it('paysage ET carré : 6', () => {
    // `isReel` se décide sur `hauteur > largeur` dans le compositeur : le carré
    // y compte comme un paysage. Mettre 5 pour le carré retirerait une carte
    // que la vidéo sait pourtant dessiner.
    expect(maxCards('16:9')).toBe(6);
    expect(maxCards('1:1')).toBe(6);
  });
});

describe('duplicateCards', () => {
  const trois = [carte('a'), carte('b'), carte('c')];

  it('insère la copie JUSTE APRÈS son original', () => {
    // À la fin, la copie s'éloignerait de ce qu'on vient de désigner et
    // changerait la lecture du montage.
    const r = duplicateCards(trois, new Set(['b']), ids(), 5);
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b', 'copie-1', 'c']);
  });

  it('copie tout le contenu, seul l identifiant change', () => {
    const r = duplicateCards(trois, new Set(['b']), ids(), 5);
    const copie = r.cards[2];
    expect(copie.title).toBe('Carte b');
    expect(copie.id).not.toBe('b');
  });

  it('duplique plusieurs cartes dans l ordre du TABLEAU', () => {
    const r = duplicateCards(trois, new Set(['c', 'a']), ids(), 6);
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'copie-1', 'b', 'c', 'copie-2']);
    expect(r.created).toEqual([
      { sourceId: 'a', id: 'copie-1' },
      { sourceId: 'c', id: 'copie-2' },
    ]);
  });

  it('s arrête à la limite et dit combien de copies sont refusées', () => {
    const quatre = [carte('a'), carte('b'), carte('c'), carte('d')];
    const r = duplicateCards(quatre, new Set(['a', 'b', 'c']), ids(), 5);
    expect(r.cards).toHaveLength(5);
    expect(r.created).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('à la limite, ne crée rien du tout', () => {
    const cinq = ['a', 'b', 'c', 'd', 'e'].map(carte);
    const r = duplicateCards(cinq, new Set(['a']), ids(), 5);
    expect(r.cards).toHaveLength(5);
    expect(r.created).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it('une sélection vide ne change rien', () => {
    const r = duplicateCards(trois, new Set(), ids(), 5);
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(r.created).toHaveLength(0);
    expect(r.dropped).toBe(0);
  });

  it('ignore une sélection qui désigne des cartes absentes', () => {
    const r = duplicateCards(trois, new Set(['fantome']), ids(), 5);
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(r.created).toHaveLength(0);
  });

  it('ne mute pas la liste d entrée', () => {
    const avant = trois.map((c) => c.id);
    duplicateCards(trois, new Set(['a']), ids(), 5);
    expect(trois.map((c) => c.id)).toEqual(avant);
  });

  it('chaque copie reçoit un identifiant DISTINCT', () => {
    const r = duplicateCards(trois, new Set(['a', 'b', 'c']), ids(), 6);
    const tous = r.cards.map((c) => c.id);
    expect(new Set(tous).size).toBe(tous.length);
  });
});

describe('duplicateBoxes — la copie ne se cache pas sous son original', () => {
  const boxes = { a: box(10, 10), b: box(50, 40) };

  it('décale la copie de son original', () => {
    const out = duplicateBoxes(boxes, [{ sourceId: 'a', id: 'copie-1' }], 3);
    expect(out['copie-1']).toEqual(box(13, 13));
  });

  it('garde la taille de la source — dupliquer ne redimensionne pas', () => {
    const out = duplicateBoxes({ a: box(10, 10, 33, 7) }, [{ sourceId: 'a', id: 'z' }]);
    expect(out.z.w).toBe(33);
    expect(out.z.h).toBe(7);
  });

  it('borne la copie au conteneur', () => {
    // Une source déjà au bord : la copie ne peut pas sortir du cadre.
    const out = duplicateBoxes({ a: box(60, 90) }, [{ sourceId: 'a', id: 'z' }], 3);
    expect(out.z.x).toBe(60);
    expect(out.z.y).toBe(90);
  });

  it('ne touche pas aux emplacements existants', () => {
    const out = duplicateBoxes(boxes, [{ sourceId: 'a', id: 'z' }]);
    expect(out.a).toBe(boxes.a);
    expect(out.b).toBe(boxes.b);
  });

  it('ignore une source sans emplacement', () => {
    const out = duplicateBoxes(boxes, [{ sourceId: 'fantome', id: 'z' }]);
    expect(out.z).toBeUndefined();
  });

  it('ne mute pas l entrée', () => {
    duplicateBoxes(boxes, [{ sourceId: 'a', id: 'z' }]);
    expect(Object.keys(boxes).sort()).toEqual(['a', 'b']);
  });
});

describe('Câblage', () => {
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
    'utf-8',
  );

  it('la limite dépend du FORMAT courant, pas d une constante figée', () => {
    expect(wizard).toContain('duplicateCards(generated.cards, selectedCards, newCardId, maxCards(format))');
    expect(wizard).toContain('const limiteCartes = maxCards(format);');
  });

  it('le bouton est désactivé quand la limite est atteinte, et dit pourquoi', () => {
    // Un bouton grisé sans explication est une impasse.
    expect(wizard).toContain('disabled={(generated?.cards.length ?? 0) >= limiteCartes}');
    expect(wizard).toContain('`Maximum de ${limiteCartes} cartes dans ce format`');
  });

  it('les copies deviennent la sélection', () => {
    // On vient de les créer : c'est sur elles qu'on va agir.
    expect(wizard).toContain('setSelectedCards(new Set(res.created.map((c) => c.id)));');
  });

  it('les emplacements suivent les copies en mode libre', () => {
    expect(wizard).toContain('duplicateBoxes(prev.boxes, res.created)');
    // La ref est mise à jour en même temps que l'état : elle seule est lue par
    // le gestionnaire de glissement, mémoïsé sans dépendances.
    expect(wizard).toContain('cardBoxesRef.current = next;');
  });

  it('utilise une icône lucide, pas un emoji', () => {
    expect(wizard).toContain('<Copy className="w-3.5 h-3.5" />');
  });

  it('un nouveau montage efface la notice', () => {
    // Fenetre large : `reset` s'allonge a chaque etat nouveau, et une borne
    // en dur finissait par tronquer la ligne cherchee.
    const debut = wizard.indexOf('const reset = ()');
    const reset = wizard.slice(debut, wizard.indexOf('\n  };', debut));
    expect(reset).toContain('setDuplicateNotice(null)');
  });
});
