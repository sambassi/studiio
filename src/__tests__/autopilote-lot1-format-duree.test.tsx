/**
 * LOT 1 — LE FORMAT ET LA DURÉE, ET RIEN D'AUTRE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER GARDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux réglages sont exposés à l'écran parce que le moteur des rushes les
 * honore vraiment : `POST /clips/[id]/montage` les prend en paramètres, et
 * M3-H en tire les dimensions et la durée du MP4. Tout le reste — titre
 * incrusté, musique, voix, LUT, branding, overlays — serait un contrôle
 * affiché, enregistré, puis IGNORÉ au rendu. C'est cette frontière que les
 * tests ci-dessous rendent difficile à franchir par inadvertance.
 *
 * ⚠️ LES TESTS D'ÉCRAN MONTENT LE COMPOSANT. Ils ne comptent pas des lignes
 * de source : `tasks/lessons.md` rappelle qu'un test incapable d'échouer
 * quand le produit est cassé n'est pas une vérification. Les deux seules
 * lectures de source de ce fichier portent sur une ABSENCE d'arête (un
 * composant qui ne doit plus en monter un autre) — ce qu'un rendu ne peut
 * pas prouver aussi directement, et elles le disent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

import {
  MONTAGE_DEFAUT, MONTAGE_DUREE_MAX, MONTAGE_DUREE_MIN, MONTAGE_FORMATS,
  montageDepuisStyle, sanitizeDesignStyle,
} from '@/lib/autopilot/textStyle';
import { sanitizeConfig } from '@/lib/autopilot/rules';
import {
  DUREE_CIBLE_SECONDES, FORMAT_VIDEO, creerVideo,
} from '@/lib/autopilot/analyse/chaine-passerelle';
import {
  DUREE_CIBLE_MAX_SECONDES, DUREE_CIBLE_MIN_SECONDES, FORMATS_MONTAGE,
} from '@/lib/autopilot/analyse/montage-contrat';

// ─────────────────────────────────────────────────────────────────────────
// `AnalyseRush` est REMPLACÉ : ce qui est vérifié ici, c'est ce que le
// panneau lui REMET, pas ce que l'analyse d'un rush affiche.
// ─────────────────────────────────────────────────────────────────────────
const recuParAnalyse: { montage?: unknown }[] = [];
vi.mock('@/components/creer/AnalyseRush', () => ({
  default: (props: { montage?: unknown }) => {
    recuParAnalyse.push({ montage: props.montage });
    return null;
  },
}));

// eslint-disable-next-line import/first
import SessionsTournagePanel from '@/components/creer/SessionsTournagePanel';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RUSH = '22222222-2222-4222-8222-222222222222';

const sessionsOk = {
  ok: true,
  sessions: [{ id: SESSION, titre: 'Tournage du mardi', statut: 'ouverte' }],
};
const rushesOk = {
  ok: true,
  rushes: [{ id: RUSH, rang: 0, nomOrigine: 'a.mp4', cleObjet: 'k', etat: 'verifie' }],
};

function serveur() {
  return vi.fn(async (url: string) => {
    const corps = String(url).includes('/rushes') ? rushesOk : sessionsOk;
    return { ok: true, status: 200, json: async () => corps } as unknown as Response;
  });
}

/** Monte le panneau et ouvre le tournage : les réglages n'existent qu'ouvert. */
async function ouvrirTournage(props: Parameters<typeof SessionsTournagePanel>[0] = {}) {
  const rendu = render(<SessionsTournagePanel {...props} />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    // ⚠️ PLUS DE CLIC : depuis la refonte, la premiere session s'ouvre
    // d'elle-meme — un `<select>` qui affiche un nom sans avoir ouvert le
    // tournage correspondant nommerait ce qu'il ne montre pas.
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
  return rendu;
}

const format = (c: HTMLElement) => c.querySelector('[data-montage-format]') as HTMLSelectElement;
const duree = (c: HTMLElement) => c.querySelector('[data-montage-duree]') as HTMLSelectElement;

beforeEach(() => {
  recuParAnalyse.length = 0;
  vi.stubGlobal('fetch', serveur());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE MOTEUR REÇOIT VRAIMENT CE QUI EST CHOISI
// ═══════════════════════════════════════════════════════════════════════════

describe('1. Format et durée arrivent jusqu’au moteur', () => {
  /** Un `fetch` scénarisé pour la chaîne, qui journalise les corps envoyés. */
  function bancChaine() {
    const appels: { url: string; corps: string | null }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, corps: typeof init?.body === 'string' ? init.body : null });
      if (url.endsWith('/clips')) {
        return new Response(JSON.stringify({
          ok: true, clipSet: { id: 'jeu', etat: 'reussie', motifEchec: null },
        }), { status: 200 });
      }
      if (url.endsWith('/montage')) {
        return new Response(JSON.stringify({ ok: true, plan: { id: 'plan' } }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    });
    return { fetcher, appels };
  }

  const corpsMontage = (appels: { url: string; corps: string | null }[]) =>
    JSON.parse(appels.find((a) => a.url.endsWith('/montage'))!.corps!);

  it('1.1 le format et la durée choisis partent TELS QUELS au montage', async () => {
    const { fetcher, appels } = bancChaine();
    await creerVideo({
      candidateSetId: 'candidats',
      format: '16:9',
      dureeCibleSecondes: 60,
      attendre: async () => {},
      fetcher: fetcher as never,
    });
    // Ni arrondi, ni traduction, ni valeur par défaut qui reprendrait la main.
    expect(corpsMontage(appels)).toEqual({ format: '16:9', dureeCibleSecondes: 60 });
  });

  it('1.2 chaque format proposé à l’écran traverse la chaîne intact', async () => {
    for (const f of MONTAGE_FORMATS) {
      const { fetcher, appels } = bancChaine();
      // eslint-disable-next-line no-await-in-loop
      await creerVideo({
        candidateSetId: 'candidats', format: f, dureeCibleSecondes: 15,
        attendre: async () => {}, fetcher: fetcher as never,
      });
      expect(corpsMontage(appels).format, `format ${f}`).toBe(f);
    }
  });

  it('1.3 sans réglage, ce sont EXACTEMENT les valeurs d’avant le lot', async () => {
    const { fetcher, appels } = bancChaine();
    await creerVideo({
      candidateSetId: 'candidats', attendre: async () => {}, fetcher: fetcher as never,
    });
    // ⚠️ LA RÉTRO-COMPATIBILITÉ, PROUVÉE. Une configuration existante ne porte
    // aucun `montage` : son montage doit être identique à celui d'hier.
    expect(corpsMontage(appels)).toEqual({
      format: FORMAT_VIDEO, dureeCibleSecondes: DUREE_CIBLE_SECONDES,
    });
    expect(MONTAGE_DEFAUT).toEqual({
      format: FORMAT_VIDEO, dureeSecondes: DUREE_CIBLE_SECONDES,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE VOCABULAIRE OFFERT EST CELUI QUE LE SERVEUR ACCEPTE
// ═══════════════════════════════════════════════════════════════════════════

describe('2. Aucune option que le serveur refuserait', () => {
  it('2.1 les formats recopiés dans `textStyle` sont ceux du contrat', () => {
    // Recopiés plutôt qu'importés — la configuration n'a pas à tirer
    // `clip-contrat` et `designSpec` derrière elle. C'est CE test qui tient
    // l'alignement, pas une arête d'import.
    expect([...MONTAGE_FORMATS]).toEqual([...FORMATS_MONTAGE]);
  });

  it('2.2 les bornes de durée recopiées sont celles du contrat', () => {
    expect(MONTAGE_DUREE_MIN).toBe(DUREE_CIBLE_MIN_SECONDES);
    expect(MONTAGE_DUREE_MAX).toBe(DUREE_CIBLE_MAX_SECONDES);
  });

  it('2.3 chaque option de l’écran est dans le vocabulaire du contrat', async () => {
    const { container } = await ouvrirTournage();
    for (const o of Array.from(format(container).options)) {
      expect(FORMATS_MONTAGE as readonly string[], `format ${o.value}`).toContain(o.value);
    }
    for (const o of Array.from(duree(container).options)) {
      const n = Number(o.value);
      expect(n).toBeGreaterThanOrEqual(DUREE_CIBLE_MIN_SECONDES);
      expect(n).toBeLessThanOrEqual(DUREE_CIBLE_MAX_SECONDES);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. L'ÉCRAN N'OFFRE QUE CES DEUX RÉGLAGES
// ═══════════════════════════════════════════════════════════════════════════

describe('3. Aucun contrôle factice', () => {
  it('3.1 deux listes déroulantes, et deux seulement', async () => {
    const { container } = await ouvrirTournage();
    const reglages = container.querySelector('[data-montage-reglages]')!;
    expect(reglages.querySelectorAll('select')).toHaveLength(2);
    expect(reglages.querySelectorAll('input')).toHaveLength(0);
  });

  it('3.2 ni texte, ni musique, ni voix, ni look à l’écran', async () => {
    const { container } = await ouvrirTournage();
    const vu = (container.textContent ?? '').toLowerCase();
    // ⚠️ CETTE LISTE EST LA FRONTIÈRE DU LOT. Le moteur des rushes concatène
    // des morceaux recadrés : sa commande ffmpeg n'a ni `drawtext`, ni
    // `amix`, ni `lut3d`. Proposer l'un de ces réglages, c'est promettre un
    // effet qui n'arrivera jamais dans le MP4.
    for (const interdit of [
      'police', 'titre', 'sous-titre', 'musique', 'audio', 'voix', 'voix off',
      'lut', 'look', 'filtre', 'logo', 'watermark', 'overlay', 'incrustation',
    ]) {
      expect(vu, `« ${interdit} » ne doit pas être proposé dans ce lot`)
        .not.toContain(interdit);
    }
  });

  it('3.3 le réglage courant est remis à la chaîne, via l’analyse du rush', async () => {
    const { container } = await ouvrirTournage();
    await act(async () => {
      fireEvent.change(format(container), { target: { value: '1:1' } });
    });
    await act(async () => {
      fireEvent.change(duree(container), { target: { value: '60' } });
    });
    // C'est `AnalyseRush` → `PassagesSuggeres` → `creerVideo` : le panneau
    // n'appelle rien lui-même, il transmet.
    expect(recuParAnalyse.at(-1)!.montage).toEqual({ format: '1:1', dureeSecondes: 60 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. « ENREGISTRER COMME RÉGLAGE PAR DÉFAUT » — ET RIEN AVANT
// ═══════════════════════════════════════════════════════════════════════════

describe('4. Les réglages par défaut', () => {
  it('4.1 changer le format n’enregistre RIEN', async () => {
    const onEnregistrerDefaut = vi.fn();
    const { container } = await ouvrirTournage({ onEnregistrerDefaut });
    await act(async () => {
      fireEvent.change(format(container), { target: { value: '16:9' } });
    });
    await act(async () => {
      fireEvent.change(duree(container), { target: { value: '15' } });
    });
    // ⚠️ CORRIGER UNE VIDÉO NE DOIT PAS CHANGER TOUTES LES SUIVANTES.
    expect(onEnregistrerDefaut).not.toHaveBeenCalled();
  });

  it('4.2 le second geste, lui, enregistre la valeur courante', async () => {
    const onEnregistrerDefaut = vi.fn();
    const { container } = await ouvrirTournage({ onEnregistrerDefaut });
    await act(async () => {
      fireEvent.change(format(container), { target: { value: '16:9' } });
    });
    // ⚠️ LE SECOND GESTE A DEMENAGE, IL N'A PAS DISPARU. Depuis la refonte
    // il vit dans le « ⋯ » de la ligne Format/Durée : un bouton permanent
    // pour un geste rare pesait plus lourd que les deux réglages eux-mêmes.
    // Ce qui est verrouillé reste le même — changer ne suffit pas, il faut
    // demander.
    await act(async () => {
      fireEvent.click(container.querySelector('[data-menu-actions="montage"]')!);
    });
    // ⚠️ `document`, ET NON `container` : le panneau du menu est rendu dans
    // `document.body` par un portail depuis le correctif du menu rogné.
    const entree = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((b) => (b.textContent ?? '').includes('réglage par défaut'))!;
    await act(async () => { fireEvent.click(entree); });
    expect(onEnregistrerDefaut).toHaveBeenCalledTimes(1);
    expect(onEnregistrerDefaut).toHaveBeenCalledWith({ format: '16:9', dureeSecondes: 30 });

    await act(async () => {
      fireEvent.click(container.querySelector('[data-menu-actions="montage"]')!);
    });
    expect(Array.from(document.querySelectorAll('[role="menuitem"]'))
      .map((b) => b.textContent ?? '').join(' ')).toContain('enregistré');
  });

  it('4.3 le bouton est ABSENT quand rien ne sait enregistrer', async () => {
    const { container } = await ouvrirTournage();
    // Rien qui sache enregistrer : pas de menu du tout, donc pas d'entrée.
    expect(container.querySelector('[data-menu-actions="montage"]')).toBeNull();
  });

  it('4.4 le réglage enregistré est celui proposé à l’ouverture', async () => {
    const { container } = await ouvrirTournage({
      montageDefaut: { format: '16:9', dureeSecondes: 60 },
    });
    expect(format(container).value).toBe('16:9');
    expect(duree(container).value).toBe('60');
  });

  it('4.5 le défaut arrivé en retard s’applique — mais jamais par-dessus un choix', async () => {
    // La configuration se charge en réseau : elle arrive APRÈS le premier
    // rendu. Sans le premier cas, l'écran resterait sur `9:16` pour toujours ;
    // sans le second, il effacerait le choix qu'on vient de faire.
    const rendu = render(<SessionsTournagePanel />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(format(rendu.container).value).toBe(MONTAGE_DEFAUT.format);

    rendu.rerender(
      <SessionsTournagePanel montageDefaut={{ format: '16:9', dureeSecondes: 60 }} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(format(rendu.container).value).toBe('16:9');

    await act(async () => {
      fireEvent.change(format(rendu.container), { target: { value: '1:1' } });
    });
    rendu.rerender(
      <SessionsTournagePanel montageDefaut={{ format: '9:16', dureeSecondes: 15 }} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(format(rendu.container).value).toBe('1:1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. OÙ LE RÉGLAGE EST RANGÉ : `designStyle.montage`
// ═══════════════════════════════════════════════════════════════════════════

describe('5. `designStyle.montage`, sans migration', () => {
  it('5.1 un montage valide survit à l’assainissement de la configuration', () => {
    const propre = sanitizeConfig({
      designStyle: { montage: { format: '16:9', dureeSecondes: 45 } },
    });
    // La colonne `design_style` est un `jsonb` déjà en base : un champ de plus
    // n'exige aucune migration.
    expect(propre.designStyle.montage).toEqual({ format: '16:9', dureeSecondes: 45 });
  });

  it('5.2 les autres réglages de style ne sont pas emportés', () => {
    const propre = sanitizeDesignStyle({
      montage: { format: '1:1', dureeSecondes: 15 },
      title: { bold: true },
    });
    expect(propre.montage).toEqual({ format: '1:1', dureeSecondes: 15 });
    expect(propre.title).toEqual({ bold: true });
  });

  it('5.3 un réglage à moitié valide est refusé EN BLOC', () => {
    // Un format bon avec une durée aberrante donnerait un montage qui ne
    // ressemble ni à ce qui est affiché, ni au défaut.
    for (const brut of [
      { format: '4:3', dureeSecondes: 30 },
      { format: '9:16', dureeSecondes: 0 },
      { format: '9:16', dureeSecondes: DUREE_CIBLE_MAX_SECONDES + 1 },
      { format: '9:16' },
      { dureeSecondes: 30 },
    ]) {
      expect(sanitizeDesignStyle({ montage: brut }).montage, JSON.stringify(brut))
        .toBeUndefined();
    }
  });

  it('5.4 rien d’enregistré = le montage d’hier', () => {
    expect(montageDepuisStyle(undefined)).toEqual(MONTAGE_DEFAUT);
    expect(montageDepuisStyle({})).toEqual(MONTAGE_DEFAUT);
    expect(montageDepuisStyle({ montage: { format: '1:1', dureeSecondes: 15 } }))
      .toEqual({ format: '1:1', dureeSecondes: 15 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LA VALIDATION HUMAINE, ÉCRITE
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Studiio prépare, la personne vérifie', () => {
  it('6.1 la phrase est à l’écran avant même que la vidéo existe', async () => {
    const { container } = await ouvrirTournage();
    expect(container.querySelector('[data-validation-humaine]')!.textContent)
      .toContain('Studiio prépare la vidéo. Vous la vérifiez avant publication.');
  });

  it('6.2 aucune publication automatique n’est promise', async () => {
    const { container } = await ouvrirTournage();
    const vu = (container.textContent ?? '').toLowerCase();
    for (const interdit of ['publication automatique', 'publier automatiquement']) {
      expect(vu).not.toContain(interdit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. UN SEUL APERÇU
// ═══════════════════════════════════════════════════════════════════════════

describe('7. Un seul endroit où regarder', () => {
  it('7.1 le panneau de configuration ne montre AUCUNE vidéo', async () => {
    const { container } = await ouvrirTournage();
    // `VideosPretes` se signale par cet attribut. Son absence ici, alors qu'un
    // tournage est ouvert et porte un rush, est ce qui prouve qu'il n'y a plus
    // de second lecteur dans la colonne de gauche.
    expect(container.querySelector('[data-videos-pretes]')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('7.2 le tournage regardé est REMONTÉ, seule façon d’avoir un aperçu unique', async () => {
    const onSessionChange = vi.fn();
    await ouvrirTournage({ onSessionChange });
    expect(onSessionChange).toHaveBeenLastCalledWith({
      sessionId: SESSION, aucunRush: false, format: MONTAGE_DEFAUT.format,
    });
  });

  it('7.3 aucune arête ne subsiste vers le lecteur depuis la colonne de gauche', () => {
    // ⚠️ LECTURE DE SOURCE ASSUMÉE. Un rendu prouve qu'aucun lecteur n'est
    // AFFICHÉ ; il ne prouve pas qu'aucun ne le sera dans un état non couvert.
    // L'arête d'import, elle, est la garantie structurelle.
    const src = readFileSync(
      path.resolve(__dirname, '../components/creer/SessionsTournagePanel.tsx'), 'utf8',
    );
    expect(src).not.toContain('VideosPretes');
  });

  it('7.4 l’assistant monte le lecteur UNE fois, dans la colonne collante', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8',
    );
    expect(src.match(/<VideosPretes\b/g) ?? []).toHaveLength(1);
    // La colonne d'aperçu reste visible pendant que la colonne centrale
    // défile : sans `sticky`, elle sortirait de l'écran dès que le panneau
    // s'allonge — et l'aperçu unique redeviendrait introuvable.
    const avant = src.slice(0, src.indexOf('<VideosPretes'));
    const depuisLaColonne = avant.slice(avant.lastIndexOf('lg:sticky'));
    expect(avant).toContain('lg:sticky');
    // Aucune AUTRE colonne ne s'ouvre entre le `sticky` et le lecteur : c'est
    // donc bien la colonne collante qui le porte. La preuve visuelle, elle,
    // est faite au navigateur — un test de source ne mesure aucun défilement.
    expect(depuisLaColonne).not.toContain('lg:col-span');
  });
});
