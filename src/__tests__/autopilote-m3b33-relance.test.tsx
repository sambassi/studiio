import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { relanceCoherente } from '@/lib/autopilot/analyse/presentation';
import type {
  AnalyseEcran, LectureAnalyse, ReponseLancement,
} from '@/lib/autopilot/analyse/passerelle';

/**
 * M3-B3.3 — RELANCER UNE ANALYSE RÉUSSIE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER DEMANDE AU PRODUIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aujourd'hui `AnalyseRush.tsx` propose « Relancer l’analyse » sur `echouee`
 * (quand le motif le permet) et sur `annulee`, mais sur `reussie` il ne
 * propose RIEN. Une mesure réussie est pourtant exactement ce qu'on veut
 * refaire quand le fichier a été remplacé, quand la sonde était le repli
 * `ffmpeg` faute de `ffprobe`, ou quand une étape d'interprétation vient
 * d'être installée : le résultat affiché est vrai, mais il est vieux.
 *
 * Le lot n'ajoute AUCUNE route. `POST …/analyse` existe déjà et c'est lui que
 * le bouton appelle — le même que « Analyser ». Ce fichier ne teste donc que
 * l'écran.
 *
 * ⚠️ LES ASSERTIONS DU GROUPE B SONT ROUGES AVANT LE LOT. C'est leur raison
 * d'être : `tasks/lessons.md` rappelle qu'un test incapable d'échouer quand
 * le produit est cassé ne vérifie rien. Tout le reste — A, C, D, E — doit
 * être vert AVANT comme APRÈS, et prouve qu'aucun comportement existant
 * n'est emporté par l'ajout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST DOUBLÉ, ET POURQUOI SEULEMENT ÇA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La frontière réseau du composant est `analyse/passerelle` : `lireAnalyse`
 * (GET) et `lancerAnalyse` (POST). Elles seules sont doublées ; tout le reste
 * du module — `analyseEnCours`, `conduiteApresLancement`, `vignettesAffichables`,
 * `DELAI_SUIVI_MS` — reste le VRAI code, par `importOriginal`. Doubler
 * `conduiteApresLancement` aurait fait passer les tests avec une conduite
 * inventée pour l'occasion, alors que c'est précisément elle qui décide
 * qu'un 201 se relit et qu'un 422 ne se relance pas.
 *
 * Aucun `fetch` réel : le global est remplacé par une fonction qui échoue
 * bruyamment, de sorte qu'un appel oublié se voie au lieu de partir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES MINUTERIES SONT VRAIES, ET C'EST DÉLIBÉRÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `autopilote-m3b3-panneau.test.tsx` fige le temps parce qu'il MESURE le
 * suivi périodique (combien de lectures en neuf secondes). Ici, aucun test ne
 * mesure le temps : on attend un rendu, on clique, on compte des appels. Le
 * temps réel permet alors `waitFor` / `findBy`, qui sous Vitest ne savent pas
 * avancer une horloge factice (ils cherchent `jest`) et attendraient pour
 * toujours.
 *
 * Le sondage reste néanmoins un piège sur `en_attente` et `en_cours` : le
 * composant ré-arme un tour toutes les `DELAI_SUIVI_MS` (3 s). Les tests de
 * ces deux états se concluent en quelques millisecondes et `cleanup()`
 * démonte avant le premier ré-armement — la minuterie est alors annulée par
 * le composant lui-même. Le compteur d'appels est vérifié pour que la
 * moindre boucle se voie.
 */

// ─────────────────────────────────────────────────────────────────────────
// Les quatre modules que cet écran ne doit JAMAIS toucher
// ─────────────────────────────────────────────────────────────────────────

