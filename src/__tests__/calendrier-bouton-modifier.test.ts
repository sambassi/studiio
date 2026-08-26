import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Rouvrir un brouillon dans l'éditeur.
 *
 * ⚠️ LE MÉCANISME EXISTAIT, L'ENTRÉE MANQUAIT. Le deeplink
 * `/dashboard/creer-avance?postId=` restaure déjà tout le design. Sa seule entrée
 * était le bouton **audio**, qui forçait `&tab=audio` : pour changer une
 * carte ou un titre, il fallait passer par « ajouter de l'audio » puis
 * revenir en arrière.
 *
 * ⚠️ ET RÉ-EXPORTER CRÉAIT UN DOUBLON. `editingPostId` était bien posé par le
 * deeplink, mais l'export faisait toujours `POST /api/posts` : on repartait
 * avec deux versions du même montage, sans savoir laquelle partirait. C'est
 * le défaut le plus coûteux des deux — il ne se voit qu'après coup, dans le
 * Calendrier.
 */

const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');
const editeur = readFileSync(resolve(__dirname, '../app/dashboard/creer-avance/page.tsx'), 'utf-8');

describe('Ré-exporter MET À JOUR le post', () => {
  it('l export vise `editingPostId` quand il existe', () => {
    expect(editeur).toContain('const cibleEdition = b === 0 ? editingPostId : null;');
    expect(editeur).toContain('cibleEdition ? `/api/posts/${cibleEdition}` : "/api/posts"');
    expect(editeur).toContain('method: cibleEdition ? "PATCH" : "POST"');
  });

  it('seul le PREMIER élément d un lot vise le post d origine', () => {
    // Les suivants sont de nouvelles vidéos : elles méritent leurs propres
    // entrées, pas d'écraser la même ligne cinq fois.
    expect(editeur).toContain('b === 0 ? editingPostId : null');
  });

  it('les deux formes de réponse sont lues', () => {
    // `POST` rend `{ post }`, `PATCH` rend `{ data }` : sans les deux, une
    // mise à jour réussie passerait pour un échec.
    expect(editeur).toContain('const ligne = postData.post || postData.data;');
  });

  it('le deeplink pose bien `editingPostId`', () => {
    expect(editeur).toContain('setEditingPostId(post.id);');
  });
});

describe('Le bouton, aux deux endroits', () => {
  it('dans la liste du jour ET dans l aperçu', () => {
    expect(calendrier.match(/data-post-remodifier/g)).toHaveLength(2);
  });

  it('il ouvre l éditeur SANS forcer l étape audio', () => {
    expect(calendrier).toContain('window.location.href = `/dashboard/creer-avance?postId=${post.id}`;');
  });

  it('le bouton audio existant est intact', () => {
    // On ajoute une entrée, on n'en retire aucune.
    expect(calendrier).toContain('&tab=audio');
    expect(calendrier).toContain('<Volume2');
  });
});

describe('Les deux crayons se distinguent', () => {
  it('des libellés qui disent le geste, pas l outil', () => {
    // Le dépôt compte déjà assez d'icônes jumelles : une de plus sans libellé
    // distinct serait un doublon muet.
    expect(calendrier).toContain('title="Modifier le texte et la programmation"');
    expect(calendrier).toContain('title="Modifier le montage dans l’éditeur"');
  });

  it('une icône DIFFÉRENTE, en SVG lucide', () => {
    expect(calendrier).toContain('<Wand2 className="w-3 h-3" />');
    expect(calendrier).toContain('<Wand2 size={14} />');
    // Jamais d'emoji : règle absolue du dépôt.
    expect(calendrier).not.toMatch(/title="[^"]*[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('Un post déjà publié', () => {
  it('prévient que le média en ligne ne changera pas', () => {
    // Laisser croire qu'on corrige ce qui est parti serait pire que de ne
    // rien proposer.
    expect(calendrier).toContain("if (post.status === 'published')");
    expect(calendrier).toContain('ne changera pas la vidéo déjà en ligne');
  });

  it('et laisse annuler', () => {
    expect(calendrier).toContain('if (!suite) return;');
  });
});
