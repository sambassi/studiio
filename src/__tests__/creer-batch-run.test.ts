/**
 * Suivi du lot : identifiants stables, etats par contenu, echec partiel,
 * et la garde qui interdit la reprise tant que les credits ne sont pas
 * idempotents.
 */
import { describe, it, expect } from 'vitest';
import {
  batchRunId,
  batchItemId,
  initialBatchItems,
  setItemState,
  failedItems,
  succeededItems,
  batchSummary,
  batchPartiel,
  repriseAutorisee,
  REPRISE_INDISPONIBLE,
  type BatchItem,
} from '@/lib/creer/batchRun';

describe('batchRunId', () => {
  it('rend le meme identifiant pour la meme graine', () => {
    expect(batchRunId(1234567)).toBe(batchRunId(1234567));
  });

  it('distingue deux lots lances a des instants differents', () => {
    expect(batchRunId(1000)).not.toBe(batchRunId(1001));
  });

  it('ne casse pas sur une graine absurde', () => {
    expect(typeof batchRunId(NaN)).toBe('string');
    expect(batchRunId(NaN).startsWith('lot-')).toBe(true);
  });
});

describe('batchItemId — identifiant STABLE par contenu', () => {
  it('depend du rang, pas de l ordre d appel', () => {
    const run = batchRunId(42);
    expect(batchItemId(run, 2)).toBe(batchItemId(run, 2));
  });

  it('numerote a partir de 1, lisible par un humain', () => {
    expect(batchItemId('lot-x', 0)).toBe('lot-x-1');
    expect(batchItemId('lot-x', 4)).toBe('lot-x-5');
  });

  it('ne collisionne pas entre deux lots', () => {
    expect(batchItemId('lot-a', 0)).not.toBe(batchItemId('lot-b', 0));
  });

  it('donne des identifiants tous distincts dans un lot', () => {
    const ids = initialBatchItems('lot-x', 10).map((i) => i.id);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('initialBatchItems', () => {
  it('part tout en attente — donc rien de facture', () => {
    const items = initialBatchItems('lot-x', 3);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.etat === 'attente')).toBe(true);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it('rend une liste vide pour un lot vide', () => {
    expect(initialBatchItems('lot-x', 0)).toEqual([]);
    expect(initialBatchItems('lot-x', -3)).toEqual([]);
  });
});

describe('setItemState', () => {
  it('ne mute pas la liste recue', () => {
    const items = initialBatchItems('lot-x', 2);
    const apres = setItemState(items, 'lot-x-1', 'pret', { postId: 'p1' });
    expect(items[0].etat).toBe('attente');
    expect(apres[0].etat).toBe('pret');
    expect(apres[0].postId).toBe('p1');
  });

  it('ne touche pas les autres contenus', () => {
    const apres = setItemState(initialBatchItems('lot-x', 3), 'lot-x-2', 'echoue', { erreur: 'boum' });
    expect(apres[0].etat).toBe('attente');
    expect(apres[1].etat).toBe('echoue');
    expect(apres[1].erreur).toBe('boum');
    expect(apres[2].etat).toBe('attente');
  });

  it('laisse la liste intacte sur un identifiant inconnu — un lot ne gagne pas de contenu', () => {
    const items = initialBatchItems('lot-x', 2);
    const apres = setItemState(items, 'lot-z-9', 'pret');
    expect(apres).toHaveLength(2);
    expect(apres.every((i) => i.etat === 'attente')).toBe(true);
  });

  it('conserve le postId deja pose quand on ne le refournit pas', () => {
    let items = initialBatchItems('lot-x', 1);
    items = setItemState(items, 'lot-x-1', 'pret', { postId: 'p1' });
    items = setItemState(items, 'lot-x-1', 'echoue', { erreur: 'apres coup' });
    expect(items[0].postId).toBe('p1');
    expect(items[0].erreur).toBe('apres coup');
  });
});

describe('batchSummary', () => {
  it('compte prets, echoues et restants', () => {
    let items = initialBatchItems('lot-x', 5);
    items = setItemState(items, 'lot-x-1', 'pret', { postId: 'a' });
    items = setItemState(items, 'lot-x-2', 'pret', { postId: 'b' });
    items = setItemState(items, 'lot-x-3', 'echoue', { erreur: 'boum' });
    expect(batchSummary(items)).toEqual({ total: 5, prets: 2, echoues: 1, restants: 2 });
  });

  it('compte « rendu » parmi les restants — en cours n est pas abouti', () => {
    const items = setItemState(initialBatchItems('lot-x', 2), 'lot-x-1', 'rendu');
    expect(batchSummary(items).restants).toBe(2);
    expect(batchSummary(items).prets).toBe(0);
  });

  it('rend un lot vide sans exploser', () => {
    expect(batchSummary([])).toEqual({ total: 0, prets: 0, echoues: 0, restants: 0 });
  });
});

describe('failedItems / succeededItems', () => {
  const items: BatchItem[] = [
    { id: 'a', index: 0, etat: 'pret', postId: 'p0' },
    { id: 'b', index: 1, etat: 'echoue', erreur: 'boum' },
    { id: 'c', index: 2, etat: 'attente' },
  ];

  it('isole les echecs', () => {
    expect(failedItems(items).map((i) => i.id)).toEqual(['b']);
  });

  it('isole les reussites — ce sont elles qu on ne doit jamais refaire', () => {
    expect(succeededItems(items).map((i) => i.id)).toEqual(['a']);
  });
});

describe('batchPartiel', () => {
  it('est faux sur un lot entierement reussi', () => {
    let items = initialBatchItems('lot-x', 2);
    items = setItemState(items, 'lot-x-1', 'pret');
    items = setItemState(items, 'lot-x-2', 'pret');
    expect(batchPartiel(items)).toBe(false);
  });

  it('est faux sur un lot qui n a pas commence', () => {
    expect(batchPartiel(initialBatchItems('lot-x', 3))).toBe(false);
  });

  it('est vrai des qu un contenu echoue', () => {
    const items = setItemState(initialBatchItems('lot-x', 3), 'lot-x-1', 'echoue', { erreur: 'x' });
    expect(batchPartiel(items)).toBe(true);
  });

  it('est vrai quand le lot s arrete apres quelques reussites', () => {
    let items = initialBatchItems('lot-x', 4);
    items = setItemState(items, 'lot-x-1', 'pret');
    items = setItemState(items, 'lot-x-2', 'pret');
    expect(batchPartiel(items)).toBe(true);
  });

  it('est faux sur un lot vide', () => {
    expect(batchPartiel([])).toBe(false);
  });
});

describe('repriseAutorisee — la garde anti double debit', () => {
  it('refuse TOUJOURS, y compris avec des echecs a reprendre', () => {
    const items = setItemState(initialBatchItems('lot-x', 3), 'lot-x-2', 'echoue', { erreur: 'x' });
    expect(repriseAutorisee(items).autorisee).toBe(false);
  });

  it('refuse aussi sur un lot vide', () => {
    expect(repriseAutorisee([]).autorisee).toBe(false);
  });

  it('donne la vraie raison, pas une panne passagere', () => {
    const { raison } = repriseAutorisee([]);
    expect(raison).toBe(REPRISE_INDISPONIBLE);
    expect(raison).toContain('idempotence');
    expect(raison).toContain('deux fois');
  });

  it('annonce que les contenus reussis sont conserves', () => {
    expect(REPRISE_INDISPONIBLE).toContain('conservés');
  });
});