/**
 * Chaque fabrique enregistre le fait d'avoir été ÉVALUÉE. Vitest n'évalue la
 * fabrique d'un `vi.mock` que si le module est réellement importé : un
 * tableau resté vide prouve que ni `AnalyseRush`, ni rien de ce qu'il importe
 * transitivement, n'a fait entrer l'IA, les crédits, le rendu ou la
 * publication dans le graphe. La preuve est dynamique ; le groupe E la double
 * par une lecture du source, parce qu'un module peut être atteint sans être
 * nommé, et nommé sans être atteint.
 */
const interdits = vi.hoisted(() => ({ touches: [] as string[] }));

vi.mock('@/lib/ai/extract-text', () => {
  interdits.touches.push('@/lib/ai/extract-text');
  return {};
});
vi.mock('@/lib/credits/system', () => {
  interdits.touches.push('@/lib/credits/system');
  return {};
});
vi.mock('@/lib/autopilot/render', () => {
  interdits.touches.push('@/lib/autopilot/render');
  return {};
});
vi.mock('@/lib/social/publishing', () => {
  interdits.touches.push('@/lib/social/publishing');
  return {};
});

// ─────────────────────────────────────────────────────────────────────────
// La doublure de la frontière réseau — et d'elle seule
// ─────────────────────────────────────────────────────────────────────────

const reseau = vi.hoisted(() => ({
  lireAnalyse: vi.fn(),
  lancerAnalyse: vi.fn(),
}));

vi.mock('@/lib/autopilot/analyse/passerelle', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/autopilot/analyse/passerelle')>();
  return { ...reel, lireAnalyse: reseau.lireAnalyse, lancerAnalyse: reseau.lancerAnalyse };
});

// eslint-disable-next-line import/first
import AnalyseRush from '@/components/creer/AnalyseRush';

const RUSH = 'rush-m3b33';

/** Une analyse complète, dont on ne change que ce que le test regarde. */
function analyse(p: Partial<AnalyseEcran> = {}): AnalyseEcran {
  return {
    id: 'a-1',
    version: 1,
    etat: 'reussie',
    etape: null,
    fournisseurs: {},
    dureeSecondes: 92.4,
    technique: {
      sonde: 'ffprobe',
      conteneur: 'mov,mp4,m4a',
      codecVideo: 'h264',
      largeur: 1080,
      hauteur: 1920,
      fps: 29.97,
      bitrate: 8_400_000,
      aAudio: true,
      codecAudio: 'aac',
      canauxAudio: 2,
      frequenceAudio: 48_000,
      tailleOctets: 734_003_200,
    },
    resume: null,
    textesVisibles: [],
    parole: {},
    audio: {},
    qualite: {},
    // Zéro vignette : les images ne sont pas le sujet du lot, et jsdom ne
    // charge de toute façon aucun `<img>`.
    vignettes: { nombre: 0, secondes: [] },
    motifEchec: null,
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:01:00.000Z',
    ...p,
  };
}

function lancement(p: Partial<ReponseLancement> = {}): ReponseLancement {
  return {
    statut: 201, motif: null, message: null, retryApresSecondes: null, injoignable: false, ...p,
  };
}

/** Le serveur rend toujours la même chose, jusqu'à ce qu'on en change. */
function serveurRend(l: LectureAnalyse) {
  reseau.lireAnalyse.mockImplementation(async () => l);
}

function serveurRendAnalyse(p: Partial<AnalyseEcran> = {}) {
  serveurRend({ sorte: 'trouvee', analyse: analyse(p) });
}

