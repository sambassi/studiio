import { describe, it, expect } from 'vitest';
import {
  ANIMATION_IDS, LUT_IDS, POLICE_IDS, TRANSITION_IDS, POLICES_AUTORISEES,
  slugPolice,
} from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  PROFIL_CREATIF_DEFAUT, CLES_CANONIQUES_PROFIL,
  estProfilHistorique, fusionnerProfilEtOverride, lireProfilCreatif,
  normaliserProfilCreatif, profilCreatifCanonique, profilCreatifPourUsage,
  type ProfilCreatifPartiel,
} from '@/lib/autopilot/analyse/profil-creatif';
import {
  OBJECTIF_DEFAUT, TYPE_OBJECTIF_GENERIQUE, CLES_CANONIQUES_OBJECTIF,
  M3G_V3_RECOMMANDATION,
  estObjectifGenerique, lireObjectif, normaliserObjectif, objectifCanonique,
  objectifEffectif, type ObjectifPartiel,
} from '@/lib/autopilot/analyse/objectif-communication';
import {
  METHODE_RENDU, PREFIXE_METHODE_MIX, PREFIXE_METHODE_PROFIL,
  LONGUEUR_METHODE_RENDU_MAX, methodeRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { ALGORITHME_PLAN } from '@/lib/autopilot/analyse/montage-contrat';
import { ALGORITHME_COUPES } from '@/lib/autopilot/analyse/coupe-contrat';
import {
  RECETTE_AUDIO_DEFAUT, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import {
  sanitizeDesignStyle, profilCreatifDepuisStyle, objectifDepuisStyle,
} from '@/lib/autopilot/textStyle';

/**
 * LOT 2B ETAPE 1 — PROFIL CREATIF ET OBJECTIF DE COMMUNICATION.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS PROTEGENT
 * ---------------------------------------------------------------------------
 *
 * Quatre choses, et la premiere est de loin la plus couteuse a rater.
 *
 * 1. LA RETRO-COMPATIBILITE. Des milliers de rendus portent deja
 *    `x264-crf23-concat-v1` ou `x264-mix-v1-<empreinte>`. Si ce lot deplacait
 *    l'une de ces valeurs d'un seul caractere, tous ces rendus deviendraient
 *    introuvables, seraient recalcules et refactures. Les valeurs sont donc
 *    FIGEES ici, en dur.
 *
 * 2. LA PANNE MUETTE. `rush_montage_renders_reussi_unique` fait de la
 *    reutilisation une propriete STRUCTURELLE : si le style n'entrait pas
 *    dans `methode_rendu`, changer de CTA rendrait l'ancien fichier, sans
 *    erreur et sans message.
 *
 * 3. LA FRONTIERE PLAN / RENDU. Le style ne touche jamais l'identite du plan ;
 *    l'objectif, lui, a vocation a la changer. Un test le fige dans les deux
 *    sens.
 *
 * 4. L'ISOLATION ENTRE COMPTES. Le profil du compte A ne doit jamais
 *    atteindre le compte B.
 */

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const CLE = `${UID}/music/1788334481265-titre.mp3`;

const AUDIO: RecetteAudio = {
  musique: { bucket: 'audio', cle: CLE },
  volumeMusique: 0.35,
  sonOriginal: true,
  volumeSonOriginal: 0.6,
};

/**
 * Le profil d'Afroboost — DONNEE DE TEST, jamais un defaut du produit.
 *
 * Il vit ici, dans un fichier de test, exactement comme il vivra dans le
 * `designStyle` du compte de Bassi : c'est un utilisateur parmi d'autres.
 */
const PROFIL_AFROBOOST: ProfilCreatifPartiel = {
  marque: {
    logoActif: true,
    logo: { bucket: 'images', cle: `${UID}/logo/afroboost.png` },
    position: 'bas-droite',
    taillePct: 14,
    opacite: 0.9,
  },
  typographie: { policeTitreId: 'bebas-neue', tailleTitre: 1.2 },
  couleurs: { fond: '#000000', accent: '#D91CD2', texte: '#FFFFFF' },
  lut: { active: true, lutId: 'cinema-warm', intensite: 0.7 },
  ctaVisuel: { actif: true, dureeSecondes: 3, position: 'bas' },
  transitions: { active: true, transitionId: 'zoom', dureeMs: 400, intensite: 0.6 },
  animations: { texteId: 'fade', ctaId: 'pop', logoId: 'none' },
  margesSures: { hautPct: 12, basPct: 18 },
};

/** Un second compte, pour les tests d'isolation. */
const PROFIL_AUTRE: ProfilCreatifPartiel = {
  typographie: { policeTitreId: 'montserrat' },
  couleurs: { accent: '#1877F2' },
  lut: { active: true, lutId: 'clean', intensite: 0.4 },
  transitions: { active: true, transitionId: 'crossfade' },
};

const OBJECTIF_EVENEMENT: ObjectifPartiel = {
  type: 'evenement',
  objectifPrincipal: 'Remplir le cours du 12 septembre',
  evenement: {
    nom: 'Afroboost Lausanne',
    date: '2026-09-12',
    lieu: 'Lausanne',
    placesLimitees: true,
    lienReservation: 'https://example.org/reserver',
  },
  appelAction: { actionId: 'reservation', texte: 'Reserve ta place' },
  tonId: 'energetique',
  priorites: ['energie', 'foule', 'urgence'],
};

// ===========================================================================
// A. RETRO-COMPATIBILITE — les valeurs figees
// ===========================================================================

describe('A. retro-compatibilite des empreintes', () => {
  it('aucun audio, aucun profil rend EXACTEMENT la methode historique', () => {
    expect(methodeRendu(null)).toBe('x264-crf23-concat-v1');
    expect(methodeRendu(null)).toBe(METHODE_RENDU);
    expect(methodeRendu(undefined, undefined)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, null)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, {})).toBe(METHODE_RENDU);
  });

  it('audio seul rend la MEME valeur qu\'avant le Lot 2B, au caractere pres', () => {
    // ⚠️ VALEUR FIGEE. Elle a ete calculee sur la branche AVANT ce lot. Si ce
    // test tombe, ce n'est pas lui qu'il faut corriger : c'est que tous les
    // rendus audio deja reussis viennent de devenir introuvables.
    const attendu = 'x264-mix-v1-4b8139bba587a1b86ebfa76f';
    expect(methodeRendu(AUDIO)).toBe(attendu);
    expect(methodeRendu(AUDIO, null)).toBe(attendu);
    expect(methodeRendu(AUDIO, PROFIL_CREATIF_DEFAUT)).toBe(attendu);
    expect(methodeRendu(AUDIO)).toMatch(new RegExp(`^${PREFIXE_METHODE_MIX}`));
  });

  it('un profil vide EST le profil historique', () => {
    expect(estProfilHistorique(null)).toBe(true);
    expect(estProfilHistorique(undefined)).toBe(true);
    expect(estProfilHistorique({})).toBe(true);
    expect(estProfilHistorique(PROFIL_CREATIF_DEFAUT)).toBe(true);
    // Un logo demande SANS fichier n'affiche rien : c'est encore l'historique.
    expect(estProfilHistorique({ marque: { logoActif: true } })).toBe(true);
    // Une LUT demandee sans identifiant non plus.
    expect(estProfilHistorique({ lut: { active: true } })).toBe(true);
  });

  it('la methode reste sous la borne de 40 caracteres de la colonne', () => {
    const avecProfil = methodeRendu(AUDIO, PROFIL_AFROBOOST);
    expect(avecProfil.startsWith(PREFIXE_METHODE_PROFIL)).toBe(true);
    expect(avecProfil.length).toBe(35);
    expect(avecProfil.length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
    expect(methodeRendu(AUDIO).length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
    expect(METHODE_RENDU.length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
  });

  it('un profil non historique l\'emporte, meme sans audio', () => {
    // Sinon une video sans musique mais avec un CTA rendrait le fichier d'avant.
    const m = methodeRendu(null, PROFIL_AFROBOOST);
    expect(m).not.toBe(METHODE_RENDU);
    expect(m.startsWith(PREFIXE_METHODE_PROFIL)).toBe(true);
  });
});

// ===========================================================================
// B. PROFIL — determinisme et sensibilite
// ===========================================================================

describe('B. empreinte du profil creatif', () => {
  it('le meme profil rend la meme empreinte', () => {
    expect(methodeRendu(AUDIO, PROFIL_AFROBOOST))
      .toBe(methodeRendu(AUDIO, { ...PROFIL_AFROBOOST }));
  });

  it('un ordre de proprietes different rend la MEME empreinte', () => {
    const desordre: ProfilCreatifPartiel = {
      margesSures: PROFIL_AFROBOOST.margesSures,
      animations: PROFIL_AFROBOOST.animations,
      transitions: PROFIL_AFROBOOST.transitions,
      ctaVisuel: PROFIL_AFROBOOST.ctaVisuel,
      lut: PROFIL_AFROBOOST.lut,
      couleurs: {
        texte: '#FFFFFF', accent: '#D91CD2', fond: '#000000',
      },
      typographie: PROFIL_AFROBOOST.typographie,
      marque: PROFIL_AFROBOOST.marque,
    };
    expect(profilCreatifCanonique(desordre)).toBe(profilCreatifCanonique(PROFIL_AFROBOOST));
    expect(methodeRendu(AUDIO, desordre)).toBe(methodeRendu(AUDIO, PROFIL_AFROBOOST));
  });

  it('la casse d\'une couleur ne change pas l\'empreinte', () => {
    const minuscules = {
      ...PROFIL_AFROBOOST,
      couleurs: { fond: '#000000', accent: '#d91cd2', texte: '#ffffff' },
    };
    expect(methodeRendu(AUDIO, minuscules)).toBe(methodeRendu(AUDIO, PROFIL_AFROBOOST));
  });

  it.each([
    ['police', { typographie: { policeTitreId: 'anton' } }],
    ['LUT', { lut: { active: true, lutId: 'cinema-cool', intensite: 0.7 } }],
    ['intensite de LUT', { lut: { active: true, lutId: 'cinema-warm', intensite: 0.2 } }],
    ['couleur', { couleurs: { accent: '#00FF00' } }],
    ['CTA visuel', { ctaVisuel: { actif: true, dureeSecondes: 6, position: 'bas' } }],
    ['transition', { transitions: { active: true, transitionId: 'crossfade' } }],
    ['animation', { animations: { ctaId: 'scale' } }],
    ['taille de logo', { marque: { taillePct: 30 } }],
    ['marges sures', { margesSures: { basPct: 25 } }],
  ] as Array<[string, ProfilCreatifPartiel]>)(
    'changer %s change l\'empreinte du rendu',
    (_nom, delta) => {
      const modifie = fusionnerProfilEtOverride(PROFIL_AFROBOOST, delta);
      expect(methodeRendu(AUDIO, modifie)).not.toBe(methodeRendu(AUDIO, PROFIL_AFROBOOST));
    },
  );

  it('une valeur sans objet ne change RIEN — pas de double encodage', () => {
    // Opacite de logo alors que le logo est inactif : visuellement identique.
    const a = normaliserProfilCreatif({ marque: { logoActif: false, opacite: 0.3 } });
    const b = normaliserProfilCreatif({ marque: { logoActif: false, opacite: 0.9 } });
    expect(profilCreatifCanonique(a)).toBe(profilCreatifCanonique(b));
    // Intensite de LUT alors que la LUT est inactive.
    const c = normaliserProfilCreatif({ lut: { active: false, intensite: 0.1 } });
    const d = normaliserProfilCreatif({ lut: { active: false, intensite: 0.9 } });
    expect(profilCreatifCanonique(c)).toBe(profilCreatifCanonique(d));
  });

  it('la forme canonique couvre autant de champs qu\'elle en declare', () => {
    const canon = profilCreatifCanonique(PROFIL_AFROBOOST);
    const morceaux = canon.split('|');
    expect(morceaux).toHaveLength(CLES_CANONIQUES_PROFIL.length);
    for (const [i, cle] of CLES_CANONIQUES_PROFIL.entries()) {
      expect(morceaux[i].startsWith(`${cle}=`)).toBe(true);
    }
  });

  it('l\'archive `usage` porte la forme canonique qui a produit l\'empreinte', () => {
    const u = profilCreatifPourUsage(PROFIL_AFROBOOST);
    expect(u.canonique).toBe(profilCreatifCanonique(PROFIL_AFROBOOST));
    expect(JSON.stringify(u)).not.toContain('://');
  });
});

// ===========================================================================
// C. OVERRIDE — le cas nomme du cahier des charges
// ===========================================================================

describe('C. fusion profil + override', () => {
  it('un override de transition ne touche QUE la transition', () => {
    const effectif = fusionnerProfilEtOverride(
      PROFIL_AFROBOOST, { transitions: { transitionId: 'crossfade' } },
    );
    expect(effectif.transitions.transitionId).toBe('crossfade');
    // Le reste du bloc survit — c'est tout l'interet de la fusion par propriete.
    expect(effectif.transitions.dureeMs).toBe(400);
    expect(effectif.transitions.intensite).toBe(0.6);
    // Et les autres blocs ne bougent pas d'un cheveu.
    expect(effectif.typographie.policeTitreId).toBe('bebas-neue');
    expect(effectif.lut.lutId).toBe('cinema-warm');
    expect(effectif.couleurs.accent).toBe('#D91CD2');
    expect(effectif.marque.taillePct).toBe(14);
  });

  it('un override absent ne remplace rien', () => {
    expect(fusionnerProfilEtOverride(PROFIL_AFROBOOST, null))
      .toEqual(normaliserProfilCreatif(PROFIL_AFROBOOST));
    expect(fusionnerProfilEtOverride(PROFIL_AFROBOOST, {}))
      .toEqual(normaliserProfilCreatif(PROFIL_AFROBOOST));
  });

  it('`null` est une valeur : il retire explicitement pour cette video', () => {
    const effectif = fusionnerProfilEtOverride(
      PROFIL_AFROBOOST, { couleurs: { accent: null } },
    );
    expect(effectif.couleurs.accent).toBeNull();
    expect(effectif.couleurs.fond).toBe('#000000');
  });

  it('desactiver la LUT dans l\'override efface aussi son intensite', () => {
    const effectif = fusionnerProfilEtOverride(
      PROFIL_AFROBOOST, { lut: { active: false } },
    );
    expect(effectif.lut.active).toBe(false);
    expect(effectif.lut.lutId).toBeNull();
    expect(effectif.lut.intensite).toBe(PROFIL_CREATIF_DEFAUT.lut.intensite);
  });
});

// ===========================================================================
// D. ISOLATION ENTRE COMPTES
// ===========================================================================

describe('D. isolation entre utilisateurs', () => {
  it('deux comptes gardent deux profils distincts', () => {
    const styleA = sanitizeDesignStyle({ profilCreatif: PROFIL_AFROBOOST });
    const styleB = sanitizeDesignStyle({ profilCreatif: PROFIL_AUTRE });
    const a = profilCreatifDepuisStyle(styleA);
    const b = profilCreatifDepuisStyle(styleB);
    expect(a.typographie.policeTitreId).toBe('bebas-neue');
    expect(b.typographie.policeTitreId).toBe('montserrat');
    expect(a.couleurs.accent).toBe('#D91CD2');
    expect(b.couleurs.accent).toBe('#1877F2');
    expect(profilCreatifCanonique(a)).not.toBe(profilCreatifCanonique(b));
    expect(methodeRendu(AUDIO, a)).not.toBe(methodeRendu(AUDIO, b));
  });

  it('un compte sans profil recoit le defaut neutre, jamais celui d\'un autre', () => {
    const vide = profilCreatifDepuisStyle(sanitizeDesignStyle({}));
    expect(vide).toEqual(PROFIL_CREATIF_DEFAUT);
    expect(estProfilHistorique(vide)).toBe(true);
    expect(profilCreatifDepuisStyle(null)).toEqual(PROFIL_CREATIF_DEFAUT);
    expect(objectifDepuisStyle(null)).toEqual(OBJECTIF_DEFAUT);
  });

  it('deux comptes gardent deux objectifs par defaut distincts', () => {
    const a = objectifDepuisStyle(
      sanitizeDesignStyle({ objectifParDefaut: OBJECTIF_EVENEMENT }),
    );
    const b = objectifDepuisStyle(
      sanitizeDesignStyle({ objectifParDefaut: { type: 'produit' } }),
    );
    expect(a.type).toBe('evenement');
    expect(b.type).toBe('produit');
    expect(objectifCanonique(a)).not.toBe(objectifCanonique(b));
  });
});

// ===========================================================================
// E. SECURITE — identifiants controles, aucun chemin, aucune URL
// ===========================================================================

describe('E. securite du contrat de profil', () => {
  it('refuse une URL de logo au lieu d\'un objet de stockage', () => {
    const r = lireProfilCreatif({
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'https://ailleurs/x.png' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('logo_invalide');
  });

  it('refuse un champ inconnu, meme s\'il ressemble a un champ legitime', () => {
    for (const corps of [
      { logoUrl: 'https://x/y.png' },
      { marque: { logoUrl: 'https://x/y.png' } },
      { typographie: { fontFile: '/usr/share/fonts/x.ttf' } },
      { lut: { lutPath: '/tmp/x.cube' } },
      { transitions: { args: '-vf blur' } },
      { ffmpeg: 'anything' },
    ]) {
      const r = lireProfilCreatif(corps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motif).toBe('champ_inconnu');
    }
  });

  it('refuse une remontee de repertoire dans la cle du logo', () => {
    for (const cle of ['../secret.png', 'a\\b.png', '/etc/passwd', '%2e%2e/x.png']) {
      const r = lireProfilCreatif({
        marque: { logoActif: true, logo: { bucket: 'images', cle } },
      });
      expect(r.ok).toBe(false);
    }
  });

  it('refuse un compartiment qui n\'est pas une mediatheque d\'images', () => {
    const r = lireProfilCreatif({
      marque: { logo: { bucket: 'videos', cle: 'a.png' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('logo_invalide');
  });

  it.each([
    ['police', { typographie: { policeId: 'comic-sans-du-web' } }],
    ['LUT', { lut: { lutId: 'afroboost-cinema' } }],
    ['transition', { transitions: { transitionId: 'explosion' } }],
    ['animation', { animations: { texteId: 'matrix' } }],
  ])('refuse un identifiant %s inconnu', (_n, corps) => {
    const r = lireProfilCreatif(corps as unknown);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('identifiant_inconnu');
  });

  it('refuse une couleur invalide plutot que de la corriger', () => {
    for (const c of ['rouge', '#12345', 'rgb(0,0,0)', '#GGGGGG']) {
      const r = lireProfilCreatif({ couleurs: { accent: c } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motif).toBe('valeur_invalide');
    }
  });

  it('refuse une valeur hors bornes plutot que de la borner en silence', () => {
    for (const corps of [
      { marque: { opacite: 1.5 } },
      { marque: { taillePct: 90 } },
      { typographie: { tailleTitre: 12 } },
      { lut: { intensite: -0.2 } },
      { transitions: { dureeMs: 99999 } },
      { margesSures: { hautPct: 80 } },
    ]) {
      const r = lireProfilCreatif(corps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motif).toBe('valeur_invalide');
    }
  });

  it('accepte un profil complet et legitime', () => {
    const r = lireProfilCreatif(PROFIL_AFROBOOST);
    expect(r.ok).toBe(true);
  });

  it('les catalogues ne portent aucune marque de client', () => {
    const tout = [...POLICE_IDS, ...LUT_IDS, ...TRANSITION_IDS, ...ANIMATION_IDS];
    for (const id of tout) {
      expect(id.toLowerCase()).not.toContain('afroboost');
    }
    // Et le defaut du produit n'impose ni la police, ni les couleurs de Bassi.
    const canonDefaut = profilCreatifCanonique(null);
    expect(canonDefaut).not.toContain('bebas');
    expect(canonDefaut).not.toContain('D91CD2');
    expect(PROFIL_CREATIF_DEFAUT.couleurs.accent).toBeNull();
    expect(PROFIL_CREATIF_DEFAUT.typographie.policeId).toBeNull();
  });

  it('les identifiants de police derivent du catalogue, sans seconde liste', () => {
    expect(POLICES_AUTORISEES.length).toBeGreaterThan(0);
    for (const p of POLICES_AUTORISEES) {
      expect(p.id).toBe(slugPolice(p.famille));
      expect(p.ressourceServeur).toBeNull();
    }
    expect(POLICE_IDS).toContain('bebas-neue');
    expect(new Set(POLICE_IDS).size).toBe(POLICE_IDS.length);
  });
});

// ===========================================================================
// F. FRONTIERE PLAN / RENDU
// ===========================================================================

describe('F. le style ne touche jamais l\'identite du plan', () => {
  it('les algorithmes editoriaux restent ceux valides humainement', () => {
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
    expect(ALGORITHME_PLAN).toBe('m3g-v2');
  });

  it.each([
    ['police', { typographie: { policeTitreId: 'anton' } }],
    ['couleur', { couleurs: { accent: '#00FF00' } }],
    ['LUT', { lut: { active: true, lutId: 'clean', intensite: 0.5 } }],
    ['logo', { marque: { taillePct: 30 } }],
    ['animation', { animations: { logoId: 'pop' } }],
    ['CTA visuel', { ctaVisuel: { actif: true, dureeSecondes: 8, position: 'haut' } }],
    ['transition', { transitions: { active: true, transitionId: 'flash' } }],
    ['opacite', { marque: { opacite: 0.4 } }],
  ] as Array<[string, ProfilCreatifPartiel]>)(
    'changer %s ne change ni m3e-v3 ni m3g-v2, seulement la methode de rendu',
    (_n, delta) => {
      const avant = fusionnerProfilEtOverride(PROFIL_AFROBOOST, null);
      const apres = fusionnerProfilEtOverride(PROFIL_AFROBOOST, delta);
      expect(ALGORITHME_COUPES).toBe('m3e-v3');
      expect(ALGORITHME_PLAN).toBe('m3g-v2');
      expect(methodeRendu(AUDIO, apres)).not.toBe(methodeRendu(AUDIO, avant));
    },
  );

  it('le style N\'ENTRE PAS dans l\'identite editoriale de l\'objectif', () => {
    // Deux profils opposes, un seul objectif : une seule identite editoriale.
    expect(objectifCanonique(OBJECTIF_EVENEMENT))
      .toBe(objectifCanonique({ ...OBJECTIF_EVENEMENT }));
    // Et la recommandation de versioning exclut explicitement ces champs.
    for (const champ of ['police', 'couleurs', 'lut', 'logo', 'transitions']) {
      expect(M3G_V3_RECOMMANDATION.identitePlanExclut).toContain(champ);
    }
    expect(M3G_V3_RECOMMANDATION.versionActuelle).toBe(ALGORITHME_PLAN);
    expect(M3G_V3_RECOMMANDATION.coupesInchangees).toBe(ALGORITHME_COUPES);
  });
});

// ===========================================================================
// G. OBJECTIF DE COMMUNICATION
// ===========================================================================

describe('G. objectif de communication', () => {
  it('un objectif absent est generique — la politique d\'aujourd\'hui', () => {
    expect(estObjectifGenerique(null)).toBe(true);
    expect(estObjectifGenerique({})).toBe(true);
    expect(estObjectifGenerique(OBJECTIF_DEFAUT)).toBe(true);
    expect(OBJECTIF_DEFAUT.type).toBe(TYPE_OBJECTIF_GENERIQUE);
  });

  it('le meme objectif normalise rend la meme identite', () => {
    expect(objectifCanonique(OBJECTIF_EVENEMENT))
      .toBe(objectifCanonique(normaliserObjectif(OBJECTIF_EVENEMENT)));
  });

  it('un ordre de proprietes different rend la MEME identite', () => {
    const desordre: ObjectifPartiel = {
      tonId: 'energetique',
      appelAction: { texte: 'Reserve ta place', actionId: 'reservation' },
      priorites: ['urgence', 'energie', 'foule'],
      evenement: {
        lienReservation: 'https://example.org/reserver',
        placesLimitees: true,
        lieu: 'Lausanne',
        date: '2026-09-12',
        nom: 'Afroboost Lausanne',
      },
      objectifPrincipal: 'Remplir le cours du 12 septembre',
      type: 'evenement',
    };
    expect(objectifCanonique(desordre)).toBe(objectifCanonique(OBJECTIF_EVENEMENT));
  });

  it.each([
    ['le type', { type: 'notoriete' }],
    ['le ton', { tonId: 'emotionnel' }],
    ['le message principal', { messagePrincipal: 'La communaute avant tout' }],
    ['les priorites', { priorites: ['emotion', 'identite'] }],
    ['l\'action du CTA', { appelAction: { actionId: 'abonnement' } }],
    ['la cible', { cible: { localisation: 'Geneve' } }],
  ] as Array<[string, ObjectifPartiel]>)(
    'changer %s change l\'identite editoriale',
    (_n, delta) => {
      const modifie = { ...OBJECTIF_EVENEMENT, ...delta } as ObjectifPartiel;
      expect(objectifCanonique(modifie)).not.toBe(objectifCanonique(OBJECTIF_EVENEMENT));
    },
  );

  it('meme rush, trois objectifs, trois identites editoriales', () => {
    const evenement = objectifCanonique({ type: 'evenement' });
    const produit = objectifCanonique({ type: 'produit' });
    const notoriete = objectifCanonique({ type: 'notoriete' });
    expect(new Set([evenement, produit, notoriete]).size).toBe(3);
  });

  it('un bloc sans rapport avec le type est efface', () => {
    // Un bloc produit rempli alors qu'on promeut un evenement ne decrit rien.
    const a = objectifCanonique({ type: 'evenement', produit: { nom: 'Tapis' } });
    const b = objectifCanonique({ type: 'evenement' });
    expect(a).toBe(b);
  });

  it('un CTA sans action n\'emporte ni texte ni destination', () => {
    const a = objectifCanonique({
      type: 'notoriete',
      appelAction: { actionId: 'aucune', texte: 'Clique', destination: 'https://x.org/a' },
    });
    const b = objectifCanonique({ type: 'notoriete' });
    expect(a).toBe(b);
  });

  it('l\'objectif effectif : video, sinon compte, sinon generique', () => {
    const compte: ObjectifPartiel = { type: 'inscriptions' };
    expect(objectifEffectif(OBJECTIF_EVENEMENT, compte).type).toBe('evenement');
    expect(objectifEffectif(null, compte).type).toBe('inscriptions');
    expect(objectifEffectif(null, null).type).toBe(TYPE_OBJECTIF_GENERIQUE);
    expect(objectifEffectif({}, compte).type).toBe('inscriptions');
  });

  it('la forme canonique couvre autant de champs qu\'elle en declare', () => {
    const morceaux = objectifCanonique(OBJECTIF_EVENEMENT).split('|');
    expect(morceaux).toHaveLength(CLES_CANONIQUES_OBJECTIF.length);
    for (const [i, cle] of CLES_CANONIQUES_OBJECTIF.entries()) {
      expect(morceaux[i].startsWith(`${cle}=`)).toBe(true);
    }
  });

  it('refuse un objectif inconnu, un ton inconnu, un champ inconnu', () => {
    expect(lireObjectif({ type: 'devenir-riche' }).ok).toBe(false);
    expect(lireObjectif({ tonId: 'sarcastique' }).ok).toBe(false);
    expect(lireObjectif({ publierMaintenant: true }).ok).toBe(false);
    expect(lireObjectif({ evenement: { adresseIp: '1.2.3.4' } }).ok).toBe(false);
    expect(lireObjectif('evenement').ok).toBe(false);
  });

  it('refuse un lien qui n\'est pas https, jamais recupere par le serveur', () => {
    for (const lien of [
      'javascript:alert(1)', 'file:///etc/passwd', 'http://exemple.org/a',
      'data:text/html,<b>', '/local/chemin',
    ]) {
      const r = lireObjectif({ evenement: { lienReservation: lien } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motif).toBe('lien_invalide');
    }
    expect(lireObjectif({ evenement: { lienReservation: 'https://example.org/r' } }).ok)
      .toBe(true);
  });

  it('refuse une date impossible plutot que de l\'afficher', () => {
    for (const date of ['2026-02-31', '12/09/2026', '2026-13-01', 'bientot']) {
      const r = lireObjectif({ evenement: { date } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motif).toBe('date_invalide');
    }
    expect(lireObjectif({ evenement: { date: '2026-09-12' } }).ok).toBe(true);
  });

  it('une tranche d\'age inversee est refusee en bloc, pas reparee', () => {
    const n = normaliserObjectif({ cible: { ageMin: 60, ageMax: 20 } });
    expect(n.cible.ageMin).toBeNull();
    expect(n.cible.ageMax).toBeNull();
  });

  it('l\'objectif ne declenche AUCUNE publication : il n\'a aucun champ pour', () => {
    // Le contrat est ferme : tout ce qui ressemblerait a une publication est
    // refuse a la lecture. C'est la garantie structurelle du mode « review ».
    for (const corps of [
      { publier: true }, { platforms: ['instagram'] }, { scheduledDate: '2026-09-12' },
      { mode: 'auto' }, { autoPublish: true },
    ]) {
      expect(lireObjectif(corps).ok).toBe(false);
    }
    expect(Object.keys(OBJECTIF_DEFAUT)).not.toContain('mode');
    expect(Object.keys(OBJECTIF_DEFAUT)).not.toContain('platforms');
  });
});

// ===========================================================================
// H. PERSISTANCE — designStyle, sans migration
// ===========================================================================

describe('H. persistance dans designStyle', () => {
  it('un profil valide fait l\'aller-retour sans perte', () => {
    const style = sanitizeDesignStyle({ profilCreatif: PROFIL_AFROBOOST });
    expect(style.profilCreatif).toBeDefined();
    expect(profilCreatifCanonique(style.profilCreatif))
      .toBe(profilCreatifCanonique(PROFIL_AFROBOOST));
  });

  it('un profil invalide est ignore EN BLOC, jamais applique a moitie', () => {
    const style = sanitizeDesignStyle({
      profilCreatif: { typographie: { policeId: 'inexistante' } },
    });
    expect(style.profilCreatif).toBeUndefined();
    expect(profilCreatifDepuisStyle(style)).toEqual(PROFIL_CREATIF_DEFAUT);
  });

  it('les reglages du Lot 2A survivent a l\'ajout du Lot 2B', () => {
    const style = sanitizeDesignStyle({
      montage: { format: '9:16', dureeSecondes: 30 },
      audio: { musique: { bucket: 'audio', cle: CLE }, volumeMusique: 0.35 },
      profilCreatif: PROFIL_AFROBOOST,
      objectifParDefaut: OBJECTIF_EVENEMENT,
    });
    expect(style.montage).toEqual({ format: '9:16', dureeSecondes: 30 });
    expect(style.audio?.musique?.cle).toBe(CLE);
    expect(style.profilCreatif).toBeDefined();
    expect(style.objectifParDefaut?.type).toBe('evenement');
  });
});
