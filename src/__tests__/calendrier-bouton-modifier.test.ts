import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Rouvrir un post du Calendrier pour le modifier.
 *
 * ⚠️ BASCULE VERS LE NOUVEAU PARCOURS. Le Calendrier n'envoie plus vers l'ancien
 * éditeur `/dashboard/creer-avance` mais vers `/dashboard/creer?postId=` :
 * l'assistant lit `postId` SEULEMENT (voir `lib/creer/editTarget.ts`), charge le
 * post via `GET /api/posts/[id]` — vérifié côté serveur contre la session, donc
 * 404 pour le contenu d'autrui — restaure le design, puis enregistre par
 * `PATCH /api/posts/[id]` sur CE post. Conséquences prouvées ailleurs et
 * inchangées ici :
 *   - même post mis à jour, aucun doublon (`creer-modifier-enregistrement`,
 *     `creer-modifier-actions`, `posts-patch-route`) ;
 *   - montage déjà rendu (`renderedVideoUrl`) et champs non réglés préservés
 *     (`creer-modifier-enregistrement`) ;
 *   - ouvrir ne rend rien, ne débite aucun crédit et ne publie rien
 *     (`creer-modifier-chargement`, `creer-modifier-wizard`) ;
 *   - le contenu d'un autre utilisateur est refusé sans fuite
 *     (`creer-modifier-chargement`, `posts-patch-route`).
 *
 * Ce fichier-ci ne garde qu'une chose : que le CALENDRIER pointe désormais vers
 * ce parcours, et plus vers l'ancien éditeur.
 */

const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');

describe('Le Calendrier ouvre le NOUVEAU parcours de création', () => {
  it('« Modifier le montage » vise `/dashboard/creer?postId=`', () => {
    expect(calendrier).toContain('window.location.href = `/dashboard/creer?postId=${post.id}`;');
  });

  it('plus AUCUNE navigation du Calendrier ne vise l’ancien éditeur', () => {
    // Ni la réouverture du montage, ni les boutons audio.
    expect(calendrier).not.toContain('window.location.href = `/dashboard/creer-avance');
    expect(calendrier).not.toContain('/dashboard/creer-avance?postId=');
  });

  it('les trois entrées d’édition pointent bien vers `/dashboard/creer?postId=`', () => {
    const cibles = [...calendrier.matchAll(/\/dashboard\/creer[a-z-]*\?postId=/g)].map((m) => m[0]);
    expect(cibles).toHaveLength(3);
    expect(new Set(cibles)).toEqual(new Set(['/dashboard/creer?postId=']));
  });
});

describe('Les boutons audio suivent la bascule', () => {
  it('ils passent par le parcours guidé, sans forcer d’onglet', () => {
    // `editTarget` lit `postId` SEULEMENT : `&tab=audio` n'a plus de sens.
    expect(calendrier).not.toContain('&tab=audio');
  });

  it('mais le bouton audio existe toujours — on n’en retire aucun', () => {
    expect(calendrier).toContain('<Volume2');
  });
});

describe('Le bouton « Modifier le montage », aux deux endroits', () => {
  it('dans la liste du jour ET dans l aperçu', () => {
    expect(calendrier.match(/data-post-remodifier/g)).toHaveLength(2);
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