beforeEach(() => {
  reseau.lireAnalyse.mockReset();
  reseau.lancerAnalyse.mockReset();
  serveurRend({ sorte: 'aucune' });
  reseau.lancerAnalyse.mockImplementation(async () => lancement());
  // Un `fetch` qui part d'ici serait un chemin réseau non doublé : on veut
  // qu'il casse le test, pas qu'il sorte de la machine.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('aucun fetch réel ne doit partir de ce fichier de test');
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────
// Lire l'écran
// ─────────────────────────────────────────────────────────────────────────

function bloc(): HTMLElement {
  const e = document.querySelector('[data-analyse-rush]');
  expect(e, 'le composant doit être monté').toBeTruthy();
  return e as HTMLElement;
}

function etat(): string | null {
  return bloc().getAttribute('data-analyse-etat');
}

function texte(): string {
  return bloc().textContent ?? '';
}

/**
 * Le bouton de lancement, quel que soit son libellé.
 *
 * ⚠️ ON NE CHERCHE PAS PAR TEXTE. Les libellés du composant portent
 * l'apostrophe TYPOGRAPHIQUE (« Relancer l’analyse », U+2019) et non
 * l'apostrophe droite : un `getByText("Relancer l'analyse")` échouerait pour
 * une raison qui n'a rien à voir avec le produit. `data-analyse-lancer` est
 * l'attribut que le composant pose déjà, et il dit en plus s'il s'agit d'une
 * première fois ou d'une relance. Les rares vérifications de libellé se font
 * par expression régulière tolérante aux deux apostrophes.
 */
function bouton(): HTMLButtonElement | null {
  return document.querySelector('[data-analyse-lancer]');
}

const LIBELLE_RELANCE = /Relancer\s+l['’]analyse/;

/**
 * COMBIEN de boutons de lancement, et pas seulement « y en a-t-il un ».
 *
 * `bouton()` rend le PREMIER du document : un doublon lui échapperait
 * entièrement, et c'est exactement la faute qu'on cherche à interdire ici.
 * L'invariant du composant est un COMPTE — sur une analyse réussie, un
 * bouton, jamais zéro, jamais deux — et un compte ne se vérifie qu'en
 * comptant.
 */
function boutons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('[data-analyse-lancer]'));
}

async function monter(rushId = RUSH) {
  const rendu = render(<AnalyseRush rushId={rushId} />);
  // La fin du chargement, attendue et non dormie : le composant retire son
  // « Statut de l’analyse… » dès que la première lecture est revenue.
  await waitFor(() => expect(etat()).not.toBe('chargement'));
  // ⚠️ LES APERÇUS SONT POSÉS PAR UN SECOND EFFET, pas par la lecture.
  //
  // `waitFor` rend la main dès que le STATUT change ; l'effet qui calcule les
  // vignettes est validé au rendu suivant. Les trois assertions immédiates
  // ci-dessous — « 3 aperçus », « 0 aperçu », « 8 aperçus » — lisaient donc un
  // DOM qui n'avait pas fini de se poser, et ne passaient que parce que
  // l'effet gagnait la course. Sur un agent de CI chargé, il la perdait :
  // « expected +0 to be 3 ». La plus trompeuse était celle qui attend 0, qui
  // passait pour la mauvaise raison — l'état AVANT l'effet vaut aussi 0.
  //
  // Ce vidage rend la main à React pour ses effets en attente. Ce n'est ni un
  // délai, ni une attente allongée : les assertions restent identiques, elles
  // lisent simplement un rendu stabilisé.
  await act(async () => { await Promise.resolve(); });
  return rendu;
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — la première analyse reste une première analyse', () => {
  it('aucune analyse : « Analyser », et surtout pas « Relancer »', async () => {
    serveurRend({ sorte: 'aucune' });
    await monter();
    expect(etat()).toBe('aucune');
    const b = bouton();
    expect(b).toBeTruthy();
    expect(b?.getAttribute('data-analyse-lancer')).toBe('premiere');
    expect(b?.textContent ?? '').toContain('Analyser');
    expect(b?.textContent ?? '').not.toMatch(LIBELLE_RELANCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — ce que le lot M3-B3.3 ajoute (ROUGE avant le lot)', () => {
  it('reussie : un bouton « Relancer l’analyse » est proposé', async () => {
    serveurRendAnalyse({ etat: 'reussie' });
    await monter();
    expect(etat()).toBe('reussie');

    const b = bouton();
    expect(b, 'une analyse réussie doit pouvoir être relancée').toBeTruthy();
    expect(b?.getAttribute('data-analyse-lancer')).toBe('relance');
    expect(b?.textContent ?? '').toMatch(LIBELLE_RELANCE);
  });

  it('reussie : le résultat précédent RESTE affiché à côté du bouton', async () => {
    // Le piège de conception que ce test ferme : remplacer le bloc de
    // résultat par un bouton ferait disparaître la mesure qu'on veut
    // justement comparer à la suivante. Le bouton s'AJOUTE, il ne se
    // substitue pas.
    serveurRendAnalyse({ etat: 'reussie' });
    await monter();

    const b = bouton();
    expect(b, 'le bouton de relance doit exister').toBeTruthy();

    expect(document.querySelector('[data-analyse-badge]')?.textContent).toContain('Analysé');
    expect(document.querySelector('[data-analyse-technique]')).toBeTruthy();
    const t = texte();
    expect(t).toContain('1 min 32 s');      // la durée mesurée
    expect(t).toContain('1080 × 1920');     // les dimensions mesurées
    expect(t).toContain('h264');            // le codec mesuré

    // Et le bouton est bien DANS le même bloc de résultat, pas ailleurs
    // dans la page.
    expect(bloc().contains(b as Node)).toBe(true);
  });

  it('reussie : le clic envoie EXACTEMENT un POST, sur le bon rush', async () => {
    serveurRendAnalyse({ etat: 'reussie' });
    await monter('rush-precis');

    const b = bouton();
    expect(b, 'le bouton de relance doit exister').toBeTruthy();
    await act(async () => { fireEvent.click(b as Element); });

    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
    expect(reseau.lancerAnalyse).toHaveBeenCalledWith('rush-precis');
  });

  it('reussie : pendant la requête, le bouton est bloqué et deux clics n’en font qu’un', async () => {
    serveurRendAnalyse({ etat: 'reussie' });
    await monter();

    let debloquer: (r: ReponseLancement) => void = () => {};
    reseau.lancerAnalyse.mockImplementation(
      () => new Promise<ReponseLancement>((r) => { debloquer = r; }),
    );

    const b = bouton();
    expect(b, 'le bouton de relance doit exister').toBeTruthy();
    // Deux clics dans le MÊME tour : c'est le cas que l'état React ne
    // rattraperait pas, seul le garde-fou par `ref` le peut.
    await act(async () => {
      fireEvent.click(b as Element);
      fireEvent.click(b as Element);
    });

    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
    expect((bouton() as HTMLButtonElement).disabled).toBe(true);
    expect(texte()).toContain('Analyse demandée');

    // Puis la réponse arrive : on relit, et l'écran se remet à jour.
    serveurRendAnalyse({ etat: 'reussie', id: 'a-2', dureeSecondes: 30 });
    await act(async () => { debloquer(lancement({ statut: 201 })); await Promise.resolve(); });
    await waitFor(() => expect(texte()).toContain('30 s'));
    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B2 — ce que la relance rend atteignable : les aperçus d une version', () => {
  /**
   * ⚠️ CE BLOC EXISTE PARCE QUE LE BOUTON CRÉE LA SITUATION.
   *
   * Le chargement des aperçus sortait avant tout, sans rien changer, quand
   * l'analyse réussie n'en portait aucun. Tant qu'on ne pouvait relancer que
   * depuis `echouee` ou `annulee` — deux états où l'écran ne montre jamais
   * d'image — cela n'avait aucune conséquence observable. Depuis `reussie`,
   * la transition « huit aperçus » → « aucun aperçu » devient ordinaire :
   * c'est même exactement le rush qu'on relance, celui dont la mesure a
   * réussi et dont les huit vignettes ont échoué.
   */
  it('reussie avec aperçus → reussie sans aperçu : plus une seule image', async () => {
    serveurRendAnalyse({
      etat: 'reussie', id: 'a-1',
      vignettes: { nombre: 3, secondes: [1, 2, 3] },
    });
    await monter();
    expect(document.querySelectorAll('[data-analyse-vignette]').length, 'la version 1 montre ses aperçus').toBe(3);

    // La version 2 : même rush, mesure réussie, aucun aperçu produit.
    serveurRendAnalyse({ etat: 'reussie', id: 'a-2', vignettes: { nombre: 0, secondes: [] } });
    const b = bouton();
    await act(async () => { fireEvent.click(b as Element); });

    await waitFor(() => expect(document.querySelector('[data-analyse-vignettes]')).toBeNull());
    expect(
      document.querySelectorAll('[data-analyse-vignette]').length,
      'les aperçus de la version précédente ne survivent pas à la suivante',
    ).toBe(0);
    // Et la mesure, elle, est bien celle de la nouvelle version.
    expect(etat()).toBe('reussie');
  });

  it('reussie sans aperçu → reussie avec aperçus : les images arrivent', async () => {
    // Le sens inverse fonctionnait déjà ; il doit continuer.
    serveurRendAnalyse({ etat: 'reussie', id: 'a-1', vignettes: { nombre: 0, secondes: [] } });
    await monter();
    expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(0);

    serveurRendAnalyse({
      etat: 'reussie', id: 'a-2',
      vignettes: { nombre: 2, secondes: [4, 8] },
    });
    await act(async () => { fireEvent.click(bouton() as Element); });

    await waitFor(() => expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(2));
  });

  it('le plafond de huit tient, quoi qu annonce le serveur', async () => {
    serveurRendAnalyse({
      etat: 'reussie', id: 'a-1',
      vignettes: { nombre: 40, secondes: Array.from({ length: 40 }, (_, i) => i) },
    });
    await monter();
    expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B3 — sur une analyse réussie : EXACTEMENT un bouton, quoi qu il arrive', () => {
  /**
   * ⚠️ CE BLOC EXISTE PARCE QUE LA PREMIÈRE ÉCRITURE DU GARDE ÉTAIT FAUSSE.
   *
   * Le bouton de la carte cédait la place dès qu'un refus existait —
   * `!refus`. Or le bloc de refus ne porte son propre bouton que si le refus
   * est RELANÇABLE. Sur un refus définitif, il n'y avait donc plus aucun
   * bouton nulle part ; et comme `refus` n'est remis à `null` que par le
   * gestionnaire de clic, et que le sondage est arrêté sur un état terminal,
   * plus rien ne pouvait le lever. Une session expirée condamnait l'écran
   * jusqu'au rechargement de la page.
   *
   * Ce que ces tests verrouillent n'est donc pas « un bouton existe » mais
   * un COMPTE, dans les quatre situations possibles.
   */

  /** Joue un clic dont le POST est refusé, et rend l'état de l'écran après. */
  async function refusApresClic(reponse: Partial<ReponseLancement>) {
    serveurRendAnalyse({ etat: 'reussie' });
    await monter();
    expect(boutons()).toHaveLength(1);
    reseau.lancerAnalyse.mockResolvedValue(lancement(reponse));
    await act(async () => { fireEvent.click(bouton() as Element); });
  }

  it('aucun refus : un seul bouton, celui de la carte', async () => {
    serveurRendAnalyse({ etat: 'reussie' });
    await monter();
    const b = boutons();
    expect(b).toHaveLength(1);
    expect(b[0].getAttribute('data-analyse-lancer')).toBe('relance');
    expect(b[0].textContent ?? '').toMatch(LIBELLE_RELANCE);
  });

  it('refus RELANÇABLE (429) : un seul bouton, celui du bloc de refus', async () => {
    // La capacité est prise. Le bloc de refus porte « Réessayer » ; la carte
    // s'efface pour ne pas offrir deux fois le même geste sous deux mots.
    await refusApresClic({ statut: 429, retryApresSecondes: 300 });

    const b = boutons();
    expect(b, 'un seul geste proposé, pas deux').toHaveLength(1);
    expect(b[0].textContent ?? '').toContain('Réessayer');
    expect(b[0].textContent ?? '').not.toMatch(LIBELLE_RELANCE);
    // Et la mesure reste lisible sous le message de refus.
    expect(document.querySelector('[data-analyse-technique]')).toBeTruthy();
  });

  it('refus NON relançable (401 session expirée) : le bouton de la carte reste', async () => {
    // Le cas qui condamnait l'écran. L'utilisateur se reconnecte : il doit
    // retrouver de quoi relancer, sans recharger la page.
    await refusApresClic({ statut: 401 });

    const b = boutons();
    expect(b, 'un refus définitif ne doit pas retirer le dernier geste').toHaveLength(1);
    expect(b[0].getAttribute('data-analyse-lancer')).toBe('relance');
    expect(b[0].textContent ?? '').toMatch(LIBELLE_RELANCE);
    expect((b[0] as HTMLButtonElement).disabled, 'et il est de nouveau cliquable').toBe(false);
  });

  it('refus NON relançable (422 fichier inexploitable) : le bouton de la carte reste', async () => {
    await refusApresClic({ statut: 422, message: 'Ce fichier ne peut pas être analysé.' });

    const b = boutons();
    expect(b).toHaveLength(1);
    expect(b[0].getAttribute('data-analyse-lancer')).toBe('relance');
    expect(texte()).toContain('ne peut pas être analysé');
  });

  it('après un refus définitif, le bouton REPART : l écran n est pas condamné', async () => {
    // La preuve que le geste est réellement rendu, et pas seulement dessiné :
    // un second clic doit atteindre le réseau.
    await refusApresClic({ statut: 401 });
    reseau.lancerAnalyse.mockClear();
    reseau.lancerAnalyse.mockResolvedValue(lancement({ statut: 201 }));

    await act(async () => { fireEvent.click(bouton() as Element); });
    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
    expect(reseau.lancerAnalyse).toHaveBeenCalledWith(RUSH);
  });

  it('le double clic reste protégé, y compris après un refus définitif', async () => {
    await refusApresClic({ statut: 401 });
    reseau.lancerAnalyse.mockClear();
    let debloquer: (r: ReponseLancement) => void = () => {};
    reseau.lancerAnalyse.mockImplementation(
      () => new Promise<ReponseLancement>((r) => { debloquer = r; }),
    );

    const b = bouton();
    await act(async () => {
      fireEvent.click(b as Element);
      fireEvent.click(b as Element);
    });
    expect(reseau.lancerAnalyse, 'deux clics du même tour, un seul appel').toHaveBeenCalledTimes(1);
    expect((bouton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { debloquer(lancement({ statut: 201 })); await Promise.resolve(); });
    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
  });

  it('les autres états gardent leur compte : 0 pendant le travail, 1 sinon', async () => {
    // Le compte, état par état — un doublon ou une disparition ailleurs que
    // sous `reussie` se verrait ici, et nulle part ailleurs dans le dépôt.
    for (const [etatTeste, attendu] of [
      ['en_attente', 0], ['en_cours', 0], ['annulee', 1], ['reussie', 1],
    ] as const) {
      serveurRendAnalyse({ etat: etatTeste });
      const { unmount } = await monter();
      expect(boutons(), `état ${etatTeste}`).toHaveLength(attendu);
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — les relances qui existaient déjà ne bougent pas', () => {
  it('le motif choisi ici EST relançable selon la règle du produit', () => {
    // Le motif n'est pas inventé : c'est `relanceCoherente` qui le classe.
    expect(relanceCoherente('stockage_injoignable')).toBe(true);
    expect(relanceCoherente('format_illisible')).toBe(false);
  });

  it('echouee, motif relançable : « Relancer l’analyse »', async () => {
    serveurRendAnalyse({
      etat: 'echouee', motifEchec: 'stockage_injoignable', dureeSecondes: null,
    });
    await monter();
    expect(etat()).toBe('echouee');
    expect(texte()).toContain('stockage était momentanément injoignable');
    const b = bouton();
    expect(b).toBeTruthy();
    expect(b?.getAttribute('data-analyse-lancer')).toBe('relance');
    expect(b?.textContent ?? '').toMatch(LIBELLE_RELANCE);
  });

  it('echouee, motif définitif : AUCUN bouton', async () => {
    serveurRendAnalyse({
      etat: 'echouee', motifEchec: 'format_illisible', dureeSecondes: null,
    });
    await monter();
    expect(etat()).toBe('echouee');
    expect(texte()).toContain('n’est pas une vidéo exploitable');
    // Recommencer rendrait le même verdict : proposer serait mentir.
    expect(bouton()).toBeNull();
  });

  it('annulee : « Relancer l’analyse », et le clic part bien', async () => {
    serveurRendAnalyse({ etat: 'annulee', dureeSecondes: null });
    await monter();
    expect(etat()).toBe('annulee');
    expect(texte()).toContain('Analyse annulée');
    const b = bouton();
    expect(b?.getAttribute('data-analyse-lancer')).toBe('relance');

    await act(async () => { fireEvent.click(b as Element); });
    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
    expect(reseau.lancerAnalyse).toHaveBeenCalledWith(RUSH);
  });

  it('annulee : deux clics rapprochés n’envoient qu’un seul POST', async () => {
    // Le même scénario que le groupe B, mais sur un chemin qui EXISTE
    // aujourd'hui : s'il devenait rouge, ce serait l'outillage du fichier
    // qui est en cause, pas la fonction manquante.
    serveurRendAnalyse({ etat: 'annulee', dureeSecondes: null });
    await monter();

    let debloquer: (r: ReponseLancement) => void = () => {};
    reseau.lancerAnalyse.mockImplementation(
      () => new Promise<ReponseLancement>((r) => { debloquer = r; }),
    );

    const b = bouton() as Element;
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });

    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
    expect((bouton() as HTMLButtonElement).disabled).toBe(true);
    expect(texte()).toContain('Analyse demandée');

    serveurRendAnalyse({ etat: 'reussie' });
    await act(async () => { debloquer(lancement({ statut: 201 })); await Promise.resolve(); });
    await waitFor(() => expect(etat()).toBe('reussie'));
    expect(reseau.lancerAnalyse).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — une analyse en train de se faire ne se relance pas', () => {
  for (const cas of [
    { etat: 'en_attente' as const, etape: null, attendu: 'Analyse en attente' },
    { etat: 'en_cours' as const, etape: 'extraction' as const, attendu: 'Extraction des informations' },
  ]) {
    it(`${cas.etat} : aucun bouton ne permet d’en lancer une seconde`, async () => {
      serveurRendAnalyse({ etat: cas.etat, etape: cas.etape, dureeSecondes: null });
      await monter();
      expect(etat()).toBe(cas.etat);
      expect(texte()).toContain(cas.attendu);

      // ⚠️ LE POINT DU TEST. Un second lancement pendant qu'une analyse
      // tourne prendrait un 409 et aurait consommé une place d'extraction
      // pour rien.
      expect(bouton()).toBeNull();
      expect(reseau.lancerAnalyse).not.toHaveBeenCalled();

      // Et le sondage n'est pas parti en boucle : une seule lecture a eu
      // lieu, celle du montage (le tour suivant est à 3 s, bien après).
      expect(reseau.lireAnalyse).toHaveBeenCalledTimes(1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — ni IA, ni crédit, ni rendu, ni publication', () => {
  it('aucun de ces quatre modules n’est entré dans le graphe', async () => {
    // Preuve dynamique : les fabriques de `vi.mock` n'ont jamais été
    // évaluées, donc les modules n'ont jamais été importés — ni par
    // `AnalyseRush`, ni par ce qu'il importe.
    await import('@/components/creer/AnalyseRush');
    expect(interdits.touches).toEqual([]);
  });

  it('et le source du composant ne les nomme nulle part', () => {
    // Les commentaires ont le droit de parler de ce qu'on ne fait pas ; seul
    // le code compte.
    const nu = (c: string) => readFileSync(c, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    const chemin = resolve(process.cwd(), 'src/components/creer/AnalyseRush.tsx');
    const code = nu(chemin);

    const INTERDITS = [
      /@\/lib\/credits|deduireCredits|deductCredits|debiterCredits/i,
      /autopilot\/render|renderMedia|remotion/i,
      /@\/lib\/ai\/|openai|anthropic|replicate|gpt-|claude-/i,
      /social\/publishing|publierSur|publishTo/i,
    ];

    for (const interdit of INTERDITS) {
      expect(code, `AnalyseRush.tsx ne doit pas contenir ${interdit}`).not.toMatch(interdit);
    }

    // ⚠️ ET SON UNIQUE ENFANT, POUR LA MÊME RAISON.
    //
    // `PassagesSuggeres` est entré dans l'arbre en M3-C. Sans cette boucle,
    // il serait un TROU dans la garde statique : il suffirait d'y écrire un
    // import interdit pour qu'aucun test de source ne le voie. La garde
    // dynamique juste au-dessus le couvre déjà de façon transitive ; les deux
    // se complètent plutôt qu'elles ne se doublent.
    const enfant = nu(resolve(process.cwd(), 'src/components/creer/PassagesSuggeres.tsx'));
    for (const interdit of INTERDITS) {
      expect(enfant, `PassagesSuggeres.tsx ne doit pas contenir ${interdit}`)
        .not.toMatch(interdit);
    }

    // La liste blanche d'imports : elle échoue le jour où un import arrive,
    // sans qu'il ait fallu deviner son nom à l'avance.
    const importes = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(importes)].sort()).toEqual([
      // M3-C : la section « Passages suggérés ». Le SEUL ajout depuis M3-B3,
      // et il est nommé — un import de plus refera rougir ce test.
      './PassagesSuggeres',
      '@/lib/autopilot/analyse/passerelle',
      '@/lib/autopilot/analyse/presentation',
      // LOT 1 : un import de TYPE seul (`AutopilotMontageStyle`), pour le
      // passe-plat du format et de la durée vers `PassagesSuggeres`. Effacé à
      // la compilation, il ne tire rien dans le paquet navigateur.
      '@/lib/autopilot/textStyle',
      'lucide-react',
      'react',
    ].sort());

    // L'enfant a SA propre liste blanche : il ne parle qu'à des passerelles,
    // qui sont des modules purs. Une arête vers `candidat.ts`,
    // `candidat-service.ts`, `candidat-anthropic.ts`, `clip-service.ts` ou
    // `rendu-ffmpeg.ts` tirerait MinIO, la base, ffmpeg ou la clé d'API dans
    // le paquet navigateur.
    const importesEnfant = [...enfant.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(importesEnfant)].sort()).toEqual([
      '@/lib/autopilot/analyse/candidat-passerelle',
      // P0.1 : le bouton « Créer ma vidéo ». `chaine-passerelle` n'enchaîne
      // que trois URL et n'importe RIEN à l'exécution — les vocabulaires
      // fermés n'y entrent que comme des types, effacés à la compilation.
      // C'est cette liste-ci qui a exigé de le vérifier avant de l'ajouter.
      '@/lib/autopilot/analyse/chaine-passerelle',
      // LOT 1 : le TYPE du réglage de montage (format + durée), reçu de son
      // parent et remis à la chaîne. Import de type, effacé à la compilation.
      '@/lib/autopilot/textStyle',
      'react',
    ].sort());
  });
});
