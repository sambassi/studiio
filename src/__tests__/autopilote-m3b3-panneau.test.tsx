import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import AnalyseRush from '@/components/creer/AnalyseRush';
import {
  conduiteApresLancement, analyseDepuisReponse, type ReponseLancement,
} from '@/lib/autopilot/analyse/passerelle';
import {
  formaterTechnique, formaterDuree, formaterOctets, nomResolution,
  relanceCoherente, messageEchec, phraseEnCours,
} from '@/lib/autopilot/analyse/presentation';

/**
 * L'écran d'analyse d'un rush — M3-B3.
 *
 * ⚠️ CES TESTS MONTENT LE COMPOSANT. Ils ne lisent pas son source et ne
 * comptent pas des lignes : `tasks/lessons.md` (2026-07-30) rappelle qu'un
 * test qui ne peut pas échouer quand le produit est cassé n'est pas une
 * vérification. Ce qui est vérifié ici, c'est ce que l'utilisateur VOIT et ce
 * que le serveur REÇOIT.
 *
 * Les minuteries sont fausses dans TOUS les tests, et `waitFor` n'est jamais
 * utilisé : sous Vitest, `waitFor` ne sait pas qu'un faux temps tourne (il
 * cherche `jest`), et attendrait un délai qui n'avance jamais. Le temps est
 * donc avancé à la main, ce qui rend chaque test déterministe.
 */

// ─────────────────────────────────────────────────────────────────────────
// Un serveur en carton, mais qui répond comme le vrai
// ─────────────────────────────────────────────────────────────────────────

interface Appel { methode: string; url: string }

let journal: Appel[] = [];
let analyseServeur: Record<string, unknown> | null = null;
let statutGet = 200;
let vignettesServeur: unknown[] | null = null;
let postSuivant: {
  status: number;
  corps: Record<string, unknown>;
  entetes?: Record<string, string>;
} = { status: 201, corps: { ok: true } };
/** Ce que le POST change sur le serveur — pour que le GET suivant le voie. */
let effetPost: (() => void) | null = null;

function reponse(status: number, corps: unknown, entetes: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => entetes[n] ?? null },
    json: async () => corps,
  } as unknown as Response;
}

/**
 * Les lectures de la route ANALYSE, et elles seules.
 *
 * ⚠️ TROIS ROUTES SE PARTAGENT CE PANNEAU, et les compter ensemble rendrait
 * ce fichier faux à chaque lot. `/vignettes` était déjà écarté ; `/candidats`
 * l'est depuis M3-C, qui affiche « Passages suggérés » sous une analyse
 * réussie.
 *
 * L'invariant historique n'est pas affaibli, il est RENDU EXACT : ce qui ne
 * doit pas repartir en boucle, c'est le SUIVI DE L'ANALYSE. Une lecture M3-C
 * qui se déclencherait en boucle ferait rougir `lecturesCandidats`, juste en
 * dessous — la garde n'a pas été retirée, elle a été dédoublée.
 */
function lectures(): Appel[] {
  return journal.filter((a) => a.methode === 'GET'
    && !a.url.endsWith('/vignettes')
    && !a.url.endsWith('/candidats'));
}

/** Les lectures de la route CANDIDATS — M3-C, comptées à part. */
function lecturesCandidats(): Appel[] {
  return journal.filter((a) => a.methode === 'GET' && a.url.endsWith('/candidats'));
}

function ecritures(): Appel[] {
  return journal.filter((a) => a.methode !== 'GET');
}

