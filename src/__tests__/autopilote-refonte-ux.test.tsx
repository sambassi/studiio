/**
 * REFONTE UX AUTOPILOTE — « ESSENTIEL VISIBLE, DÉTAILS À LA DEMANDE ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER GARDE, ET POURQUOI ÇA VAUT UN FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La page montait la chaîne COMPLÈTE — analyse, passages, audio, bouton —
 * pour CHAQUE rush vérifié : trois rushes faisaient trois panneaux audio et
 * trois « Créer ma vidéo ». La refonte n'a rien supprimé, elle a déplacé.
 * Le risque, dès lors, n'est pas qu'une fonction manque : c'est qu'elle
 * REVIENNE sur la page principale au premier ajout suivant, et que la
 * surcharge se reconstitue sans que personne ne le voie.
 *
 * Les tests ci-dessous verrouillent donc DEUX choses en même temps :
 *   1. ce qui doit être visible d'emblée l'est ;
 *   2. ce qui doit être caché ne l'est PLUS À L'ÉCRAN — mais reste
 *      atteignable en un geste.
 *
 * ⚠️ ILS MONTENT LES COMPOSANTS. Aucun ne compte des lignes de source pour
 * en déduire un comportement : `tasks/lessons.md` rappelle qu'un test
 * incapable d'échouer quand le produit est cassé n'en est pas un.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act, screen } from '@testing-library/react';

import MenuActions from '@/components/ui/MenuActions';
import VideosPretes from '@/components/creer/VideosPretes';
import SessionsTournagePanel from '@/components/creer/SessionsTournagePanel';
import {
  HAUTEUR_MAX_APERCU, RATIOS_APERCU, geometrieApercu,
} from '@/lib/creer/apercu-geometrie';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RUSH_A = '22222222-2222-4222-8222-222222222222';
const RUSH_B = '33333333-3333-4333-8333-333333333333';
const ANALYSE = '44444444-4444-4444-8444-444444444444';

const SESSIONS = {
  ok: true,
  sessions: [{ id: SESSION, titre: 'Tournage du mardi', statut: 'ouverte' }],
};
const RUSHES = {
  ok: true,
  rushes: [
    { id: RUSH_A, rang: 0, nomOrigine: '1788000000000-01.mov', cleObjet: 'k/a', etat: 'verifie' },
    { id: RUSH_B, rang: 1, nomOrigine: 'spot.mp4', cleObjet: 'k/b', etat: 'verifie' },
  ],
};
const ANALYSE_REUSSIE = {
  ok: true,
  analyse: {
    id: ANALYSE, rushId: RUSH_A, version: 1, etat: 'reussie', etape: 'visuel',
    fournisseurs: {}, dureeSecondes: 107, technique: {}, resume: null,
    textesVisibles: [], parole: {}, audio: {}, qualite: {},
    vignettes: { nombre: 8, secondes: [0, 10, 20, 30, 40, 50, 60, 70] },
    motifEchec: null, createdAt: '', updatedAt: '',
  },
};
const CANDIDATS = {
  ok: true,
  generation: {
    id: 'g-1', version: 1, etat: 'reussie', modele: 'claude-haiku-4-5', motifEchec: null,
    candidats: [
      {
        rang: 1, secondeReference: 4, dureeCibleSecondes: 5,
        debutSecondes: 4.2, finSecondes: 9.2, scoreMontage: 75,
        raison: 'Intervenant assis en plan large, souriant, studio violet.',
      },
      {
        rang: 2, secondeReference: 16, dureeCibleSecondes: 8,
        debutSecondes: 16.1, finSecondes: 24.1, scoreMontage: 72,
        raison: 'Portrait en plan rapproché, posé et concentré.',
      },
    ],
  },
};

/** Le serveur du panneau : sessions, rushes, analyse, candidats. */
function serveur(surAppel?: (url: string, init?: RequestInit) => void) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    surAppel?.(u, init);
    // ⚠️ « /candidats » D'ABORD. `/api/autopilot/analyses/<id>/candidats`
    // CONTIENT « /analyse » : tester l'analyse en premier renvoyait l'analyse
    // à la place des candidats, et le tiroir paraissait vide alors qu'il
    // marchait. Le même piège que celui déjà noté en M3-B3.
    const corps = u.includes('/candidats') ? CANDIDATS
      : u.includes('/analyse') ? ANALYSE_REUSSIE
        : u.includes('/rushes') ? RUSHES
          : SESSIONS;
    return { ok: true, status: 200, json: async () => corps } as unknown as Response;
  });
}

