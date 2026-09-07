/**
 * LOT PC-1 — LE BROUILLON DE CETTE VIDEO.
 *
 * ---------------------------------------------------------------------------
 * LE DEFAUT QU'ON FERME
 * ---------------------------------------------------------------------------
 *
 * Trois reglages de l'Autopilote ne vivaient que dans l'etat React :
 * l'objectif de cette video, le format et la duree, la recette audio. Un
 * rafraichissement les remplacait par les defauts du compte, SANS UN MOT.
 * L'utilisateur ne voyait pas qu'il avait perdu quelque chose : il voyait des
 * valeurs plausibles.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS TIENNENT, ET DANS QUEL ORDRE D'IMPORTANCE
 * ---------------------------------------------------------------------------
 *
 *   1. UN BROUILLON N'ECRIT JAMAIS LE DEFAUT DU COMPTE. C'est la confusion
 *      qui a deja coute un objectif de compte en production : elle ne doit
 *      pas revenir par une porte de service.
 *   2. UN RUSH NE VOIT PAS LE BROUILLON D'UN AUTRE. Ni celui d'un autre
 *      compte : la cle porte un UUID de rush, qu'aucun autre utilisateur ne
 *      connait.
 *   3. RIEN DE CE QUI EST RELU N'EST DIGNE DE CONFIANCE. Version inconnue,
 *      JSON casse, volume hors bornes, format invente : chaque champ retombe
 *      sur SON defaut, sans exception et sans contaminer ses voisins.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  VERSION_BROUILLON, cleBrouillon, nettoyerBrouillon, nettoyerMontage,
  lireBrouillon, ecrireBrouillon, effacerBrouillon,
} = await import('@/lib/autopilot/brouillon-video');
const { MONTAGE_DEFAUT } = await import('@/lib/autopilot/textStyle');
const { RECETTE_AUDIO_DEFAUT } = await import('@/lib/autopilot/analyse/recette-audio');
const { normaliserObjectif } = await import('@/lib/autopilot/analyse/objectif-communication');

const RUSH_A = 'c0ad258d-9e17-4199-b33a-0490ba3e847e';
const RUSH_B = '7ceda1e8-79ff-4e6b-8bd7-3a5b5bfa221b';

/** Un `localStorage` en memoire, et le vrai contrat : il peut refuser. */
function poserStockage(options: { casse?: boolean } = {}) {
  const donnees = new Map<string, string>();
  const store = {
    getItem: (k: string) => {
      if (options.casse) throw new Error('stockage refuse');
      return donnees.has(k) ? donnees.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (options.casse) throw new Error('quota depasse');
      donnees.set(k, v);
    },
    removeItem: (k: string) => {
      if (options.casse) throw new Error('stockage refuse');
      donnees.delete(k);
    },
  };
  vi.stubGlobal('window', { localStorage: store });
  return donnees;
}