function analyse(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    rushId: 'r-1',
    version: 1,
    etat: 'reussie',
    etape: 'extraction',
    fournisseurs: { extraction: { fournisseur: 'local', modele: 'ffmpeg' } },
    dureeSecondes: 92.4,
    technique: {
      sonde: 'ffprobe',
      conteneur: 'mov,mp4,m4a',
      codecVideo: 'h264',
      largeur: 1080,
      hauteur: 1920,
      fps: 29.97,
      bitrate: 8_400_000,
      rotation: 90,
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
    vignettes: { nombre: 8, secondes: [0, 10, 20, 30, 40, 50, 60, 70] },
    motifEchec: null,
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:01:00.000Z',
    ...p,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  journal = [];
  analyseServeur = null;
  statutGet = 200;
  vignettesServeur = null;
  postSuivant = { status: 201, corps: { ok: true } };
  effetPost = null;

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const methode = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    journal.push({ methode, url: u });
    if (u.endsWith('/vignettes')) {
      if (vignettesServeur === null) return reponse(404, { ok: false });
      return reponse(200, { ok: true, vignettes: vignettesServeur });
    }
    if (methode === 'POST') {
      effetPost?.();
      return reponse(postSuivant.status, postSuivant.corps, postSuivant.entetes);
    }
    if (statutGet !== 200) {
      return reponse(statutGet, { ok: false, error: 'Statut de l’analyse indisponible.' });
    }
    return reponse(200, { ok: true, analyse: analyseServeur });
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Vide la file des microtâches — les `await` du composant, sans horloge. */
async function respirer() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function monter(rushId = 'r-1') {
  const rendu = render(<AnalyseRush rushId={rushId} />);
  await respirer();
  return rendu;
}

async function avancer(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await respirer();
}

function bloc(): HTMLElement {
  const e = document.querySelector('[data-analyse-rush]');
  expect(e).toBeTruthy();
  return e as HTMLElement;
}

function etat(): string | null {
  return bloc().getAttribute('data-analyse-etat');
}

function texte(): string {
  return bloc().textContent ?? '';
}

function bouton(): HTMLButtonElement | null {
  return document.querySelector('[data-analyse-lancer]');
}

async function cliquer() {
  const b = bouton();
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b as Element); });
  await respirer();
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — chaque état a son affichage, et un seul', () => {
  it('jamais analysé : un bouton « Analyser », et rien d’autre', async () => {
    analyseServeur = null;
    await monter();
    expect(etat()).toBe('aucune');
    expect(bouton()?.textContent).toContain('Analyser');
    expect(texte()).not.toContain('Analysé');
  });

  it('en_attente : l’écran dit que l’analyse attend, sans bouton', async () => {
    analyseServeur = analyse({ etat: 'en_attente', etape: null, dureeSecondes: null });
    await monter();
    expect(etat()).toBe('en_attente');
    expect(texte()).toContain('Analyse en attente');
    expect(bouton()).toBeNull();
  });

  it('en_cours : l’ÉTAPE est nommée en français, pas en jargon', async () => {
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    await monter();
    expect(etat()).toBe('en_cours');
    expect(texte()).toContain('Extraction des informations techniques');
    // L'étape brute reste disponible pour le DOM, pas pour l'œil.
    expect(document.querySelector('[data-analyse-etape="extraction"]')).toBeTruthy();
  });

  it('en_cours : AUCUN pourcentage, jamais — le serveur n’en connaît pas', async () => {
    // ⚠️ C'EST LA RÈGLE CENTRALE DU LOT. Un « 67 % » n'aurait aucune source :
    // le serveur rend des étapes. L'inventer serait mentir sur le temps
    // restant, et le faux compteur se figerait au milieu d'une étape longue.
    for (const etape of ['extraction', 'visuel', 'transcription']) {
      analyseServeur = analyse({ etat: 'en_cours', etape, dureeSecondes: null });
      await monter();
      expect(texte()).not.toMatch(/\d+\s*%/);
      cleanup();
    }
  });

  it('reussie : le badge « Analysé » et les mesures', async () => {
    analyseServeur = analyse();
    await monter();
    expect(etat()).toBe('reussie');
    expect(document.querySelector('[data-analyse-badge]')?.textContent).toContain('Analysé');
    expect(document.querySelector('[data-analyse-technique]')).toBeTruthy();
  });

  it('echouee définitive : message lisible, et PAS de relance', async () => {
    analyseServeur = analyse({ etat: 'echouee', motifEchec: 'format_illisible', dureeSecondes: null });
    await monter();
    expect(etat()).toBe('echouee');
    expect(texte()).toContain('n’est pas une vidéo exploitable');
    // Recommencer donnerait exactement le même verdict : proposer un bouton
    // serait une invitation à perdre son temps.
    expect(bouton()).toBeNull();
    // Et surtout, le motif de code source ne s'affiche pas.
    expect(texte()).not.toContain('format_illisible');
  });

  it('echouee transitoire : message lisible ET bouton « Relancer »', async () => {
    analyseServeur = analyse({ etat: 'echouee', motifEchec: 'stockage_injoignable', dureeSecondes: null });
    await monter();
    expect(texte()).toContain('stockage était momentanément injoignable');
    expect(bouton()?.getAttribute('data-analyse-lancer')).toBe('relance');
  });

  it('echouee après un redémarrage serveur : dit pourquoi, et relance', async () => {
    analyseServeur = analyse({ etat: 'echouee', motifEchec: 'analyse_interrompue', dureeSecondes: null });
    await monter();
    expect(texte()).toContain('interrompue');
    expect(bouton()).toBeTruthy();
  });

  it('annulee : affichage neutre, et relance autorisée', async () => {
    analyseServeur = analyse({ etat: 'annulee', dureeSecondes: null });
    await monter();
    expect(etat()).toBe('annulee');
    expect(texte()).toContain('Analyse annulée');
    // Neutre : ni alarme, ni badge de succès.
    expect(texte()).not.toContain('Analysé');
    expect(bouton()).toBeTruthy();
  });

  it('le motif technique n’est jamais montré tel quel', async () => {
    analyseServeur = analyse({
      etat: 'echouee', motifEchec: 'resultat_moteur_refuse:vignettes', dureeSecondes: null,
    });
    await monter();
    expect(texte()).not.toContain('resultat_moteur_refuse');
    expect(texte()).not.toContain('vignettes');
    expect(texte()).toContain('refusée par le contrôle interne');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — après un rechargement, le statut se retrouve', () => {
  it('le statut vient du serveur au montage, pas d’un état React', async () => {
    // Personne n'a cliqué dans CETTE page : l'analyse a été lancée ailleurs,
    // ou avant un F5. L'écran doit malgré tout la retrouver.
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    await monter();
    expect(lectures().length).toBe(1);
    expect(etat()).toBe('en_cours');
    expect(bouton()).toBeNull();
  });

  it('un remontage relit, et ne repart pas de « jamais analysé »', async () => {
    analyseServeur = analyse({ etat: 'en_cours', etape: 'visuel', dureeSecondes: null });
    const { unmount } = await monter();
    unmount();
    journal = [];
    await monter();
    expect(lectures().length).toBe(1);
    expect(etat()).toBe('en_cours');
    expect(texte()).toContain('Lecture des images');
  });

  it('un statut illisible ne fait pas disparaître le rush', async () => {
    statutGet = 500;
    await monter();
    expect(document.querySelector('[data-analyse-indisponible]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le suivi périodique : il lit, et il s’arrête', () => {
  it('il ne fait QUE des GET — aucun POST automatique, jamais', async () => {
    // ⚠️ INVARIANT. Un POST rejoué toutes les trois secondes consommerait une
    // place d'extraction à chaque tour et créerait des analyses que personne
    // n'a demandées.
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    await monter();
    await avancer(3000);
    await avancer(3000);
    await avancer(3000);
    expect(lectures().length).toBe(4);
    expect(ecritures()).toEqual([]);
  });

  it('il s’arrête dès que l’analyse est terminée', async () => {
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    await monter();
    analyseServeur = analyse({ etat: 'reussie' });
    await avancer(3000);
    expect(etat()).toBe('reussie');
    const apres = lectures().length;
    await avancer(30_000);
    expect(lectures().length).toBe(apres);
  });

  it('il ne démarre même pas sur un état terminal', async () => {
    analyseServeur = analyse({ etat: 'reussie' });
    await monter();
    await avancer(30_000);
    expect(lectures().length).toBe(1);

    // ⚠️ ET M3-C NON PLUS. La section « Passages suggérés » lit une fois, à
    // l'affichage, et ne suit rien : une génération n'a pas d'état
    // intermédiaire à observer, la route répond quand elle a fini. Un suivi
    // ici rejouerait une requête toutes les trois secondes sur une analyse
    // que personne ne regarde plus.
    expect(lecturesCandidats().length, 'M3-C lit une fois, et ne boucle pas').toBe(1);
  });

  it('il ne démarre pas non plus quand il n’y a aucune analyse', async () => {
    analyseServeur = null;
    await monter();
    await avancer(30_000);
    expect(lectures().length).toBe(1);
  });

  it('il s’arrête au démontage — pas une requête de plus', async () => {
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    const { unmount } = await monter();
    await avancer(3000);
    const avant = lectures().length;
    unmount();
    await avancer(60_000);
    expect(lectures().length).toBe(avant);
  });

  it('une lecture ratée n’abandonne pas une analyse en cours', async () => {
    analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null });
    await monter();
    statutGet = 503;              // le réseau flanche
    await avancer(3000);
    statutGet = 200;              // il revient
    analyseServeur = analyse({ etat: 'reussie' });
    await avancer(3000);
    expect(etat()).toBe('reussie');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — le clic « Analyser » et chaque réponse du serveur', () => {
  it('201 : un POST, puis une relecture, puis le résultat', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = { status: 201, corps: { ok: true } };
    effetPost = () => { analyseServeur = analyse({ etat: 'reussie' }); };
    await cliquer();
    expect(ecritures().length).toBe(1);
    expect(ecritures()[0].methode).toBe('POST');
    expect(ecritures()[0].url).toContain('/analyse');
    // Le corps du POST n'est pas cru sur parole : on relit.
    expect(lectures().length).toBe(2);
    expect(etat()).toBe('reussie');

    // ⚠️ L'INVARIANT QUI PROTÈGE LA FACTURE.
    //
    // L'analyse vient de réussir, donc « Passages suggérés » s'affiche. Il
    // LIT, et il n'écrit RIEN : un POST automatique vers `/candidats`
    // paierait un appel au fournisseur à chaque analyse terminée, sans que
    // personne ne l'ait demandé. Seul un clic sur le bouton déclenche.
    expect(ecritures().filter((a) => a.url.endsWith('/candidats')))
      .toEqual([]);
    expect(lecturesCandidats().length).toBe(1);
  });

  it('409 : on suit l’analyse déjà en cours, sans message d’erreur', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = {
      status: 409,
      corps: { ok: false, motif: 'analyse_active_existante', error: 'Une analyse de ce rush est déjà en cours.' },
    };
    effetPost = () => { analyseServeur = analyse({ etat: 'en_cours', etape: 'extraction', dureeSecondes: null }); };
    await cliquer();
    expect(etat()).toBe('en_cours');
    // Un conflit n'est pas une faute de l'utilisateur : rien de rouge.
    expect(document.querySelector('[data-analyse-message]')).toBeNull();
  });

  it('429 : la phrase de capacité, et AUCUNE relance automatique', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = {
      status: 429,
      corps: { ok: false, motif: 'capacite_saturee', error: 'plein' },
      entetes: { 'Retry-After': '300' },
    };
    await cliquer();
    expect(texte()).toContain('Une autre analyse est déjà en cours. Réessaie dans quelques minutes.');
    // `Retry-After` INFORME.
    expect(document.querySelector('[data-analyse-retry="300"]')).toBeTruthy();
    // ⚠️ Et il ne relance rien : cinq minutes plus tard, toujours un seul POST.
    const envois = ecritures().length;
    await avancer(600_000);
    expect(ecritures().length).toBe(envois);
    expect(envois).toBe(1);
  });

  it('422 : refus définitif, lisible, sans bouton qui invite à recommencer', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = {
      status: 422,
      corps: { ok: false, motif: 'format_illisible', error: 'Ce fichier n’est pas une vidéo exploitable.' },
    };
    await cliquer();
    expect(texte()).toContain('n’est pas une vidéo exploitable');
    expect(bouton()).toBeNull();
  });

  it('503 : indisponibilité temporaire, avec relance manuelle', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = { status: 503, corps: { ok: false, motif: 'socle_absent', error: '' } };
    await cliquer();
    expect(texte()).toContain('temporairement indisponible');
    expect(bouton()).toBeTruthy();
  });

  it('504 : le délai dépassé est expliqué, et la relance est MANUELLE', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = { status: 504, corps: { ok: false, motif: 'timeout', error: '' } };
    await cliquer();
    expect(texte()).toContain('dépassé son délai');
    expect(bouton()).toBeTruthy();
    // Personne ne relance à notre place, même longtemps après.
    await avancer(600_000);
    expect(ecritures().length).toBe(1);
    // …mais un clic, lui, repart.
    postSuivant = { status: 201, corps: { ok: true } };
    effetPost = () => { analyseServeur = analyse({ etat: 'reussie' }); };
    await cliquer();
    expect(etat()).toBe('reussie');
  });

  it('deux clics pressés n’envoient qu’un seul POST', async () => {
    analyseServeur = null;
    await monter();
    postSuivant = { status: 201, corps: { ok: true } };
    effetPost = () => { analyseServeur = analyse({ etat: 'reussie' }); };
    const b = bouton() as Element;
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    await respirer();
    expect(ecritures().length).toBe(1);
  });

  it('le clic donne un retour visuel immédiat', async () => {
    analyseServeur = null;
    await monter();
    // Le serveur prend son temps : la réponse n'arrive pas dans ce tour.
    let debloquer: () => void = () => {};
    const attente = new Promise<void>((r) => { debloquer = r; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      journal.push({ methode, url: String(url) });
      if (methode === 'POST') { await attente; return reponse(201, { ok: true }); }
      return reponse(200, { ok: true, analyse: analyseServeur });
    }));
    await act(async () => { fireEvent.click(bouton() as Element); });
    expect(texte()).toContain('Analyse demandée');
    expect((bouton() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { debloquer(); await Promise.resolve(); });
  });

  it('serveur injoignable : on le dit, et on propose de relancer', async () => {
    analyseServeur = null;
    await monter();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      journal.push({ methode, url: String(url) });
      if (methode === 'POST') throw new Error('réseau coupé');
      return reponse(200, { ok: true, analyse: analyseServeur });
    }));
    await cliquer();
    expect(texte()).toContain('Impossible de joindre le serveur');
    expect(bouton()).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — les résultats affichés sont ceux qui existent vraiment', () => {
  it('les mesures de l’extraction sont là, en unités lisibles', async () => {
    analyseServeur = analyse();
    await monter();
    const t = texte();
    expect(t).toContain('1 min 32 s');        // durée
    expect(t).toContain('1080 × 1920');       // dimensions
    expect(t).toContain('1080p (Full HD)');   // résolution
    expect(t).toContain('29,97 img/s');       // fps
    expect(t).toContain('h264');              // codec vidéo
    expect(t).toContain('aac');               // codec audio
    expect(t).toContain('Stéréo');            // canaux
    expect(t).toContain('48 kHz');            // fréquence
    expect(t).toContain('8,4 Mb/s');          // débit
    expect(t).toContain('90°');               // rotation
    expect(t).toContain('700 Mo');            // taille du fichier
  });

  it('la présence d’audio se dit, même quand il n’y en a pas', async () => {
    analyseServeur = analyse({
      technique: { sonde: 'ffprobe', codecVideo: 'vp9', largeur: 720, hauteur: 1280, aAudio: false },
    });
    await monter();
    expect(document.querySelector('[data-analyse-mesure="aAudio"]')?.textContent)
      .toContain('Aucune');
  });

  it('la sonde utilisée est dans les détails, pas dans les mesures', async () => {
    analyseServeur = analyse();
    await monter();
    const details = document.querySelector('[data-analyse-details]');
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain('ffprobe');
  });

  it('une mesure absente ne produit AUCUNE ligne — rien n’est comblé', async () => {
    // Le repli `ffmpeg -i` ne connaît ni la taille du fichier ni le fps exact.
    analyseServeur = analyse({
      technique: { sonde: 'ffmpeg', codecVideo: 'h264', largeur: 1920, hauteur: 1080, aAudio: false },
      dureeSecondes: 12,
    });
    await monter();
    expect(document.querySelector('[data-analyse-mesure="tailleOctets"]')).toBeNull();
    expect(document.querySelector('[data-analyse-mesure="fps"]')).toBeNull();
    expect(texte()).not.toContain('—');
    expect(texte()).not.toContain('undefined');
    expect(texte()).not.toContain('NaN');
  });

  it('aucun JSON brut à l’écran', async () => {
    analyseServeur = analyse();
    await monter();
    const t = texte();
    expect(t).not.toContain('{');
    expect(t).not.toContain('[object');
    expect(t).not.toContain('codecVideo');
    expect(t).not.toContain('tailleOctets');
  });

  it('les sections à venir sont annoncées, jamais remplies de faux', async () => {
    analyseServeur = analyse();               // resume/parole/qualite vides
    await monter();
    expect(document.querySelector('[data-analyse-a-venir]')).toBeTruthy();
    expect(document.querySelector('[data-analyse-section="comprehension"]')).toBeNull();
    expect(document.querySelector('[data-analyse-section="parole"]')).toBeNull();
  });

  it('le jour où la compréhension existe, elle s’affiche à sa place', async () => {
    analyseServeur = analyse({
      resume: 'Un cours de danse filmé en salle, trois passages face caméra.',
      textesVisibles: ['AFROBOOST', 'Samedi 18 h'],
      parole: { texte: 'On y va, on lève les bras.' },
    });
    await monter();
    expect(document.querySelector('[data-analyse-a-venir]')).toBeNull();
    expect(document.querySelector('[data-analyse-section="comprehension"]')?.textContent)
      .toContain('cours de danse');
    expect(document.querySelector('[data-analyse-section="parole"]')?.textContent)
      .toContain('lève les bras');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F — les vignettes : visibles, bornées, et sans clé de stockage', () => {
  it('huit au maximum, quoi que rende le serveur', async () => {
    analyseServeur = analyse({ vignettes: { nombre: 12, secondes: [] } });
    vignettesServeur = Array.from({ length: 12 }, (_, i) => ({
      seconde: i * 5, url: `https://minio.interne/signe-${i}?X-Amz-Expires=300`,
    }));
    await monter();
    expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(8);
  });

  it('elles ne coûtent AUCUNE requête — les adresses se déduisent', async () => {
    // ⚠️ Ce test exigeait d'abord un `GET …/vignettes` unique. Le serveur ne
    // rend pas de liste d'URL : il sert chaque image à une adresse
    // déterministe, `…/analyses/<id>/vignettes/<i>`, en relisant la clé
    // lui-même. Réclamer une liste pour reconstruire des adresses qu'on
    // connaît déjà serait une requête par rush toutes les trois secondes,
    // pour rien. La preuve devient donc : zéro appel, et des `<img>` bien
    // adressés.
    analyseServeur = analyse({ vignettes: { nombre: 1, secondes: [0] } });
    await monter();
    await avancer(30_000);
    expect(journal.filter((a) => a.url.includes('/vignettes'))).toHaveLength(0);
    const img = document.querySelector('[data-analyse-vignette="0"]');
    expect(img?.getAttribute('src')).toMatch(/^\/api\/autopilot\/analyses\/[^/]+\/vignettes\/0$/);
  });

  it('ni compartiment ni clé technique dans le DOM', async () => {
    // ⚠️ Le serveur peut rendre l'analyse sous sa forme interne (un tableau de
    // clés). Même dans ce cas, rien de tout ça ne doit atteindre la page :
    // une clé est un pointeur durable, et on en fabriquerait une URL publique.
    analyseServeur = analyse({
      vignettes: [
        { bucket: 'media', cle: 'u-42/rushes/a-1/v0.jpg', seconde: 0 },
        { bucket: 'media', cle: 'u-42/rushes/a-1/v1.jpg', seconde: 9 },
      ],
    });
    await monter();
    const html = bloc().innerHTML;
    expect(html).not.toContain('u-42/rushes');
    expect(html).not.toContain('"bucket"');
    expect(html).not.toContain('/storage/v1/object/public/');
    // Deux vignettes annoncées, deux `<img>` — et pas une clé dans le DOM.
    expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(2);
    // Aucune signature ne circule : l'adresse ne porte qu'un index.
    expect(html).not.toContain('X-Amz-');
  });

  it('une analyse sans aperçu n efface pas la mesure', async () => {
    // Il n'y a plus de « 404 sur la liste » à simuler : la liste n'existe
    // plus. Le cas qui reste est une analyse qui n'a produit aucune vignette
    // — une vidéo trop courte, par exemple. La mesure doit rester entière.
    analyseServeur = analyse({ vignettes: { nombre: 0, secondes: [] } });
    await monter();
    expect(document.querySelectorAll('[data-analyse-vignette]').length).toBe(0);
    expect(document.querySelector('[data-analyse-badge]')).toBeTruthy();
    expect(texte()).toContain('1080 × 1920');
  });

  it('chaque aperçu porte un texte de remplacement utile', async () => {
    analyseServeur = analyse({ vignettes: { nombre: 1, secondes: [42] } });
    await monter();
    expect(document.querySelector('[data-analyse-vignette="0"]')?.getAttribute('alt'))
      .toBe('Aperçu à 42 s');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — la conduite après un POST, décidée sans monter React', () => {
  const rep = (p: Partial<ReponseLancement>): ReponseLancement => ({
    statut: 200, motif: null, message: null, retryApresSecondes: null, injoignable: false, ...p,
  });

  it('201 et 409 mènent tous deux à une relecture', () => {
    expect(conduiteApresLancement(rep({ statut: 201 })).suite).toBe('relire');
    expect(conduiteApresLancement(rep({ statut: 409, motif: 'analyse_active_existante' })).suite)
      .toBe('relire');
  });

  it('un 409 qui n’a rien à suivre rend un message, pas une relecture', () => {
    const c = conduiteApresLancement(rep({
      statut: 409, motif: 'rush_non_verifie', message: 'Ce rush n’a pas été vérifié.',
    }));
    expect(c.suite).toBe('message');
    if (c.suite === 'message') expect(c.relancable).toBe(false);
  });

  it('429 informe du délai sans jamais autoriser une relance automatique', () => {
    const c = conduiteApresLancement(rep({ statut: 429, retryApresSecondes: 300 }));
    expect(c.suite).toBe('message');
    if (c.suite === 'message') {
      expect(c.retryApresSecondes).toBe(300);
      expect(c.message).toContain('Réessaie dans quelques minutes');
    }
  });

  it('422 est définitif, 503 et 504 sont relançables à la main', () => {
    const def = conduiteApresLancement(rep({ statut: 422, message: 'X' }));
    const indispo = conduiteApresLancement(rep({ statut: 503 }));
    const delai = conduiteApresLancement(rep({ statut: 504 }));
    if (def.suite === 'message') expect(def.relancable).toBe(false);
    if (indispo.suite === 'message') expect(indispo.relancable).toBe(true);
    if (delai.suite === 'message') expect(delai.relancable).toBe(true);
  });

  it('une session expirée ne propose pas de recommencer en boucle', () => {
    const c = conduiteApresLancement(rep({ statut: 401 }));
    if (c.suite === 'message') {
      expect(c.relancable).toBe(false);
      expect(c.message).toContain('Reconnecte-toi');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('H — la mise en forme, testée seule', () => {
  it('une réponse qui n’est pas une analyse rend `null`, jamais un objet à moitié', () => {
    expect(analyseDepuisReponse(null)).toBeNull();
    expect(analyseDepuisReponse({ id: 'a', etat: 'inconnu' })).toBeNull();
    expect(analyseDepuisReponse({ etat: 'reussie' })).toBeNull();
  });

  it('les deux formes de vignettes sont comprises, et seules les secondes sortent', () => {
    const publique = analyseDepuisReponse({ id: 'a', etat: 'reussie', vignettes: { nombre: 3, secondes: [0, 5, 9] } });
    expect(publique?.vignettes).toEqual({ nombre: 3, secondes: [0, 5, 9] });
    const interne = analyseDepuisReponse({
      id: 'a', etat: 'reussie',
      vignettes: [{ bucket: 'media', cle: 'u/x.jpg', seconde: 4 }],
    });
    expect(interne?.vignettes).toEqual({ nombre: 1, secondes: [4] });
    expect(JSON.stringify(interne?.vignettes)).not.toContain('media');
  });

  it('les durées et les tailles se lisent en français', () => {
    expect(formaterDuree(45)).toBe('45 s');
    expect(formaterDuree(92.4)).toBe('1 min 32 s');
    expect(formaterDuree(3725)).toBe('1 h 02 min');
    expect(formaterDuree(0)).toBeNull();
    expect(formaterDuree(null)).toBeNull();
    expect(formaterOctets(734_003_200)).toBe('700 Mo');
    expect(formaterOctets(0)).toBeNull();
  });

  it('la résolution se nomme par le PETIT côté, dans les deux orientations', () => {
    expect(nomResolution(1080, 1920)).toBe('1080p (Full HD)');
    expect(nomResolution(1920, 1080)).toBe('1080p (Full HD)');
    expect(nomResolution(3840, 2160)).toBe('4K UHD');
    expect(nomResolution(null, 1080)).toBeNull();
  });

  it('formaterTechnique n’invente aucune ligne', () => {
    const { mesures, details } = formaterTechnique({}, null);
    expect(mesures).toEqual([]);
    expect(details).toEqual([]);
  });

  it('une rotation nulle ne mérite pas de ligne', () => {
    const { mesures } = formaterTechnique({ rotation: 0, codecVideo: 'h264' }, null);
    expect(mesures.find((l) => l.cle === 'rotation')).toBeUndefined();
  });

  it('relance : cohérente pour le transitoire, refusée pour le définitif', () => {
    expect(relanceCoherente('timeout')).toBe(true);
    expect(relanceCoherente('stockage_injoignable')).toBe(true);
    expect(relanceCoherente('format_illisible')).toBe(false);
    expect(relanceCoherente('objet_introuvable')).toBe(false);
    expect(relanceCoherente('cle_hors_perimetre')).toBe(false);
    expect(relanceCoherente('resultat_moteur_refuse:vignettes')).toBe(false);
    // Un motif inconnu : on préfère un essai inutile à un cul-de-sac.
    expect(relanceCoherente('motif_de_demain')).toBe(true);
  });

  it('un motif inconnu reste dit en français, jamais en identifiant', () => {
    expect(messageEchec('motif_de_demain')).toBe('L’analyse n’a pas abouti.');
    expect(messageEchec(null)).toBe('L’analyse n’a pas abouti.');
  });

  it('chaque étape a sa phrase, et aucune n’est un pourcentage', () => {
    for (const e of ['extraction', 'visuel', 'transcription'] as const) {
      expect(phraseEnCours(e)).not.toMatch(/%/);
      expect(phraseEnCours(e).length).toBeGreaterThan(10);
    }
    expect(phraseEnCours(null)).toBe('Analyse en cours…');
  });
});
