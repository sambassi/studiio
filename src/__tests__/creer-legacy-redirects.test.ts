import { describe, it, expect } from 'vitest';
import {
  buildQuery,
  hasEditTarget,
  needsLegacyEditor,
  LEGACY_ONLY_PARAMS,
  creerRedirectTarget,
  CREER_ROUTE,
  CREER_AVANCE_ROUTE,
  EDIT_PARAMS,
  type SearchParams,
} from '../lib/routing/legacy-redirect';

/**
 * Redirection des anciennes routes de création.
 *
 * Trois chemins historiques (`creer-simple`, `creator`, `infographie`) doivent
 * arriver sur la bonne des deux pages, SANS rien perdre de leur query.
 *
 * Ce que ces tests verrouillent :
 *
 * 1. **Le triage.** Un lien qui porte `postId` ou `id` désigne un contenu
 *    EXISTANT. `postId` (un post) va au parcours guidé, qui le relit depuis
 *    PR #426. `id` (une vidéo) reste sur l'ancien éditeur : le parcours guidé
 *    l'ignorerait et afficherait un montage vierge, sans la moindre erreur.
 * 2. **Le transport intégral.** Redirections actuelles perdent la query en
 *    silence (`redirect('/dashboard/creer')` sans `searchParams`). Chaque
 *    paramètre — connu ou non — doit traverser tel quel.
 * 3. **L'absence d'interprétation.** Le module transporte, il ne comprend pas.
 *    Aucun paramètre n'est renommé, normalisé, filtré ni consommé.
 * 4. **L'impossibilité d'une destination externe.** La cible est construite
 *    depuis deux constantes du module ; aucune entrée ne doit pouvoir en
 *    faire sortir.
 */

describe('triage entre nouvelle création et modification', () => {
  it('sans paramètre, vise le parcours guidé', () => {
    expect(creerRedirectTarget()).toBe('/dashboard/creer');
    expect(creerRedirectTarget({})).toBe('/dashboard/creer');
  });

  it('avec `postId` seul, vise le parcours guidé, qui relit le post', () => {
    expect(creerRedirectTarget({ postId: 'abc123' }))
      .toBe('/dashboard/creer?postId=abc123');
  });

  it('avec `id` seul, vise l’éditeur avancé', () => {
    expect(creerRedirectTarget({ id: 'v-42' }))
      .toBe('/dashboard/creer-avance?id=v-42');
  });

  it('un identifiant VIDE reste une intention de modification', () => {
    // Un lien d'édition abîmé ne doit pas se muer en création. `?postId=` est
    // transporté tel quel : le parcours guidé l'affiche « lien incomplet »
    // (editTarget → `invalid`) au lieu d'ouvrir un montage vierge.
    expect(creerRedirectTarget({ postId: '' }))
      .toBe('/dashboard/creer?postId=');
    expect(creerRedirectTarget({ id: '' }))
      .toBe('/dashboard/creer-avance?id=');
  });

  it('une clé à `undefined` ne déclenche pas la modification', () => {
    expect(creerRedirectTarget({ postId: undefined })).toBe('/dashboard/creer');
    expect(hasEditTarget({ id: undefined })).toBe(false);
  });

  it('`tab=audio` seul reste une création : il ne désigne aucun contenu', () => {
    expect(creerRedirectTarget({ tab: 'audio' }))
      .toBe('/dashboard/creer?tab=audio');
  });

  it('`source=drive` seul reste une création', () => {
    expect(creerRedirectTarget({ source: 'drive' }))
      .toBe('/dashboard/creer?source=drive');
  });

  it('`panneau=autopilote` seul reste une création', () => {
    expect(creerRedirectTarget({ panneau: 'autopilote' }))
      .toBe('/dashboard/creer?panneau=autopilote');
  });

  it('`postId` combiné à d’autres paramètres les emmène tous sur le parcours guidé', () => {
    expect(creerRedirectTarget({ postId: 'p1', tab: 'audio', source: 'drive' }))
      .toBe('/dashboard/creer?postId=p1&tab=audio&source=drive');
  });

  it('`id` combiné à `tab` part aussi sur l’avancé', () => {
    expect(creerRedirectTarget({ id: 'v9', tab: 'audio' }))
      .toBe('/dashboard/creer-avance?id=v9&tab=audio');
  });

  it('les deux identifiants ensemble ne cassent rien', () => {
    expect(creerRedirectTarget({ postId: 'p', id: 'v' }))
      .toBe('/dashboard/creer-avance?postId=p&id=v');
  });

  it('seul `id` (videos.id) retient encore un lien sur l’éditeur avancé', () => {
    expect([...LEGACY_ONLY_PARAMS]).toEqual(['id']);
    expect(needsLegacyEditor({ postId: 'p' })).toBe(false);
    expect(needsLegacyEditor({ id: 'v' })).toBe(true);
    expect(needsLegacyEditor({ id: '' })).toBe(true);
    expect(needsLegacyEditor({ id: undefined })).toBe(false);
    expect(needsLegacyEditor(undefined)).toBe(false);
  });

  it('un `postId` répété part sur le parcours guidé, qui le refuse explicitement', () => {
    expect(creerRedirectTarget({ postId: ['a', 'b'] }))
      .toBe('/dashboard/creer?postId=a&postId=b');
  });

  it('la liste des paramètres d’édition est exactement `postId` et `id`', () => {
    expect([...EDIT_PARAMS]).toEqual(['postId', 'id']);
  });
});

