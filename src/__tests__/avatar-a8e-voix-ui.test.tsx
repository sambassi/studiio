/**
 * A_8e — MA VOIX & PRONONCIATION, ET L'ÉCRAN QUI NE MENT PAS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX ÉCRANS, DEUX PROMESSES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `PrononciationsPanel` promet qu'une règle change CE QUE LA VOIX DIT, et
 * jamais ce qui est écrit. Le test le vérifie sur le même exemple que
 * l'utilisateur voit : le texte affiché reste intact quand l'aperçu change.
 *
 * `CloneVideoPanel` promet de ne rien montrer qu'il n'ait. Le test vérifie
 * qu'aucun aperçu n'apparaît tant qu'aucun clone n'existe, que le bouton
 * « Je valide mon clone » n'existe pas dans cet état, et qu'un refus du
 * serveur est affiché tel quel plutôt que contourné.
 *
 * ⚠️ TOUT EST MONTÉ POUR DE VRAI ET INTERROGÉ PAR LE DOM. Aucune assertion ne
 * porte sur le texte du fichier source.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render, screen, cleanup, waitFor, fireEvent,
} from '@testing-library/react';

vi.mock('@/components/shared/MediaLibrary', () => ({
  MediaLibrary: () => null,
}));

import PrononciationsPanel from '@/components/voice/PrononciationsPanel';
import CloneVideoPanel from '@/components/avatar/CloneVideoPanel';
import { PRONONCIATIONS_MAX, PRONONCIATION_LONGUEUR_MAX } from '@/lib/voice/prononciations';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

// ───────────────────────────────────────────────────────────────────────────
// La bibliothèque créative, en mémoire
// ───────────────────────────────────────────────────────────────────────────

/** ⚠️ ELLE N'EST PAS VIDE : le reste doit survivre à chaque écriture. */
let bibliotheque: Record<string, unknown>;
let ecritures: Record<string, unknown>[];
/** Ce que la prochaine validation de clone répondra. */
let reponseValidation: { statut: number; corps: Record<string, unknown> };
/** Les voix clonées du compte. Vide par défaut : personne n'en a. */
let voixClonees: { id: string; name: string }[];
let appelsValidation: string[];

