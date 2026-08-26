import { describe, it, expect } from 'vitest';
import {
  readEditTarget,
  LIEN_INCOMPLET,
  type EditTarget,
} from '../lib/creer/editTarget';
import type { SearchParams } from '../lib/routing/legacy-redirect';

/**
 * Ce que `/dashboard/creer` doit comprendre de son lien d'entrée.
 *
 * Une seule question est posée ici : « cette URL demande-t-elle une NOUVELLE
 * création, la MODIFICATION d'un contenu existant, ou est-elle abîmée ? ».
 * Rien d'autre — ce module ne lit aucune base, n'appelle aucune API et ne
 * décide d'aucun rendu.
 *
 * Pourquoi une fonction séparée plutôt qu'un `searchParams.postId` lu sur
 * place : le triage est la seule chose qui distingue un montage vierge d'un
 * contenu perdu. Se tromper ici ne produit AUCUNE erreur visible — l'écran
 * s'ouvre simplement vide, et l'utilisateur croit son travail effacé. Cette
 * décision mérite d'être nommée, testée, et lisible sans ouvrir un composant
 * de 8 500 lignes.
 *
 * PÉRIMÈTRE DE LA PHASE B : `postId` seulement. Le paramètre `id`, porté par
 * le bouton « Modifier » de la Bibliothèque, désigne une VIDÉO (`videos.id`) —
 * il n'est lu par personne aujourd'hui et son contrat de modification n'est
 * pas défini. Il est donc traité ici comme n'importe quel paramètre inconnu :
 * ignoré, sans effet. Les tests le verrouillent, pour qu'une réintroduction
 * soit un choix explicite et non un effet de bord.
 */

describe('nouvelle création — le cas qui ne doit jamais changer', () => {
  it('sans aucun paramètre, demande une création', () => {
    expect(readEditTarget()).toEqual<EditTarget>({ kind: 'create' });
    expect(readEditTarget({})).toEqual<EditTarget>({ kind: 'create' });
  });

  it('avec des paramètres qui ne parlent pas de modification, reste une création', () => {
    expect(readEditTarget({ tab: 'audio', theme: 'sport' }))
      .toEqual<EditTarget>({ kind: 'create' });
  });

  it('le `id` de la Bibliothèque ne déclenche RIEN dans cette phase', () => {
    // Il désigne une video, pas un post. Le lire comme un `postId` chargerait
    // un contenu qui n'existe pas — ou pire, le post d'un autre objet portant
    // le meme identifiant.
    expect(readEditTarget({ id: 'video-123' })).toEqual<EditTarget>({ kind: 'create' });
  });
});

describe('modification demandée', () => {
  it('un `postId` renseigné désigne le contenu à charger', () => {
    expect(readEditTarget({ postId: 'post-42' }))
      .toEqual<EditTarget>({ kind: 'edit', postId: 'post-42' });
  });

  it('les espaces autour de l\'identifiant sont retirés', () => {
    expect(readEditTarget({ postId: '  post-42  ' }))
      .toEqual<EditTarget>({ kind: 'edit', postId: 'post-42' });
  });

  it('les autres paramètres n\'y changent rien', () => {
    expect(readEditTarget({ postId: 'post-42', tab: 'audio' }))
      .toEqual<EditTarget>({ kind: 'edit', postId: 'post-42' });
  });
});

describe('lien abîmé — jamais un repli silencieux en création', () => {
  it('`?postId=` vide est une erreur explicite', () => {
    // LE test de la décision produit : une clé présente mais vide est un lien
    // de modification cassé, pas une demande de nouvelle création. Retomber en
    // création afficherait un montage vierge, indiscernable d'une perte.
    expect(readEditTarget({ postId: '' })).toEqual<EditTarget>({ kind: 'invalid' });
  });

  it('un identifiant fait uniquement d\'espaces est aussi une erreur', () => {
    expect(readEditTarget({ postId: '   ' })).toEqual<EditTarget>({ kind: 'invalid' });
  });

  it('un `postId` répété est ambigu, donc refusé', () => {
    // `?postId=a&postId=b` : choisir le premier serait un pari sur le contenu
    // que l'utilisateur veut ouvrir. On préfère refuser que charger le mauvais.
    expect(readEditTarget({ postId: ['a', 'b'] })).toEqual<EditTarget>({ kind: 'invalid' });
  });

  it('un `postId` répété une seule fois reste lisible', () => {
    expect(readEditTarget({ postId: ['post-42'] }))
      .toEqual<EditTarget>({ kind: 'edit', postId: 'post-42' });
  });

  it('le message affiché est celui décidé, au caractère près', () => {
    expect(LIEN_INCOMPLET).toBe('Ce lien de modification est incomplet.');
  });
});

describe('le module ne fait QUE trier', () => {
  it('ne modifie pas son argument', () => {
    const params: SearchParams = { postId: '  post-42  ', tab: 'audio' };
    const copie = JSON.parse(JSON.stringify(params));
    readEditTarget(params);
    expect(params).toEqual(copie);
  });

  it('aucune valeur reçue ne peut produire autre chose que les trois issues', () => {
    const entrees: SearchParams[] = [
      { postId: 'https://ailleurs.example/x' },
      { postId: '../../autre' },
      { postId: '__proto__' },
      { postId: 'constructor' },
    ];
    for (const e of entrees) {
      const cible = readEditTarget(e);
      expect(['create', 'edit', 'invalid']).toContain(cible.kind);
    }
  });

  it('une clé héritée du prototype ne peut pas se faire passer pour un `postId`', () => {
    const piege = Object.create({ postId: 'herite' }) as SearchParams;
    expect(readEditTarget(piege)).toEqual<EditTarget>({ kind: 'create' });
  });
});