describe('transport intégral de la query', () => {
  it('conserve les paramètres répétés, dans leur ordre', () => {
    expect(buildQuery({ tag: ['a', 'b'] })).toBe('?tag=a&tag=b');
    expect(creerRedirectTarget({ tag: ['a', 'b'] }))
      .toBe('/dashboard/creer?tag=a&tag=b');
  });

  it('conserve un répété à trois valeurs sans les dédoublonner', () => {
    expect(buildQuery({ tag: ['a', 'b', 'a'] })).toBe('?tag=a&tag=b&tag=a');
  });

  it('conserve une valeur vide plutôt que d’oublier la clé', () => {
    expect(buildQuery({ tab: '' })).toBe('?tab=');
    expect(buildQuery({ a: '', b: 'x' })).toBe('?a=&b=x');
  });

  it('conserve un répété dont une valeur est vide', () => {
    expect(buildQuery({ tag: ['', 'b'] })).toBe('?tag=&tag=b');
  });

  it('ignore une clé à `undefined` plutôt que d’écrire "undefined"', () => {
    expect(buildQuery({ a: undefined, b: 'x' })).toBe('?b=x');
    expect(buildQuery({ a: undefined })).toBe('');
  });

  it('rend une chaîne vide quand il n’y a rien à transporter', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
  });

  it('encode les caractères accentués', () => {
    const cible = creerRedirectTarget({ titre: 'été' });
    expect(cible).toBe('/dashboard/creer?titre=%C3%A9t%C3%A9');
    // Et surtout : la valeur se relit à l'identique de l'autre côté.
    expect(new URL(cible, 'https://studiio.pro').searchParams.get('titre')).toBe('été');
  });

  it('encode espaces, `&` et `=` sans casser la query', () => {
    const cible = creerRedirectTarget({ q: 'a b&c=d' });
    const relu = new URL(cible, 'https://studiio.pro').searchParams;
    expect(relu.get('q')).toBe('a b&c=d');
    // Une seule clé : le `&` de la valeur n'a pas fabriqué de paramètre.
    expect([...relu.keys()]).toEqual(['q']);
  });

  it('une valeur DÉJÀ encodée est ré-encodée, donc conservée telle quelle', () => {
    // Next livre les valeurs décodées : un `%C3%A9` reçu ici est littéralement
    // ces six caractères, et doit se relire ainsi.
    const cible = creerRedirectTarget({ v: '%C3%A9' });
    expect(new URL(cible, 'https://studiio.pro').searchParams.get('v')).toBe('%C3%A9');
  });

  it('encode aussi une clé exotique', () => {
    const relu = new URL(creerRedirectTarget({ 'a/b': 'c' }), 'https://studiio.pro');
    expect(relu.searchParams.get('a/b')).toBe('c');
  });

  it('transporte un paramètre inconnu sans le toucher', () => {
    expect(buildQuery({ parametreJamaisVu: 'x' })).toBe('?parametreJamaisVu=x');
  });
});