async function monterPanneau(props: Parameters<typeof SessionsTournagePanel>[0] = {}) {
  const vue = render(<SessionsTournagePanel {...props} />);
  // Trois tours : sessions, rushes, puis les analyses des cartes.
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  return vue;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).fetch = serveur();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA BANDE DE RUSHES
// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les rushes tiennent dans une bande horizontale', () => {
  it('1.1 chaque rush est une CARTE, et la piste défile latéralement', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelector('[data-bande-carte]')).toBeTruthy();
    expect(container.querySelectorAll('[data-bande-carte]')).toHaveLength(2);
    // ⚠️ `overflow-x-auto` : c'est ce qui empêche la page de GRANDIR quand on
    // ajoute un rush. Sans lui, la bande retomberait en liste verticale.
    const piste = container.querySelector('[data-bande-piste]')!;
    expect(piste.className).toContain('overflow-x-auto');
  });

  it('1.2 la carte ne montre QUE nom, durée, état — aucun détail d’analyse', async () => {
    const { container } = await monterPanneau();
    const carte = container.querySelector(`[data-bande-carte="${RUSH_A}"]`)!;
    const texte = carte.textContent ?? '';
    // Le préfixe d'horodatage du stockage n'apprend rien à personne.
    expect(texte).toContain('01.mov');
    expect(texte).not.toContain('1788000000000');
    // Rien de ce qui vivait sous chaque rush avant la refonte.
    for (const interdit of ['Passages', 'score', '/100', 'Relancer', 'Volume']) {
      expect(texte).not.toContain(interdit);
    }
  });

  it('1.3 « Ajouter » existe, et accepte PLUSIEURS fichiers d’un coup', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelector('[data-bande-ajouter]')).toBeTruthy();
    const entree = container.querySelector('[data-tournage-fichiers]') as HTMLInputElement;
    expect(entree.multiple).toBe(true);
    expect(entree.accept).toBe('video/*');
  });

  it('1.4 la zone de dépôt n’apparaît QUE quand on survole avec des fichiers', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelector('[data-bande-depot]')).toBeNull();
    const zone = container.querySelector('[data-bande-piste]')!.parentElement!;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(container.querySelector('[data-bande-depot]')).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(container.querySelector('[data-bande-depot]')).toBeNull();
  });

  it('1.5 les flèches n’existent que s’il y a réellement à défiler', async () => {
    // jsdom ne met en page rien : `scrollWidth === clientWidth === 0`, donc
    // aucun débordement — et donc aucune flèche. Deux chevrons inertes
    // seraient deux boutons qui mentent.
    const { container } = await monterPanneau();
    expect(container.querySelector('[data-bande-gauche]')).toBeNull();
    expect(container.querySelector('[data-bande-droite]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CE QUI N'EST PLUS SUR LA PAGE PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les détails sont cachés, pas supprimés', () => {
  it('2.1 aucun passage, aucun score, aucun timecode sur la page', async () => {
    const { container } = await monterPanneau();
    // La liste des passages vivait ICI ; elle est passée dans le tiroir.
    expect(container.querySelector('[data-passages-liste]')).toBeNull();
    expect(container.querySelector('[data-passage-rang]')).toBeNull();
    expect(container.textContent).not.toContain('/100');
  });

  it('2.2 le relevé technique est présent mais REPLIÉ hors de la page', async () => {
    const { container } = await monterPanneau();
    const detail = container.querySelector('[data-analyse-detail]');
    // Il existe encore (rien n'est supprimé) mais il ne s'affiche pas.
    if (detail) expect(detail.className).toContain('hidden');
  });

  it('2.3 UN SEUL « Créer ma vidéo », quel que soit le nombre de rushes', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelectorAll('[data-chaine-bouton]').length).toBeLessThanOrEqual(1);
    const combien = (container.textContent ?? '').split('Créer ma vidéo').length - 1;
    expect(combien).toBeLessThanOrEqual(1);
  });

  it('2.4 UN SEUL panneau Audio, et il est compact', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelectorAll('[data-reglages-audio]').length).toBeLessThanOrEqual(1);
    // Le gros bouton permanent d'enregistrement du défaut a disparu de l'écran.
    expect(container.textContent).not.toContain('Enregistrer comme réglage par défaut');
  });

  it('2.5 « Avancé » est une action discrète, pas une carte de plus', async () => {
    const { container } = await monterPanneau();
    const bouton = container.querySelector('[data-ouvrir-avance]')!;
    expect(bouton).toBeTruthy();
    expect(bouton.textContent).toContain('Avancé');
    // Le tiroir n'est PAS ouvert par défaut : il ne prend aucune place.
    expect(document.querySelector('[data-drawer="avance"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LE TIROIR
// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le tiroir s’ouvre, se ferme, et rend la page nette', () => {
  it('3.1 « Avancé » ouvre un dialogue, Escape le referme', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-ouvrir-avance]')!);
    });
    const tiroir = document.querySelector('[data-drawer="avance"]')!;
    expect(tiroir).toBeTruthy();
    expect(tiroir.querySelector('[role="dialog"]')!.getAttribute('aria-modal')).toBe('true');

    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(document.querySelector('[data-drawer="avance"]')).toBeNull();
  });

  it('3.2 le contenu confié à « Avancé » y est rendu, et NULLE PART ailleurs', async () => {
    const { container } = await monterPanneau({
      avance: <p data-marque-avance>Banque de rushes</p>,
    });
    // Fermé : le contenu n'est pas dans la page.
    expect(container.querySelector('[data-marque-avance]')).toBeNull();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-ouvrir-avance]')!);
    });
    expect(document.querySelector('[data-marque-avance]')).toBeTruthy();
  });

  it('3.3 le bouton de fermeture est nommé pour les lecteurs d’écran', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-ouvrir-avance]')!);
    });
    const fermer = document.querySelector('[data-drawer-fermer]')!;
    expect(fermer.getAttribute('aria-label')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LES MENUS « ⋯ » — ACCESSIBLES, SINON ILS SUPPRIMENT LA FONCTION
// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le menu « ⋯ »', () => {
  const monterMenu = (onClick = vi.fn()) => {
    const vue = render(
      <MenuActions
        etiquette="Actions du rush"
        marqueur="essai"
        actions={[
          { libelle: 'Voir l’analyse', onClick },
          { libelle: 'Ré-analyser', onClick: vi.fn() },
        ]}
      />,
    );
    return { ...vue, onClick };
  };

  it('4.1 le déclencheur est nommé et annonce qu’il ouvre un menu', () => {
    const { container } = monterMenu();
    const b = container.querySelector('[data-menu-actions="essai"]')!;
    expect(b.getAttribute('aria-label')).toBe('Actions du rush');
    expect(b.getAttribute('aria-haspopup')).toBe('menu');
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('4.2 il s’ouvre au CLAVIER, pas seulement à la souris', () => {
    const { container } = monterMenu();
    const b = container.querySelector('[data-menu-actions="essai"]')!;
    fireEvent.keyDown(b, { key: 'ArrowDown' });
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(b.getAttribute('aria-expanded')).toBe('true');
  });

  it('4.3 Escape ferme et rend le focus au déclencheur', () => {
    const { container } = monterMenu();
    const b = container.querySelector('[data-menu-actions="essai"]') as HTMLButtonElement;
    fireEvent.click(b);
    const menu = document.querySelector('[role="menu"]')!;
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it('4.4 choisir une entrée l’exécute et referme', () => {
    const { container, onClick } = monterMenu();
    fireEvent.click(container.querySelector('[data-menu-actions="essai"]')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voir l’analyse' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('4.5 chaque rush porte son menu, et il nomme le rush', async () => {
    const { container } = await monterPanneau();
    const b = container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!;
    expect(b.getAttribute('aria-label')).toContain('01.mov');
  });

  it('4.6 « Voir l’analyse » du rush ouvre le tiroir d’analyse', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Voir l’analyse' }));
    });
    expect(document.querySelector('[data-drawer="analyse"]')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. L'APERÇU — LE CADRE DIT LA VÉRITÉ
// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le cadre d’aperçu suit le format demandé', () => {
  const reponse = (corps: unknown) => vi.fn(async () => ({
    ok: true, status: 200, json: async () => corps,
  } as unknown as Response));

  it.each([
    ['9:16', '9 / 16'],
    ['16:9', '16 / 9'],
    ['1:1', '1 / 1'],
  ])('5.1 format %s → cadre %s', async (format, ratio) => {
    render(
      <VideosPretes
        sessionId={SESSION}
        aucunRush={false}
        formatSouhaite={format}
        fetcher={reponse({ ok: true, rendu: null })}
      />,
    );
    const cadre = await screen.findByTestId
      ? document.querySelector(`[data-videos-cadre="${format}"]`)
      : null;
    await act(async () => { await Promise.resolve(); });
    const el = cadre ?? document.querySelector(`[data-videos-cadre="${format}"]`);
    expect((el as HTMLElement)?.style.aspectRatio).toBe(ratio);
  });

  it('5.2 une vidéo EXISTANTE garde ses vraies dimensions', async () => {
    // ⚠️ L'INVERSE SERAIT LE MEME MENSONGE. Un rendu 1920×1080 affiché dans
    // un cadre vertical parce que le formulaire dit « 9:16 » tromperait tout
    // autant. Le formulaire décide du cadre VIDE ; la vidéo décide du sien.
    render(
      <VideosPretes
        sessionId={SESSION}
        aucunRush={false}
        formatSouhaite="9:16"
        fetcher={reponse({
          ok: true,
          rendu: {
            id: 'r', etat: 'reussie', etape: 'televersement', motif: null,
            creeLe: '', termineLe: '',
            video: {
              dureeSecondes: 24.7, largeur: 1920, hauteur: 1080, fps: 25,
              chemin: '/api/autopilot/rendus-montage/r/fichier',
            },
          },
        })}
      />,
    );
    const affiche = await screen.findByLabelText('Lire la vidéo');
    expect((affiche as HTMLElement).style.aspectRatio).toBe('1920 / 1080');
    expect(document.querySelector('[data-videos-resume]')!.textContent)
      .toContain('Horizontal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. UN SEUL TÉLÉCHARGEMENT, ET AUCUN VERT HORS CHARTE
// ═══════════════════════════════════════════════════════════════════════════
describe('6. Téléchargement et palette', () => {
  const rendu = {
    ok: true,
    rendu: {
      id: 'r', etat: 'reussie', etape: 'televersement', motif: null,
      creeLe: '', termineLe: '',
      video: {
        dureeSecondes: 24.7, largeur: 1080, hauteur: 1920, fps: 25,
        chemin: '/api/autopilot/rendus-montage/r/fichier',
      },
    },
  };
  const monterVideo = () => render(
    <VideosPretes
      sessionId={SESSION}
      aucunRush={false}
      formatSouhaite="9:16"
      fetcher={vi.fn(async () => ({ ok: true, status: 200, json: async () => rendu } as unknown as Response))}
    />,
  );

  it('6.1 le lecteur natif ne propose PAS un second téléchargement', async () => {
    monterVideo();
    const affiche = await screen.findByLabelText('Lire la vidéo');
    await act(async () => { fireEvent.click(affiche); });
    const lecteur = document.querySelector('[data-videos-lecteur]')!;
    expect(lecteur.getAttribute('controlsList')).toBe('nodownload');
    // ⚠️ ET LES COMMANDES RESTENT. Retirer `controls` aurait « supprimé le
    // doublon » en supprimant aussi lecture, position, volume et plein écran.
    expect(lecteur.hasAttribute('controls')).toBe(true);
  });

  it('6.2 une seule action de téléchargement est offerte par Studiio', async () => {
    monterVideo();
    await screen.findByLabelText('Lire la vidéo');
    expect(document.querySelectorAll('[data-videos-telecharger]')).toHaveLength(1);
  });

  it('6.3 aucun cadre vert hors charte autour de la vidéo prête', async () => {
    monterVideo();
    await screen.findByLabelText('Lire la vidéo');
    const html = document.querySelector('[data-videos-pretes]')!.innerHTML;
    expect(html).not.toContain('emerald');
    expect(html).not.toContain('green-');
  });

  it('6.4 les détails du rendu vivent dans le « ⋯ », jamais à l’écran', async () => {
    monterVideo();
    await screen.findByLabelText('Lire la vidéo');
    expect(document.querySelector('[data-videos-detail]')).toBeNull();
    expect(document.querySelector('[data-videos-pretes]')!.textContent)
      .not.toContain('1080');

    await act(async () => {
      fireEvent.click(document.querySelector('[data-menu-actions="rendu"]')!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Détails du rendu' }));
    });
    expect(document.querySelector('[data-videos-detail]')!.textContent).toContain('1080 × 1920');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. LE FORMAT CHOISI REMONTE — C'EST LUI QUI CORRIGE L'APERÇU MENTEUR
// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le format demandé circule', () => {
  it('7.1 changer le format le remonte IMMÉDIATEMENT à la colonne d’aperçu', async () => {
    const onSessionChange = vi.fn();
    const { container } = await monterPanneau({ onSessionChange });
    await act(async () => {
      fireEvent.change(container.querySelector('[data-montage-format]')!, {
        target: { value: '16:9' },
      });
    });
    expect(onSessionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: '16:9' }),
    );
  });

  it('7.2 le format part vers la chaîne, pas seulement vers l’aperçu', async () => {
    const { container } = await monterPanneau();
    const select = container.querySelector('[data-montage-format]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: '9:16' } }); });
    expect(select.value).toBe('9:16');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LE TIROIR N'ÉCRIT RIEN
// ═══════════════════════════════════════════════════════════════════════════
describe('8. Consulter ne produit rien', () => {
  it('8.1 ouvrir « Voir l’analyse » n’envoie AUCUN POST', async () => {
    const appels: Array<{ url: string; methode: string }> = [];
    (globalThis as Record<string, unknown>).fetch = serveur((url, init) => {
      appels.push({ url, methode: (init?.method ?? 'GET').toUpperCase() });
    });
    const { container } = await monterPanneau();
    appels.length = 0;
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Voir l’analyse' }));
    });
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
    expect(appels.filter((a) => a.methode !== 'GET')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. LE TIROIR D'ANALYSE MONTRE LES PASSAGES, AVEC LEURS IMAGES
// ═══════════════════════════════════════════════════════════════════════════
describe('9. L’analyse, quand on la demande', () => {
  it('9.1 chaque passage porte une vignette, un timecode et un score', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Voir l’analyse' }));
    });
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
    const tiroir = document.querySelector('[data-drawer="analyse"]')!;
    expect(tiroir.querySelectorAll('[data-passage-rang]')).toHaveLength(2);
    const premier = tiroir.querySelector('[data-passage-rang="1"]')!;
    expect(premier.textContent).toContain('0:04');
    expect(premier.textContent).toContain('75/100');
    // La vignette vient de l'analyse : aucune image n'est fabriquée pour ça.
    expect(premier.querySelector('img')!.getAttribute('src'))
      .toContain(`/api/autopilot/analyses/${ANALYSE}/vignettes/`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. LES QUATRE DÉFAUTS TROUVÉS EN PRODUCTION LE 2026-09-04
// ═══════════════════════════════════════════════════════════════════════════
describe('10. La géométrie de l’aperçu borne la LARGEUR', () => {
  /**
   * ⚠️ CE QUI EST VERROUILLÉ ICI EST EXACTEMENT CE QUI A CASSÉ.
   *
   * `aspect-ratio` + `max-height` + `width: 100%` donnait, en production, un
   * cadre 394×389 pour un montage 1080×1920 : le navigateur rabotait la
   * hauteur sans revenir sur la largeur. La correction consiste à borner la
   * LARGEUR ; sans cette borne, jsdom ne verrait rien — d'où le contrôle
   * Playwright qui mesure la boîte réelle aux trois largeurs de fenêtre.
   */
  it.each([
    ['9:16', 9, 16],
    ['16:9', 16, 9],
    ['1:1', 1, 1],
  ])('A/B/C. %s garde son ratio ET borne sa largeur', (nom, l, h) => {
    expect(RATIOS_APERCU[nom]).toEqual([l, h]);
    const g = geometrieApercu(l, h);
    expect(g.aspectRatio).toBe(`${l} / ${h}`);
    expect(g.maxWidth).toBe(`calc(${HAUTEUR_MAX_APERCU} * ${l} / ${h})`);
    expect(g.maxHeight).toBe(HAUTEUR_MAX_APERCU);
    expect(g.marginInline).toBe('auto');
  });

  it('D. une contrainte de hauteur ne peut plus déformer le cadre', () => {
    // Le cas exact de production : 1080×1920 dans une colonne étroite.
    const g = geometrieApercu(1080, 1920);
    expect(g.maxWidth).toBe('calc(52vh * 1080 / 1920)');
    // La borne de largeur est CE QUI MANQUAIT : sans elle, la hauteur seule
    // était rabotée et le cadre devenait carré.
    expect(g.maxWidth).not.toBe('none');
    expect(g.width).toBe('100%');
  });

  it('D bis. les quatre états de l’aperçu partagent la même géométrie', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.resolve(__dirname, '../components/creer/VideosPretes.tsx'), 'utf8',
    );
    // TROIS appels — `CadreFormat`, l'affiche, le lecteur — pour CINQ
    // emplacements : `CadreFormat` sert a lui seul « aucun rush », « aucune
    // video » et « creation en cours ». Une formule, aucune exception.
    expect(src.match(/geometrieApercu\(/g) ?? []).toHaveLength(3);
    expect(src.match(/<CadreFormat/g) ?? []).toHaveLength(3);
    // Et plus aucun `aspect-ratio` écrit à la main, qui échapperait à la règle.
    expect(src).not.toContain('aspectRatio: `${');
  });
});

describe('11. Le menu « ⋯ » ne peut plus être rogné', () => {
  it('E. le panneau est rendu HORS de la piste qui défile', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    const panneau = document.querySelector(`[data-menu-panneau="rush-${RUSH_A}"]`)!;
    expect(panneau).toBeTruthy();
    // ⚠️ LE POINT ENTIER DU CORRECTIF. Rendu dans la piste `overflow-x-auto`,
    // le menu s'y faisait couper — « ir l'analyse » au lieu de « Voir
    // l'analyse », constaté en production.
    const piste = container.querySelector('[data-bande-piste]')!;
    expect(piste.contains(panneau)).toBe(false);
    expect(panneau.closest('[data-bande-rushes]')).toBeNull();
    expect(getComputedStyle(panneau).position).toBe('fixed');
  });

  it('E bis. Escape ferme, et le clic hors du menu aussi', async () => {
    const { container } = await monterPanneau();
    const decl = container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)! as HTMLElement;
    await act(async () => { fireEvent.click(decl); });
    await act(async () => {
      fireEvent.keyDown(document.querySelector('[role="menu"]')!, { key: 'Escape' });
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () => { fireEvent.click(decl); });
    await act(async () => { fireEvent.mouseDown(document.body); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('E ter. les flèches circulent dans le panneau porté ailleurs', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    const menu = document.querySelector('[role="menu"]')!;
    const entrees = [...document.querySelectorAll('[role="menuitem"]')];
    expect(document.activeElement).toBe(entrees[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(entrees[1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(entrees[0]);
  });
});

describe('12. « Ajouter » ne se cache plus au bout de la bande', () => {
  it('F. le bouton est HORS de la zone qui défile', async () => {
    const { container } = await monterPanneau();
    const ajouter = container.querySelector('[data-bande-ajouter]')!;
    const piste = container.querySelector('[data-bande-piste]')!;
    expect(ajouter).toBeTruthy();
    // ⚠️ MESURÉ EN PRODUCTION : à quatre rushes, il fallait faire défiler
    // 325 px pour le découvrir. C'est le seul point qui faisait échouer le
    // test des cinq secondes.
    expect(piste.contains(ajouter)).toBe(false);
  });

  it('G. le dépôt est annoncé en permanence, et signalé au survol', async () => {
    const { container } = await monterPanneau();
    const aide = container.querySelector('[data-bande-aide]')!;
    expect(aide.textContent).toContain('Déposez vos vidéos');

    expect(container.querySelector('[data-bande-depot]')).toBeNull();
    const zone = container.querySelector('[data-bande-piste]')!.closest('.relative')!;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(container.querySelector('[data-bande-depot]')!.textContent)
      .toContain('Déposez vos vidéos ici');
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(container.querySelector('[data-bande-depot]')).toBeNull();
  });
});

describe('13. Le focus revient au « ⋯ », jamais au body', () => {
  const parcours = async (fermeture: 'escape' | 'bouton') => {
    const { container } = await monterPanneau();
    const decl = container.querySelector(
      `[data-menu-actions="rush-${RUSH_A}"]`,
    ) as HTMLButtonElement;
    decl.focus();
    await act(async () => { fireEvent.click(decl); });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Voir l’analyse' }));
    });
    expect(document.querySelector('[data-drawer="analyse"]')).toBeTruthy();

    if (fermeture === 'escape') {
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    } else {
      await act(async () => {
        fireEvent.click(document.querySelector('[data-drawer-fermer]')!);
      });
    }
    return { decl };
  };

  it('H. Escape referme le tiroir et rend le focus au déclencheur', async () => {
    const { decl } = await parcours('escape');
    expect(document.querySelector('[data-drawer="analyse"]')).toBeNull();
    // ⚠️ L'ENTRÉE DE MENU N'EXISTE PLUS À CET INSTANT. Le tiroir mémorisait
    // ce `menuitem` démonté et rendait donc le focus à `<body>` — constaté en
    // production. Le menu rend maintenant le focus au « ⋯ » AVANT d'exécuter
    // l'action, si bien que ce que le tiroir mémorise survit à sa fermeture.
    expect(document.activeElement).toBe(decl);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('H bis. le bouton Fermer se comporte comme Escape', async () => {
    const { decl } = await parcours('bouton');
    expect(document.querySelector('[data-drawer="analyse"]')).toBeNull();
    expect(document.activeElement).toBe(decl);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. LE TEST DES CINQ SECONDES, ÉCRIT COMME UN TEST
// ═══════════════════════════════════════════════════════════════════════════
describe('14. Sept repères, sans ouvrir un seul menu', () => {
  it('rushes, ajouter, format, durée, audio, créer, résultat', async () => {
    const { container } = await monterPanneau();
    // Le rush qui porte la chaîne : celui-là a des passages.
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-bande-choisir="${RUSH_A}"]`)!.click();
    });
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }

    const reperes = {
      rushes: !!container.querySelector('[data-bande-carte]'),
      ajouter: !!container.querySelector('[data-bande-ajouter]'),
      format: !!container.querySelector('[data-montage-format]'),
      duree: !!container.querySelector('[data-montage-duree]'),
      audio: !!container.querySelector('[data-reglages-audio]'),
      creer: !!container.querySelector('[data-chaine-bouton]'),
    };
    for (const [nom, present] of Object.entries(reperes)) {
      expect(present, `repère manquant : ${nom}`).toBe(true);
    }
    // ⚠️ ET AUCUN MENU N'A ÉTÉ OUVERT. Un repère qu'il faut aller chercher
    // dans un « ⋯ » n'est pas un repère : c'est exactement le reproche fait à
    // « + Ajouter », qui vivait au bout d'une bande à faire défiler.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // Le septième — « où voir le résultat » — est la colonne d'aperçu, montée
    // par l'assistant ; `VideosPretes` la couvre dans les blocs 5 et 6.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. « JE NE COMPRENDS PAS QUEL RUSH SERA UTILISÉ » — LE CONTRAT SE VOIT
// ═══════════════════════════════════════════════════════════════════════════
describe('15. Un seul rush, et on voit lequel', () => {
  it('A. l’intitulé dit le contrat : UN rush pour CETTE vidéo', async () => {
    const { container } = await monterPanneau();
    const bande = container.querySelector('[data-bande-rushes]')!;
    // ⚠️ « Rushes » tout court laissait croire qu'ils partaient tous au
    // montage. Le moteur, lui, part d'un seul.
    expect(bande.textContent).toContain('Rush utilisé pour cette vidéo');
  });

  it('B. le rush sélectionné porte un badge lisible, et lui seul', async () => {
    const { container } = await monterPanneau();
    const badges = container.querySelectorAll('[data-bande-badge]');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('Sélectionné');
    expect(badges[0].closest('[data-bande-carte]')!.getAttribute('data-bande-carte-choisie'))
      .toBe('1');
  });

  it('C. choisir un autre rush déplace la sélection — elle ne s’ajoute pas', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-bande-choisir="${RUSH_B}"]`)!.click();
    });
    expect(container.querySelectorAll('[data-bande-carte-choisie]')).toHaveLength(1);
    expect(container.querySelector(`[data-bande-carte="${RUSH_B}"]`)!
      .getAttribute('data-bande-carte-choisie')).toBe('1');
    expect(container.querySelectorAll('[data-bande-badge]')).toHaveLength(1);
  });

  it('D. aucune case à cocher : rien ne promet un montage multi-rush', async () => {
    const { container } = await monterPanneau();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const cartes = [...container.querySelectorAll('[data-bande-choisir]')];
    // `aria-pressed` : un choix exclusif, pas une sélection multiple.
    for (const c of cartes) expect(c.hasAttribute('aria-pressed')).toBe(true);
    expect(cartes.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('D bis. l’étiquette du clic dit ce qu’il fait', async () => {
    const { container } = await monterPanneau();
    const choisi = container.querySelector('[data-bande-carte-choisie] [data-bande-choisir]')!;
    const autre = container.querySelector(`[data-bande-choisir="${RUSH_B}"]`)!;
    expect(choisi.getAttribute('aria-label')).toContain('sélectionné');
    expect(autre.getAttribute('aria-label')).toContain('Utiliser');
  });
});

describe('16. L’aperçu de droite ne se fait pas passer pour autre chose', () => {
  it('E. il se nomme « dernière vidéo créée »', async () => {
    render(
      <VideosPretes
        sessionId={SESSION}
        aucunRush={false}
        formatSouhaite="9:16"
        fetcher={vi.fn(async () => ({
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            rendu: {
              id: 'r', etat: 'reussie', etape: 'televersement', motif: null,
              creeLe: '', termineLe: '',
              video: {
                dureeSecondes: 24.7, largeur: 1080, hauteur: 1920, fps: 25,
                chemin: '/api/autopilot/rendus-montage/r/fichier',
              },
            },
          }),
        } as unknown as Response))}
      />,
    );
    const resume = await screen.findByText(/dernière vidéo créée/);
    // ⚠️ CE N'EST PAS UN APERÇU DU RUSH SÉLECTIONNÉ. Sans le dire, l'image
    // de droite paraît sans rapport avec la miniature qu'on vient de choisir.
    expect(resume.textContent).toContain('Vertical');
  });
});

describe('17. L’aide, trois lignes, à la demande', () => {
  it('F. le « ? » est nommé, et n’ouvre rien tant qu’on ne clique pas', async () => {
    const { container } = await monterPanneau();
    const aide = container.querySelector('[data-aide-autopilote]')!;
    expect(aide.getAttribute('aria-label')).toContain('Autopilote');
    expect(container.querySelector('[data-aide-panneau]')).toBeNull();

    await act(async () => { fireEvent.click(aide); });
    const panneau = container.querySelector('[data-aide-panneau]')!;
    expect(panneau.querySelectorAll('li')).toHaveLength(3);
    expect(panneau.textContent).toContain('un seul rush');
    expect(panneau.textContent).toContain('multi-rush');

    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(container.querySelector('[data-aide-panneau]')).toBeNull();
  });
});

describe('18. Les menus disent ce qu’ils font', () => {
  it('G. chaque entrée porte une icône ET un libellé en toutes lettres', async () => {
    const { container } = await monterPanneau();
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-menu-actions="rush-${RUSH_A}"]`)!);
    });
    const entrees = [...document.querySelectorAll('[role="menuitem"]')];
    expect(entrees.length).toBeGreaterThan(0);
    for (const e of entrees) {
      // ⚠️ JAMAIS L'ICÔNE SEULE. Une pictogramme sans mot se devine, et se
      // devine mal — c'est le reproche fait aux « ⋯ » trop mystérieux.
      expect((e.textContent ?? '').trim().length).toBeGreaterThan(2);
      expect(e.querySelector('svg')).toBeTruthy();
    }
  });

  it('H. chaque « ⋯ » est nommé pour un lecteur d’écran et au survol', async () => {
    const { container } = await monterPanneau();
    const menus = [...container.querySelectorAll('[data-menu-actions]')];
    expect(menus.length).toBeGreaterThanOrEqual(2);
    for (const m of menus) {
      expect(m.getAttribute('aria-label')).toBeTruthy();
      expect(m.getAttribute('title')).toBe(m.getAttribute('aria-label'));
    }
  });
});

describe('19. La progression montre des étapes réelles', () => {
  const rendu = (etape: string) => ({
    ok: true,
    rendu: {
      id: 'r', etat: 'en_cours', etape, motif: null, video: null,
      creeLe: '', termineLe: null,
    },
  });
  const monterEnCours = (etape: string) => render(
    <VideosPretes
      sessionId={SESSION}
      aucunRush={false}
      formatSouhaite="9:16"
      fetcher={vi.fn(async () => ({
        ok: true, status: 200, json: async () => rendu(etape),
      } as unknown as Response))}
    />,
  );

  it('I. la progression est visible pendant toute la création', async () => {
    monterEnCours('encodage');
    await screen.findByText('Création en cours');
    const bloc = document.querySelector('[data-etapes-creation]')!;
    expect(bloc).toBeTruthy();
    expect(bloc.querySelectorAll('[data-etape]')).toHaveLength(4);
    expect(document.querySelector('[data-etapes-barre]')).toBeTruthy();
  });

  it.each([
    ['decoupage', 'decoupage', '1/4'],
    ['montage', 'montage', '2/4'],
    ['source', 'encodage', '3/4'],
    ['encodage', 'encodage', '3/4'],
    ['mesure', 'finalisation', '4/4'],
    ['televersement', 'finalisation', '4/4'],
  ])('J. le jalon réel « %s » se lit comme « %s »', async (jalon, attendue, compte) => {
    cleanup();
    monterEnCours(jalon);
    await screen.findByText('Création en cours');
    const bloc = document.querySelector('[data-etapes-creation]')!;
    expect(bloc.getAttribute('data-etape-active')).toBe(attendue);
    // ⚠️ UN COMPTE D'ÉTAPES, JAMAIS UN POURCENTAGE D'AVANCEMENT. Aucune route
    // ne sait où elle en est DANS son travail ; « 73 % » serait inventé.
    expect(document.querySelector('[data-etapes-compte]')!.textContent).toBe(compte);
    expect(bloc.textContent).not.toMatch(/\d+\s?%/);
  });

  it('J bis. les étapes affichées ne sont QUE des jalons du contrat', async () => {
    const { ETAPES_CREATION, etapeAffichee } = await import('@/components/creer/EtapesCreation');
    expect(ETAPES_CREATION).toHaveLength(4);
    // Les six jalons réels du produit, et rien d'autre.
    for (const jalon of ['decoupage', 'montage', 'rendu', 'source', 'encodage', 'mesure', 'televersement']) {
      expect(ETAPES_CREATION.map((e) => e.cle)).toContain(etapeAffichee(jalon));
    }
    // Un jalon inconnu ne fabrique pas une étape : il retombe sur la première.
    expect(etapeAffichee('inexistant')).toBe('decoupage');
    expect(etapeAffichee(null)).toBe('decoupage');
  });

  it('K. une fois réussie, la progression cède la place à la vidéo', async () => {
    cleanup();
    render(
      <VideosPretes
        sessionId={SESSION}
        aucunRush={false}
        formatSouhaite="9:16"
        fetcher={vi.fn(async () => ({
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            rendu: {
              id: 'r', etat: 'reussie', etape: 'televersement', motif: null,
              creeLe: '', termineLe: '',
              video: {
                dureeSecondes: 24.7, largeur: 1080, hauteur: 1920, fps: 25,
                chemin: '/api/autopilot/rendus-montage/r/fichier',
              },
            },
          }),
        } as unknown as Response))}
      />,
    );
    await screen.findByText('Votre vidéo est prête');
    expect(document.querySelector('[data-etapes-creation]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. « UNE ERREUR INTERNE EST SURVENUE » — LA CADENCE NON ENTIÈRE
// ═══════════════════════════════════════════════════════════════════════════
describe('20. Le fps d’un rush entre toujours dans la colonne', () => {
  /**
   * ⚠️ LA PANNE QUE CE BLOC INTERDIT DE REVENIR.
   *
   * `rush_montage_plans.fps` est un `integer not null check (fps between 1
   * and 240)`. Une caméra de téléphone se sonde à 30,046 images par seconde ;
   * cette valeur partait telle quelle vers la base, qui refusait l'insertion.
   * L'exception n'était prévue nulle part : la route rendait « Une erreur
   * interne est survenue » sur un rush parfaitement sain, et rien à l'écran
   * ne pouvait le laisser deviner. Reproduit en production le 2026-09-04.
   */
  it('le cas exact de production : 30,046 devient 30', async () => {
    const { geometrieDepuisTechnique } = await import('@/lib/autopilot/analyse/montage');
    const g = geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080, fps: 30.046 })!;
    expect(g.fps).toBe(30);
    expect(Number.isInteger(g.fps)).toBe(true);
  });

  it.each([
    [23.976, 24], [29.97, 30], [30.046, 30], [59.94, 60], [25, 25], [30, 30],
  ])('la cadence sondée %s entre en base comme %s', async (sonde, attendu) => {
    const { geometrieDepuisTechnique } = await import('@/lib/autopilot/analyse/montage');
    expect(geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080, fps: sonde })!.fps)
      .toBe(attendu);
  });

  it('une cadence hors des bornes du `check` retombe sur le défaut', async () => {
    const { geometrieDepuisTechnique, FPS_DEFAUT, FPS_MIN, FPS_MAX } = await import(
      '@/lib/autopilot/analyse/montage'
    );
    // ⚠️ CE SONT LES BORNES DE LA MIGRATION, PAS DES VALEURS DE CONFORT :
    // `check (fps between 1 and 240)`. Les dépasser rejouerait la même panne
    // muette, sur un autre chiffre.
    expect([FPS_MIN, FPS_MAX]).toEqual([1, 240]);
    for (const aberrant of [0, 0.4, -30, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080, fps: aberrant })!;
      expect(g.fps).toBe(FPS_DEFAUT);
    }
  });

  it('largeur et hauteur restent arrondies comme avant', async () => {
    const { geometrieDepuisTechnique } = await import('@/lib/autopilot/analyse/montage');
    const g = geometrieDepuisTechnique({ largeur: 1919.6, hauteur: 1080.4, fps: 30 })!;
    expect(g).toEqual({ largeur: 1920, hauteur: 1080, fps: 30 });
  });

  it('toute cadence acceptée satisfait le `check` de la colonne', async () => {
    const { geometrieDepuisTechnique, FPS_MIN, FPS_MAX } = await import(
      '@/lib/autopilot/analyse/montage'
    );
    for (let sonde = 0.1; sonde < 300; sonde += 0.37) {
      const g = geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080, fps: sonde })!;
      expect(Number.isInteger(g.fps)).toBe(true);
      expect(g.fps).toBeGreaterThanOrEqual(FPS_MIN);
      expect(g.fps).toBeLessThanOrEqual(FPS_MAX);
    }
  });
});