beforeEach(() => {
  bibliotheque = {
    favoris: ['look-neon'],
    presets: [{ nom: 'Cours du samedi' }],
    banqueAudio: [{ cle: 'a.mp3' }],
    prononciations: [],
  };
  ecritures = [];
  reponseValidation = { statut: 200, corps: { ok: true } };
  voixClonees = [];
  appelsValidation = [];

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/autopilot/bibliotheque-creative')) {
      if (init?.method === 'PUT') {
        const corps = JSON.parse(String(init.body)) as { bibliotheque: Record<string, unknown> };
        ecritures.push(corps.bibliotheque);
        bibliotheque = corps.bibliotheque;
        return { ok: true, json: async () => ({ ok: true, bibliotheque }) };
      }
      return { ok: true, json: async () => ({ ok: true, bibliotheque }) };
    }
    if (String(url).includes('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: voixClonees }) };
    }
    if (String(url).includes('/validation')) {
      appelsValidation.push(String(url));
      return {
        ok: reponseValidation.statut === 200,
        status: reponseValidation.statut,
        json: async () => reponseValidation.corps,
      };
    }
    throw new Error(`appel inattendu : ${url}`);
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const attendreChargement = () => waitFor(
  () => expect(document.querySelector('[data-prononciation-ajouter]')).not.toBeNull(),
);

async function ajouterRegle(display: string, spoken: string) {
  fireEvent.click(document.querySelector('[data-prononciation-ajouter]')!);
  fireEvent.change(document.querySelector('[data-prononciation-display]')!, {
    target: { value: display },
  });
  fireEvent.change(document.querySelector('[data-prononciation-spoken]')!, {
    target: { value: spoken },
  });
  fireEvent.click(document.querySelector('[data-prononciation-confirmer]')!);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Gérer ses prononciations', () => {
  it('1.1 les règles déjà enregistrées sont affichées', async () => {
    bibliotheque.prononciations = [{ display: 'Afroboost', spoken: 'Afro boost' }];
    render(<PrononciationsPanel />);
    await waitFor(() => expect(
      document.querySelector('[data-prononciation="Afroboost"]'),
    ).not.toBeNull());
    expect(screen.getByText('Afro boost')).toBeTruthy();
  });

  it('1.2 ⚠️ UNE RÈGLE AJOUTÉE EST PERSISTÉE SANS EFFACER LE RESTE', async () => {
    /* La route remplace le document complet : n'envoyer que les
       prononciations effacerait favoris, presets et banque audio. */
    render(<PrononciationsPanel />);
    await attendreChargement();
    await ajouterRegle('Afroboost', 'Afro boost');

    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0].prononciations).toEqual([
      { display: 'Afroboost', spoken: 'Afro boost' },
    ]);
    expect(ecritures[0].favoris).toEqual(['look-neon']);
    expect(ecritures[0].presets).toEqual([{ nom: 'Cours du samedi' }]);
    expect(ecritures[0].banqueAudio).toEqual([{ cle: 'a.mp3' }]);
  });

  it('1.3 ⚠️ LA RÈGLE CHANGE L’APERÇU, JAMAIS LE TEXTE AFFICHÉ', async () => {
    render(<PrononciationsPanel />);
    await attendreChargement();

    const affiche = () => document.querySelector('[data-prononciations-exemple-display]')!.textContent!;
    const parle = () => document.querySelector('[data-prononciations-exemple-spoken]')!.textContent!;
    const avant = affiche();

    // Avant la règle : la normalisation générale s'applique déjà…
    expect(parle()).toContain('dix-huit heures trente');
    expect(parle()).toContain('vingt-cinq francs suisses');
    expect(parle()).toContain('Afroboost');

    await ajouterRegle('Afroboost', 'Afro boost');
    await waitFor(() => expect(parle()).toContain('Afro boost'));

    // …et le texte écrit n'a pas bougé d'un caractère.
    expect(affiche()).toBe(avant);
    expect(affiche()).toContain('Afroboost');
    expect(affiche()).toContain('18h30');
    expect(affiche()).toContain('25 CHF');
  });

  it('1.4 ⚠️ UN DOUBLON EST REFUSÉ, ET DIT POURQUOI', async () => {
    bibliotheque.prononciations = [{ display: 'Afroboost', spoken: 'Afro boost' }];
    render(<PrononciationsPanel />);
    await attendreChargement();

    fireEvent.click(document.querySelector('[data-prononciation-ajouter]')!);
    fireEvent.change(document.querySelector('[data-prononciation-display]')!, {
      target: { value: 'afroboost' },
    });
    fireEvent.change(document.querySelector('[data-prononciation-spoken]')!, {
      target: { value: 'Autre chose' },
    });

    expect(document.querySelector('[data-prononciation-doublon]')).not.toBeNull();
    expect((document.querySelector('[data-prononciation-confirmer]') as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(document.querySelector('[data-prononciation-confirmer]')!);
    expect(ecritures).toEqual([]);
  });

  it('1.5 modifier une prononciation n’écrit que la nouvelle valeur', async () => {
    bibliotheque.prononciations = [{ display: 'Afroboost', spoken: 'Afro boost' }];
    render(<PrononciationsPanel />);
    await waitFor(() => expect(
      document.querySelector('[data-prononciation-modifier="Afroboost"]'),
    ).not.toBeNull());

    fireEvent.click(document.querySelector('[data-prononciation-modifier="Afroboost"]')!);
    fireEvent.change(document.querySelector('[data-prononciation-edition]')!, {
      target: { value: 'A frobouste' },
    });
    fireEvent.click(screen.getByLabelText('Enregistrer'));

    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0].prononciations).toEqual([
      { display: 'Afroboost', spoken: 'A frobouste' },
    ]);
  });

  it('1.6 supprimer une prononciation la retire de la bibliothèque', async () => {
    bibliotheque.prononciations = [
      { display: 'Afroboost', spoken: 'Afro boost' },
      { display: 'Studiio', spoken: 'Studio' },
    ];
    render(<PrononciationsPanel />);
    await waitFor(() => expect(
      document.querySelector('[data-prononciation-supprimer="Studiio"]'),
    ).not.toBeNull());

    fireEvent.click(document.querySelector('[data-prononciation-supprimer="Studiio"]')!);
    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0].prononciations).toEqual([
      { display: 'Afroboost', spoken: 'Afro boost' },
    ]);
  });

  it('1.7 ⚠️ LA LIMITE EST TENUE, ET ELLE EST EXPLIQUÉE', async () => {
    bibliotheque.prononciations = Array.from(
      { length: PRONONCIATIONS_MAX },
      (_, i) => ({ display: `mot${i}`, spoken: `mo ${i}` }),
    );
    render(<PrononciationsPanel />);
    await attendreChargement();

    expect((document.querySelector('[data-prononciation-ajouter]') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(document.querySelector('[data-prononciations-plein]')).not.toBeNull();
  });

  it('1.8 la longueur d’une règle est bornée par le champ lui-même', async () => {
    render(<PrononciationsPanel />);
    await attendreChargement();
    fireEvent.click(document.querySelector('[data-prononciation-ajouter]')!);
    for (const sel of ['[data-prononciation-display]', '[data-prononciation-spoken]']) {
      expect((document.querySelector(sel) as HTMLInputElement).maxLength)
        .toBe(PRONONCIATION_LONGUEUR_MAX);
    }
  });

  it('1.9 ⚠️ « ÉCOUTER » NE SUBSTITUE JAMAIS UNE VOIX GÉNÉRIQUE', async () => {
    /* Sans voix clonée, le bouton reste inerte et l'écran dit ce qui manque.
       Faire parler un catalogue en l'appelant « votre voix » serait un
       mensonge que personne ne pourrait vérifier à l'oreille. */
    render(<PrononciationsPanel />);
    await attendreChargement();
    await waitFor(() => expect(
      document.querySelector('[data-prononciations-sans-voix]'),
    ).not.toBeNull());

    const bouton = document.querySelector('[data-prononciations-ecouter]') as HTMLButtonElement;
    expect(bouton).not.toBeNull();
    expect(bouton.disabled).toBe(true);
    expect(document.querySelector('[data-prononciations-sans-voix]')!.textContent)
      .toContain('Configurez votre voix');
    expect(document.querySelector('[data-prononciations-avec-voix]')).toBeNull();
  });

  it('1.10 avec une voix clonée, c’est elle qui est nommée', async () => {
    voixClonees = [{ id: 'elevenlabs-x', name: 'Bassi' }];
    render(<PrononciationsPanel />);
    await waitFor(() => expect(
      document.querySelector('[data-prononciations-avec-voix]'),
    ).not.toBeNull());
    expect(document.querySelector('[data-prononciations-avec-voix]')!.textContent)
      .toContain('Bassi');
    // ⚠️ ET L'ÉCOUTE RESTE FERMÉE : aucun moteur n'est appelé dans ce lot.
    expect((document.querySelector('[data-prononciations-ecouter]') as HTMLButtonElement).disabled)
      .toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. L’écran de clone ne montre que ce qui existe', () => {
  const monter = (props: Partial<React.ComponentProps<typeof CloneVideoPanel>> = {}) => render(
    <CloneVideoPanel
      avatarId="cccccccc-3333-4333-8333-333333333333"
      statut={ETAT_SOURCE_PRETE}
      onInscrit={() => {}}
      {...props}
    />,
  );

  it('2.1 ⚠️ AUCUN APERÇU N’EST AFFICHÉ QUAND AUCUN CLONE N’EXISTE', () => {
    /* Le piège du lot : occuper le vide avec un mannequin ou une vignette
       « à titre indicatif ». Ici, aucun élément vidéo n'est monté. */
    const { container } = monter();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-clone-prete]')).not.toBeNull();
    expect(container.textContent).toContain('Aucun aperçu de votre clone n’existe encore');
  });

  it('2.2 ⚠️ « JE VALIDE MON CLONE » N’EXISTE PAS SUR UNE SIMPLE SOURCE', () => {
    const { container } = monter();
    expect(container.querySelector('[data-clone-valider]')).toBeNull();
    expect(container.querySelector('[data-clone-a-valider]')).toBeNull();
  });

  it('2.3 un entraînement en cours est annoncé comme tel', () => {
    const { container } = monter({ statut: 'processing', providerAvatarId: 'hg_1' });
    expect(container.querySelector('[data-clone-entrainement]')).not.toBeNull();
    expect(container.querySelector('[data-clone-valider]')).toBeNull();
  });

  it('2.4 un clone entraîné AVEC APERÇU propose la validation, et l’envoie', async () => {
    const { container } = monter({
      statut: 'completed', providerAvatarId: 'hg_1',
      apercuUrl: 'https://x/apercu.mp4',
    });
    const bouton = container.querySelector('[data-clone-valider]') as HTMLButtonElement;
    expect(bouton).not.toBeNull();
    fireEvent.click(bouton);
    await waitFor(() => expect(appelsValidation.length).toBe(1));
    expect(appelsValidation[0]).toContain('/api/avatar/cccccccc-3333-4333-8333-333333333333/validation');
  });

  it('2.5 ⚠️ UN REFUS DU SERVEUR EST AFFICHÉ, PAS CONTOURNÉ', async () => {
    /* Le navigateur ne sait pas si un aperçu réel existe : seul le serveur le
       sait, et son motif est ce que la personne doit lire. */
    reponseValidation = {
      statut: 409,
      corps: { ok: false, motif: 'apercu_absent', error: 'Un aperçu de votre clone doit être généré avant validation.' },
    };
    const { container } = monter({
      statut: 'completed', providerAvatarId: 'hg_1',
      apercuUrl: 'https://x/apercu.mp4',
    });
    fireEvent.click(container.querySelector('[data-clone-valider]')!);
    await waitFor(() => expect(container.textContent)
      .toContain('Un aperçu de votre clone doit être généré avant validation.'));
  });

  it('2.6 ⚠️ ENTRAÎNÉ MAIS SANS APERÇU : PAS DE BOUTON, ET ON DIT POURQUOI', () => {
    /* Accepter sans avoir vu, c'est signer pour ce qu'on n'a pas regardé. Le
       serveur refuserait de toute façon — l'écran ne doit pas proposer un
       geste dont il sait déjà qu'il sera rejeté. */
    const { container } = monter({ statut: 'completed', providerAvatarId: 'hg_1' });
    expect(container.querySelector('[data-clone-valider]')).toBeNull();
    expect(container.querySelector('[data-clone-apercu]')).toBeNull();
    expect(container.querySelector('[data-clone-sans-apercu]')).not.toBeNull();
  });

  it('2.7 ⚠️ L’APERÇU AFFICHÉ EST EXACTEMENT CELUI DU FOURNISSEUR', () => {
    /* La seule vidéo montée dans cet état porte l'URL reçue du serveur — pas
       une vignette de remplacement, pas la source de référence. */
    const { container } = monter({
      statut: 'completed', providerAvatarId: 'hg_1',
      apercuUrl: 'https://x/apercu.mp4',
    });
    const videos = [...container.querySelectorAll('video')];
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute('src')).toBe('https://x/apercu.mp4');
    expect(videos[0].hasAttribute('data-clone-apercu')).toBe(true);
  });

  it('2.8 une URL vide n’est pas un aperçu', () => {
    const { container } = monter({
      statut: 'completed', providerAvatarId: 'hg_1', apercuUrl: '',
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-clone-valider]')).toBeNull();
  });

  it('2.9 un clone déjà validé le dit, et ne redemande rien', () => {
    const { container } = monter({
      statut: 'completed', providerAvatarId: 'hg_1', valideLe: '2026-09-09T12:00:00Z',
      apercuUrl: 'https://x/apercu.mp4',
    });
    expect(container.querySelector('[data-clone-valide]')).not.toBeNull();
    expect(container.querySelector('[data-clone-valider]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Recommencer avec une autre vidéo', () => {
  const monter = () => render(
    <CloneVideoPanel
      avatarId="cccccccc-3333-4333-8333-333333333333"
      statut={ETAT_SOURCE_PRETE}
      onInscrit={() => {}}
    />,
  );

  it('3.1 ⚠️ LE REMPLACEMENT EST UN GESTE DÉLIBÉRÉ', () => {
    /* Les trois sources ne sont pas offertes en permanence : une inscription
       existe, et la reprendre par inadvertance détruirait la précédente. */
    const { container } = monter();
    expect(container.querySelector('[data-clone-importer]')).toBeNull();
    expect(container.querySelector('[data-clone-recommencer]')).not.toBeNull();
  });

  it('3.2 le clic rouvre les trois sources', () => {
    const { container } = monter();
    fireEvent.click(container.querySelector('[data-clone-recommencer]')!);
    expect(container.querySelector('[data-clone-enregistrer]')).not.toBeNull();
    expect(container.querySelector('[data-clone-importer]')).not.toBeNull();
    expect(container.querySelector('[data-clone-bibliotheque]')).not.toBeNull();
  });

  it('3.3 ⚠️ LA CONSÉQUENCE EST ANNONCÉE AVANT LE CHOIX', () => {
    // Remplacer supprime l'ancienne vidéo. Le dire après coup serait tard.
    const { container } = monter();
    fireEvent.click(container.querySelector('[data-clone-recommencer]')!);
    expect(container.querySelector('[data-clone-remplacement-avis]')!.textContent)
      .toContain('supprimée');
  });
});