describe('aucune interprétation métier', () => {
  it('ne renomme, ne filtre ni ne consomme aucun paramètre', () => {
    const entree: SearchParams = {
      postId: 'p1', id: 'v1', tab: 'audio', source: 'drive',
      panneau: 'autopilote', tag: ['a', 'b'], vide: '',
    };
    const relu = new URL(creerRedirectTarget(entree), 'https://studiio.pro').searchParams;
    expect(relu.get('postId')).toBe('p1');
    expect(relu.get('id')).toBe('v1');
    expect(relu.get('tab')).toBe('audio');
    expect(relu.get('source')).toBe('drive');
    expect(relu.get('panneau')).toBe('autopilote');
    expect(relu.getAll('tag')).toEqual(['a', 'b']);
    expect(relu.get('vide')).toBe('');
  });

  it('le triage ne dépend QUE de la présence de `id`', () => {
    // Même jeu de paramètres, `id` en plus : la cible bascule.
    expect(creerRedirectTarget({ tab: 'audio', source: 'drive', postId: 'p' }))
      .toBe('/dashboard/creer?tab=audio&source=drive&postId=p');
    expect(creerRedirectTarget({ tab: 'audio', source: 'drive', id: 'v' }))
      .toBe('/dashboard/creer-avance?tab=audio&source=drive&id=v');
  });
});

describe('aucune destination externe possible', () => {
  const hostiles: SearchParams[] = [
    { postId: '//evil.com' },
    { id: 'https://evil.com' },
    { retour: '//evil.com/x' },
    { retour: 'javascript:alert(1)' },
    { 'https://evil.com': 'x' },
    { postId: ['//evil.com', 'b'] },
  ];

  it.each(hostiles)('reste sur une route interne : %o', (entree) => {
    const cible = creerRedirectTarget(entree);
    expect(cible.startsWith(`${CREER_ROUTE}?`) || cible === CREER_ROUTE
      || cible.startsWith(`${CREER_AVANCE_ROUTE}?`) || cible === CREER_AVANCE_ROUTE).toBe(true);
    expect(cible.startsWith('//')).toBe(false);
    expect(cible).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
    // Résolue contre n'importe quelle origine, la cible y reste.
    expect(new URL(cible, 'https://studiio.pro').origin).toBe('https://studiio.pro');
  });

  it('les deux seules routes possibles sont les constantes du module', () => {
    expect(CREER_ROUTE).toBe('/dashboard/creer');
    expect(CREER_AVANCE_ROUTE).toBe('/dashboard/creer-avance');
  });
});

describe('mécanisme partagé', () => {
  it('`creerRedirectTarget` se compose de `needsLegacyEditor` et `buildQuery`', () => {
    const cas: SearchParams[] = [
      {}, { postId: 'p' }, { id: 'v' }, { tab: 'audio' },
      { tag: ['a', 'b'] }, { postId: 'p', tag: ['a', 'b'] },
    ];
    for (const entree of cas) {
      const attendu = (needsLegacyEditor(entree) ? CREER_AVANCE_ROUTE : CREER_ROUTE) + buildQuery(entree);
      expect(creerRedirectTarget(entree)).toBe(attendu);
    }
  });

  it('un appel sans argument ne lève pas', () => {
    expect(() => creerRedirectTarget(undefined)).not.toThrow();
    expect(hasEditTarget(undefined)).toBe(false);
  });
});