beforeEach(() => { vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La cle — un rush, un brouillon', () => {
  it('1.1 la cle porte la version ET le rush', () => {
    expect(cleBrouillon(RUSH_A)).toBe(`studiio:autopilote:brouillon:v${VERSION_BROUILLON}:${RUSH_A}`);
  });

  it('1.2 sans rush, il n’y a PAS de cle fourre-tout', () => {
    // ⚠️ Une cle sans rush serait relue par le rush suivant : il heriterait
    // des reglages d'un projet qu'il n'est pas.
    expect(cleBrouillon(null)).toBeNull();
    expect(cleBrouillon(undefined)).toBeNull();
    expect(cleBrouillon('')).toBeNull();
  });

  it('1.3 deux rushes n’ont jamais la meme cle', () => {
    expect(cleBrouillon(RUSH_A)).not.toBe(cleBrouillon(RUSH_B));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Aller-retour', () => {
  it('2.1 ce qu’on ecrit est ce qu’on relit', () => {
    poserStockage();
    const objectif = normaliserObjectif({ type: 'temoignage' });
    const montage = { format: '16:9', dureeSecondes: 30 };
    const audio = { ...RECETTE_AUDIO_DEFAUT, volumeSonOriginal: 0.47 };

    expect(ecrireBrouillon(RUSH_A, { objectif, montage, audio })).toBe(true);
    const relu = lireBrouillon(RUSH_A);
    expect(relu?.objectif).toMatchObject({ type: 'temoignage' });
    expect(relu?.montage).toEqual(montage);
    expect(relu?.audio.volumeSonOriginal).toBe(0.47);
  });

  it('2.2 un rush sans brouillon rend `null`, et ce n’est pas une erreur', () => {
    poserStockage();
    ecrireBrouillon(RUSH_A, {
      objectif: normaliserObjectif({ type: 'evenement' }),
      montage: { format: '1:1', dureeSecondes: 15 },
      audio: { ...RECETTE_AUDIO_DEFAUT },
    });
    // ⚠️ LE POINT DU LOT : le rush B ne recupere RIEN du rush A.
    expect(lireBrouillon(RUSH_B)).toBeNull();
  });

  it('2.3 effacer un brouillon n’efface que le sien', () => {
    poserStockage();
    const commun = { montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT } };
    ecrireBrouillon(RUSH_A, { objectif: null, ...commun });
    ecrireBrouillon(RUSH_B, { objectif: null, ...commun });
    effacerBrouillon(RUSH_A);
    expect(lireBrouillon(RUSH_A)).toBeNull();
    expect(lireBrouillon(RUSH_B)).not.toBeNull();
  });

  it('2.4 aucune cle n’est ecrite sans rush', () => {
    const donnees = poserStockage();
    expect(ecrireBrouillon(null, {
      objectif: null, montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    })).toBe(false);
    expect(donnees.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Rien de ce qui est relu n’est digne de confiance', () => {
  it('3.1 une version inconnue est IGNOREE, pas devinee', () => {
    // Un format futur peut avoir change le SENS d'un champ sans changer son
    // type : le valider avec les regles d'aujourd'hui rendrait une valeur
    // plausible et fausse.
    expect(nettoyerBrouillon({ version: 99, montage: { format: '16:9', dureeSecondes: 30 } }))
      .toBeNull();
    expect(nettoyerBrouillon({ montage: {} })).toBeNull();
  });

  it('3.2 un JSON casse ne leve pas, il rend `null`', () => {
    const donnees = poserStockage();
    donnees.set(cleBrouillon(RUSH_A)!, '{ ceci n est pas du json');
    expect(() => lireBrouillon(RUSH_A)).not.toThrow();
    expect(lireBrouillon(RUSH_A)).toBeNull();
  });

  it('3.3 un stockage qui refuse ne casse jamais l’ecran', () => {
    poserStockage({ casse: true });
    expect(() => lireBrouillon(RUSH_A)).not.toThrow();
    expect(lireBrouillon(RUSH_A)).toBeNull();
    expect(ecrireBrouillon(RUSH_A, {
      objectif: null, montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    })).toBe(false);
    expect(() => effacerBrouillon(RUSH_A)).not.toThrow();
  });

  it('3.4 sans `window`, tout repond sagement — le rendu serveur passe ici', () => {
    vi.stubGlobal('window', undefined);
    expect(lireBrouillon(RUSH_A)).toBeNull();
    expect(ecrireBrouillon(RUSH_A, {
      objectif: null, montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    })).toBe(false);
  });

  it('3.5 un champ invalide n’en condamne pas un autre', () => {
    // ⚠️ LE POINT : une recette audio hors bornes ne doit pas faire perdre
    // le format choisi. Chaque champ retombe sur SON defaut.
    const relu = nettoyerBrouillon({
      version: VERSION_BROUILLON,
      enregistreLe: 1,
      objectif: { type: 'type-qui-n-existe-pas' },
      montage: { format: '16:9', dureeSecondes: 30 },
      audio: { volumeMusique: 42 },
    });
    expect(relu).not.toBeNull();
    expect(relu!.montage).toEqual({ format: '16:9', dureeSecondes: 30 });
    expect(relu!.audio).toEqual(RECETTE_AUDIO_DEFAUT);
  });

  it('3.6 un format invente et une duree aberrante retombent au defaut', () => {
    expect(nettoyerMontage({ format: '21:9', dureeSecondes: 30 }).format)
      .toBe(MONTAGE_DEFAUT.format);
    expect(nettoyerMontage({ format: '9:16', dureeSecondes: 100000 }).dureeSecondes)
      .toBe(MONTAGE_DEFAUT.dureeSecondes);
    expect(nettoyerMontage({ format: '9:16', dureeSecondes: 0 }).dureeSecondes)
      .toBe(MONTAGE_DEFAUT.dureeSecondes);
    expect(nettoyerMontage(null)).toEqual(MONTAGE_DEFAUT);
    expect(nettoyerMontage('9:16')).toEqual(MONTAGE_DEFAUT);
  });

  it('3.7 un objectif hors contrat devient `null`, jamais une valeur inventee', () => {
    const relu = nettoyerBrouillon({
      version: VERSION_BROUILLON, enregistreLe: 1,
      objectif: { type: 'evenement', champInconnu: 'x' },
      montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    });
    // `lireObjectif` refuse toute cle hors contrat : on retombe sur « aucun
    // objectif de video », donc sur le defaut du compte. Pas sur un objectif
    // a moitie lu.
    expect(relu!.objectif).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Ce que le brouillon ne fait JAMAIS', () => {
  it('4.1 il n’ecrit que dans localStorage — aucune requete', () => {
    poserStockage();
    const reseau = vi.fn();
    vi.stubGlobal('fetch', reseau);
    ecrireBrouillon(RUSH_A, {
      objectif: normaliserObjectif({ type: 'temoignage' }),
      montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    });
    lireBrouillon(RUSH_A);
    effacerBrouillon(RUSH_A);
    // ⚠️ LE DEFAUT DU COMPTE NE PEUT PAS BOUGER SI RIEN NE PART. Le seul
    // geste qui le change reste la case du wizard, qui appelle `PUT
    // /api/autopilot/objectif` — et elle n'est pas ici.
    expect(reseau).not.toHaveBeenCalled();
  });

  it('4.2 il ne stocke ni media, ni jeton, ni URL signee', () => {
    const donnees = poserStockage();
    ecrireBrouillon(RUSH_A, {
      objectif: normaliserObjectif({ type: 'temoignage' }),
      montage: { format: '9:16', dureeSecondes: 60 },
      audio: { ...RECETTE_AUDIO_DEFAUT },
    });
    const ecrit = donnees.get(cleBrouillon(RUSH_A)!)!;
    for (const interdit of ['token', 'Bearer', 'signature', 'X-Amz', 'apikey', 'blob:']) {
      expect(ecrit).not.toContain(interdit);
    }
  });

  it('4.3 l’horodatage est relu, et une valeur absurde ne casse rien', () => {
    const relu = nettoyerBrouillon({
      version: VERSION_BROUILLON, enregistreLe: 'hier',
      montage: { ...MONTAGE_DEFAUT }, audio: { ...RECETTE_AUDIO_DEFAUT },
    });
    expect(relu!.enregistreLe).toBe(0);
  });
});
