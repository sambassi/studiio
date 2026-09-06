/**
 * LOT 2B ETAPE 2 — LE PROFIL CREATIF DOIT SE VOIR DANS LE MP4.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS VERIFIENT, ET POURQUOI CEUX-LA
 * ---------------------------------------------------------------------------
 *
 * Trois familles de defauts sont possibles ici, et une seule se voit a l'oeil :
 *
 *   1. LE STYLE NE S'APPLIQUE PAS. Visible, donc peu dangereux.
 *   2. LE STYLE S'APPLIQUE OU IL NE FAUT PAS — il change la duree, decale
 *      l'audio, ou reecrit le plan. Invisible a la relecture du code, fatal
 *      en production : `resultatConforme` refuserait le fichier, ou pire, le
 *      laisserait passer avec une derive A/V.
 *   3. LE STYLE CHANGE SANS QUE L'IDENTITE DE RENDU CHANGE. Le pire des
 *      trois : l'ancienne video est servie pour un nouveau style, sans une
 *      erreur nulle part.
 *
 * D'ou le dernier bloc, qui LANCE VRAIMENT ffmpeg. Une assertion sur une
 * chaine de filtres prouve qu'on a ecrit ce qu'on voulait ecrire ; elle ne
 * prouve pas que ffmpeg l'accepte, ni que la duree est tenue. Le depot a paye
 * cette lecon (`tasks/lessons.md`, 2026-09) : un test qui ne peut pas echouer
 * quand le produit est casse est une decoration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import {
  PROFIL_CREATIF_DEFAUT, estProfilHistorique, fusionnerProfilEtOverride,
  lireProfilCreatif, normaliserProfilCreatif, profilCreatifCanonique,
  CLES_CANONIQUES_PROFIL,
  type ProfilCreatifAutopilote,
} from '@/lib/autopilot/analyse/profil-creatif';
import {
  LONGUEUR_METHODE_RENDU_MAX, METHODE_RENDU, methodeRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import {
  construireStyle, filtreLook, filtreTransition, rectangleCta, rectangleLogo,
  dureeFondu, couleurFfmpeg, STYLE_NEUTRE, TRANSITIONS_NON_RENDUES,
  type ContexteStyle,
} from '@/lib/autopilot/analyse/rendu-style';
import { argumentsRendu, type SourceLocale, type CibleRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { ALGORITHME_COUPES } from '@/lib/autopilot/analyse/coupe-contrat';
import { ALGORITHME_PLAN } from '@/lib/autopilot/analyse/montage-contrat';

const executer = promisify(execFile);

// ---------------------------------------------------------------------------
// Materiel commun
// ---------------------------------------------------------------------------

const CIBLE: CibleRendu = { largeur: 1080, hauteur: 1920, fps: 30 };

function source(ordre: number, duree = 2, aAudio = true): SourceLocale {
  return {
    ordre,
    chemin: `/tmp/src-${ordre}.mp4`,
    entreeSecondes: 0,
    dureeRetenueSecondes: duree,
    crop: { largeur: 1080, hauteur: 1920, x: 0, y: 0 },
    aAudio,
  };
}

function contexte(profilClips: number[], extra: Partial<ContexteStyle> = {}): ContexteStyle {
  return {
    cible: { largeur: CIBLE.largeur, hauteur: CIBLE.hauteur },
    clips: profilClips.map((d) => ({ dureeSecondes: d })),
    dureeTotaleSecondes: profilClips.reduce((a, b) => a + b, 0),
    logo: null,
    indicePremiereEntree: profilClips.length,
    ...extra,
  };
}

function profil(patch: Record<string, unknown>): ProfilCreatifAutopilote {
  return normaliserProfilCreatif(patch as never);
}

// ---------------------------------------------------------------------------
// 1 + 2 — Le chemin historique, au caractere pres
// ---------------------------------------------------------------------------

describe('1. aucun profil — le rendu historique est rendu a l’identique', () => {
  const sources = [source(0), source(1)];

  it('le graphe sans style est EXACTEMENT le graphe sans argument de style', () => {
    const avant = argumentsRendu(sources, CIBLE, '/tmp/out.mp4');
    const apres = argumentsRendu(sources, CIBLE, '/tmp/out.mp4', null, null);
    expect(apres).toEqual(avant);
  });

  it('un STYLE_NEUTRE explicite ne change rien non plus', () => {
    const avant = argumentsRendu(sources, CIBLE, '/tmp/out.mp4');
    const apres = argumentsRendu(sources, CIBLE, '/tmp/out.mp4', null, STYLE_NEUTRE);
    expect(apres).toEqual(avant);
  });

  it('le concat ecrit [vout] directement — aucun bus intermediaire', () => {
    const args = argumentsRendu(sources, CIBLE, '/tmp/out.mp4');
    const filtre = args[args.indexOf('-filter_complex') + 1];
    expect(filtre).toContain('[vout]');
    expect(filtre).not.toContain('[vconcat]');
  });
});

describe('2. profil neutral — neutre veut dire NEUTRE', () => {
  it('lut active mais neutral n’emet aucun filtre', () => {
    const p = profil({ lut: { active: true, lutId: 'neutral', intensite: 1 } });
    expect(filtreLook(p)).toBe('');
  });

  it('intensite nulle n’emet aucun filtre, quel que soit le look', () => {
    const p = profil({ lut: { active: true, lutId: 'cinema-warm', intensite: 0 } });
    expect(filtreLook(p)).toBe('');
  });

  it('un profil qui ne demande rien rend le graphe historique', () => {
    const sources = [source(0), source(1)];
    const style = construireStyle(PROFIL_CREATIF_DEFAUT, contexte([2, 2]));
    const apres = argumentsRendu(sources, CIBLE, '/tmp/out.mp4', null, style);
    expect(apres).toEqual(argumentsRendu(sources, CIBLE, '/tmp/out.mp4'));
  });

  it('un look reel, lui, produit bien un filtre', () => {
    const p = profil({ lut: { active: true, lutId: 'vibrant', intensite: 1 } });
    expect(filtreLook(p)).toContain('eq=');
    expect(filtreLook(p)).toContain('saturation=');
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 + 15 — L'identite du rendu
// ---------------------------------------------------------------------------

describe('3. changer de look change l’identite du rendu', () => {
  it('deux looks differents donnent deux methodes differentes', () => {
    const chaud = profil({ lut: { active: true, lutId: 'cinema-warm', intensite: 1 } });
    const froid = profil({ lut: { active: true, lutId: 'cinema-cool', intensite: 1 } });
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, chaud))
      .not.toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, froid));
  });

  it('changer la seule intensite change aussi la methode', () => {
    const a = profil({ lut: { active: true, lutId: 'vibrant', intensite: 1 } });
    const b = profil({ lut: { active: true, lutId: 'vibrant', intensite: 0.5 } });
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, a))
      .not.toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, b));
  });

  it('un profil historique garde la methode historique — les rendus passes restent servis', () => {
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, PROFIL_CREATIF_DEFAUT)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, null)).toBe(METHODE_RENDU);
    expect(estProfilHistorique(PROFIL_CREATIF_DEFAUT)).toBe(true);
  });
});

describe('4. le meme profil canonique donne la meme identite', () => {
  it('deux objets construits dans un ordre different rendent la meme methode', () => {
    const a = normaliserProfilCreatif({
      lut: { active: true, lutId: 'clean', intensite: 0.8 },
      couleurs: { accent: '#ff00aa' },
    } as never);
    const b = normaliserProfilCreatif({
      couleurs: { accent: '#FF00AA' },
      lut: { intensite: 0.8, lutId: 'clean', active: true },
    } as never);
    expect(profilCreatifCanonique(a)).toBe(profilCreatifCanonique(b));
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, a))
      .toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, b));
  });

  it('l’empreinte est stable d’un appel a l’autre', () => {
    const p = profil({ transitions: { active: true, transitionId: 'flash', dureeMs: 250 } });
    const m = methodeRendu(RECETTE_AUDIO_DEFAUT, p);
    for (let i = 0; i < 5; i += 1) {
      expect(methodeRendu(RECETTE_AUDIO_DEFAUT, p)).toBe(m);
    }
  });
});

describe('15. la methode de rendu tient dans la colonne', () => {
  it('elle ne depasse jamais 40 caracteres, meme avec audio ET profil', () => {
    const p = profil({
      lut: { active: true, lutId: 'cinema-warm', intensite: 0.77 },
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'u/logo.png' }, taillePct: 20 },
      couleurs: { accent: '#123456', primaire: '#ABCDEF' },
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 480, intensite: 0.9 },
      margesSures: { hautPct: 5, basPct: 7, gauchePct: 3, droitePct: 3 },
    });
    const recette = {
      ...RECETTE_AUDIO_DEFAUT,
      volumeMusique: 0.42,
      musique: { bucket: 'audio' as const, cle: 'u/tres/longue/cle/de/musique.mp3' },
    };
    const m = methodeRendu(recette as never, p);
    expect(m.length).toBeLessThanOrEqual(LONGUEUR_METHODE_RENDU_MAX);
    expect(m.startsWith('x264-pc-v1-')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5 a 8 — Ce que le contrat REFUSE
// ---------------------------------------------------------------------------

describe('5. un identifiant de LUT inconnu est REFUSE, pas ignore', () => {
  it('refuse un lutId absent du catalogue', () => {
    const r = lireProfilCreatif({ lut: { active: true, lutId: 'afroboost-cinema' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('identifiant_inconnu');
  });

  it('refuse un chemin de fichier deguise en identifiant', () => {
    const r = lireProfilCreatif({ lut: { active: true, lutId: '/etc/passwd' } });
    expect(r.ok).toBe(false);
  });

  it('refuse un champ inconnu qui ressemblerait a un chemin', () => {
    const r = lireProfilCreatif({ lut: { active: true, lutPath: '/tmp/x.cube' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('champ_inconnu');
  });
});

describe('6. une couleur invalide est REFUSEE', () => {
  it('refuse une chaine qui n’est pas un hex', () => {
    expect(lireProfilCreatif({ couleurs: { accent: 'rouge' } }).ok).toBe(false);
  });

  it('refuse une couleur qui tenterait d’ajouter une option ffmpeg', () => {
    expect(lireProfilCreatif({ couleurs: { accent: '#FFF:t=fill' } }).ok).toBe(false);
  });

  it('la garde du moteur refuse aussi, meme si la normalisation etait contournee', () => {
    expect(couleurFfmpeg('#FF00AA')).toBe('#FF00AA');
    expect(couleurFfmpeg('#ff00aa')).toBeNull();
    expect(couleurFfmpeg('black@0.5')).toBeNull();
    expect(couleurFfmpeg("#FFFFFF'\\,drawbox=x=0")).toBeNull();
  });
});

describe('7. une opacite hors borne est REFUSEE', () => {
  it('refuse 1.5', () => {
    const r = lireProfilCreatif({ marque: { opacite: 1.5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('valeur_invalide');
  });

  it('refuse une valeur negative', () => {
    expect(lireProfilCreatif({ marque: { opacite: -0.2 } }).ok).toBe(false);
  });

  it('accepte les bornes elles-memes', () => {
    expect(lireProfilCreatif({ marque: { opacite: 0 } }).ok).toBe(true);
    expect(lireProfilCreatif({ marque: { opacite: 1 } }).ok).toBe(true);
  });
});

describe('8. une position hors catalogue est REFUSEE', () => {
  it('refuse une position de logo inventee', () => {
    const r = lireProfilCreatif({ marque: { position: 'milieu-droite' } });
    expect(r.ok).toBe(false);
  });

  it('refuse une transition inventee', () => {
    const r = lireProfilCreatif({ transitions: { transitionId: 'morph' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('identifiant_inconnu');
  });

  it('refuse une animation inventee', () => {
    expect(lireProfilCreatif({ animations: { texteId: 'explosion' } }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9 — La propriete du logo
// ---------------------------------------------------------------------------

const statObject = vi.fn();
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({ statObject: (...a: unknown[]) => statObject(...a) }),
  lecteurMinio: vi.fn(),
}));

describe('9. le logo d’un autre compte est REFUSE, avant tout acces au stockage', () => {
  beforeEach(() => {
    statObject.mockReset();
    statObject.mockResolvedValue({ size: 4096, metaData: { 'content-type': 'image/png' } });
  });

  it('refuse une cle qui ne porte pas le prefixe du compte', async () => {
    const { verifierLogo } = await import('@/lib/autopilot/analyse/logo-source');
    const r = await verifierLogo({ bucket: 'images', cle: 'autre-user/logo.png' }, 'moi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('logo_hors_perimetre');
    // ⚠️ LE POINT DU TEST : le stockage n'a MEME PAS ete interroge. Une
    // reponse qui distinguerait « pas a toi » de « n'existe pas » ferait de
    // cette route un revelateur d'existence.
    expect(statObject).not.toHaveBeenCalled();
  });

  it('refuse un compartiment hors liste, sans acces au stockage', async () => {
    const { verifierLogo } = await import('@/lib/autopilot/analyse/logo-source');
    const r = await verifierLogo(
      { bucket: 'videos' as never, cle: 'moi/logo.png' }, 'moi',
    );
    expect(r.ok).toBe(false);
    expect(statObject).not.toHaveBeenCalled();
  });

  it('refuse une remontee de repertoire', async () => {
    const { verifierLogo } = await import('@/lib/autopilot/analyse/logo-source');
    const r = await verifierLogo({ bucket: 'images', cle: 'moi/../autre/logo.png' }, 'moi');
    expect(r.ok).toBe(false);
    expect(statObject).not.toHaveBeenCalled();
  });

  it('accepte le logo du compte, lui', async () => {
    const { verifierLogo } = await import('@/lib/autopilot/analyse/logo-source');
    const r = await verifierLogo({ bucket: 'images', cle: 'moi/logo.png' }, 'moi');
    expect(r.ok).toBe(true);
    expect(statObject).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 10 — L'override de video n'ecrase pas le profil par defaut
// ---------------------------------------------------------------------------

describe('10. un override de video ne modifie jamais le profil par defaut', () => {
  it('la fusion est PURE : le profil source ressort inchange', () => {
    const compte = normaliserProfilCreatif({
      lut: { active: true, lutId: 'clean', intensite: 0.6 },
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 400, intensite: 0.3 },
    } as never);
    const empreinteAvant = profilCreatifCanonique(compte);

    const effectif = fusionnerProfilEtOverride(compte, {
      transitions: { transitionId: 'flash' },
    });

    expect(profilCreatifCanonique(compte)).toBe(empreinteAvant);
    expect(effectif.transitions.transitionId).toBe('flash');
  });

  it('la fusion se fait PROPRIETE PAR PROPRIETE, pas bloc par bloc', () => {
    const compte = normaliserProfilCreatif({
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 400, intensite: 0.3 },
    } as never);
    const effectif = fusionnerProfilEtOverride(compte, {
      transitions: { transitionId: 'flash' },
    });
    // La duree et l'intensite reglees par l'utilisateur SURVIVENT.
    expect(effectif.transitions.dureeMs).toBe(400);
    expect(effectif.transitions.intensite).toBe(0.3);
  });

  it('le profil par defaut du produit est fige et ne peut pas etre mute', () => {
    expect(Object.isFrozen(PROFIL_CREATIF_DEFAUT)).toBe(true);
    expect(Object.isFrozen(PROFIL_CREATIF_DEFAUT.marque)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11 — L'audio du Lot 2A reste intact
// ---------------------------------------------------------------------------

describe('11. le style ne touche jamais au graphe audio du Lot 2A', () => {
  const sources = [source(0, 2, true), source(1, 3, true)];
  const audio = {
    recette: { ...RECETTE_AUDIO_DEFAUT, volumeSonOriginal: 0.6 },
    musique: { chemin: '/tmp/musique' },
    dureeSecondes: 5,
  };

  function partieAudio(filtre: string): string[] {
    return filtre.split(';').filter((c) => /\[a\d|\[aconcat\]|\[aorig\]|\[amus\]|\[aout\]/.test(c));
  }

  it('la moitie audio du graphe est identique avec et sans style', () => {
    const p = profil({
      lut: { active: true, lutId: 'vibrant', intensite: 1 },
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 300 },
    });
    const style = construireStyle(p, contexte([2, 3], { indicePremiereEntree: 3 }));

    const sans = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', audio as never);
    const avec = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', audio as never, style);

    expect(partieAudio(avec[avec.indexOf('-filter_complex') + 1]))
      .toEqual(partieAudio(sans[sans.indexOf('-filter_complex') + 1]));
  });

  it('les options d’encodage audio sont identiques', () => {
    const p = profil({ lut: { active: true, lutId: 'clean', intensite: 1 } });
    const style = construireStyle(p, contexte([2, 3], { indicePremiereEntree: 3 }));
    const sans = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', audio as never);
    const avec = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', audio as never, style);
    for (const o of ['-c:a', '-b:a', '-ar', '-ac']) {
      expect(avec[avec.indexOf(o) + 1]).toBe(sans[sans.indexOf(o) + 1]);
    }
  });

  it('l’entree du logo se place APRES celle de la musique — jamais devant', () => {
    const p = profil({
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'moi/logo.png' }, taillePct: 15 },
    });
    const style = construireStyle(p, contexte([2, 3], {
      logo: { chemin: '/tmp/logo', largeur: 200, hauteur: 100 },
      indicePremiereEntree: 3,
    }));
    const args = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', audio as never, style);
    const entrees = args.reduce<number[]>((acc, v, i) => (v === '-i' ? [...acc, i] : acc), []);
    // 2 clips + 1 musique + 1 logo, dans cet ordre.
    expect(entrees).toHaveLength(4);
    expect(args[entrees[2] + 1]).toBe('/tmp/musique');
    expect(args[entrees[3] + 1]).toBe('/tmp/logo');
    // Et le graphe designe bien l'entree 3 pour le logo.
    const filtre = args[args.indexOf('-filter_complex') + 1];
    expect(filtre).toContain('[3:v]format=rgba');
  });
});

// ---------------------------------------------------------------------------
// 12 + 13 + 14 — Le plan n'a pas bouge
// ---------------------------------------------------------------------------

describe('12 + 13. les algorithmes de plan sont INCHANGES', () => {
  it('m3e-v3 pour les coupes', () => {
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
  });

  it('m3g-v2 pour le montage — pas de m3g-v3 dans ce lot', () => {
    expect(ALGORITHME_PLAN).toBe('m3g-v2');
  });

  it('le style ne touche ni trim, ni crop, ni l’ordre du concat', () => {
    const sources = [source(0, 2), source(1, 3)];
    const p = profil({
      lut: { active: true, lutId: 'cinema-cool', intensite: 1 },
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 300 },
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'moi/l.png' } },
      couleurs: { accent: '#112233' },
      ctaVisuel: { actif: true, dureeSecondes: 2 },
    });
    const style = construireStyle(p, contexte([2, 3], {
      logo: { chemin: '/tmp/logo', largeur: 200, hauteur: 100 },
    }));
    const filtre = argumentsRendu(sources, CIBLE, '/tmp/o.mp4', null, style)[
      argumentsRendu(sources, CIBLE, '/tmp/o.mp4', null, style).indexOf('-filter_complex') + 1
    ];
    const reference = argumentsRendu(sources, CIBLE, '/tmp/o.mp4');
    const filtreRef = reference[reference.indexOf('-filter_complex') + 1];

    for (const morceau of ['trim=start=0:duration=2', 'trim=start=0:duration=3',
      'crop=1080:1920:0:0', 'scale=1080:1920:flags=bicubic', 'concat=n=2:v=1']) {
      expect(filtreRef).toContain(morceau);
      expect(filtre).toContain(morceau);
    }
  });

  it('aucun fragment de style n’entre dans un trim', () => {
    const p = profil({ lut: { active: true, lutId: 'vibrant', intensite: 1 } });
    const style = construireStyle(p, contexte([2, 3]));
    for (const f of style.fragmentsParClip) {
      expect(f).not.toContain('trim');
      expect(f).not.toContain('setpts');
    }
  });
});

describe('14. l’ObjectifCommunication n’entre dans AUCUNE empreinte de ce lot', () => {
  it('la forme canonique du profil ne porte aucune cle d’objectif', () => {
    const interdits = ['objectif', 'audience', 'ton', 'cta.action', 'preuve', 'priorite'];
    for (const cle of CLES_CANONIQUES_PROFIL) {
      for (const i of interdits) {
        expect(cle.toLowerCase()).not.toContain(i);
      }
    }
  });

  it('la forme canonique ignore une donnee d’objectif qu’on tenterait d’y glisser', () => {
    const avec = profilCreatifCanonique({
      // @ts-expect-error — champ volontairement etranger au profil creatif
      objectif: { type: 'vente', ton: 'direct' },
      lut: { active: true, lutId: 'clean', intensite: 1 },
    });
    const sans = profilCreatifCanonique({
      lut: { active: true, lutId: 'clean', intensite: 1 },
    });
    expect(avec).toBe(sans);
  });

  it('le champ `cta` de l’empreinte est VISUEL, pas strategique', () => {
    expect(CLES_CANONIQUES_PROFIL).toContain('cta.modele');
    expect(CLES_CANONIQUES_PROFIL).toContain('cta.position');
    expect(CLES_CANONIQUES_PROFIL).not.toContain('cta.message');
  });
});

// ---------------------------------------------------------------------------
// Geometrie et bornes — ce qui se calcule en TypeScript
// ---------------------------------------------------------------------------

describe('geometrie : tout est calcule ici, borne, et pair', () => {
  it('le logo respecte sa position et ses marges sures', () => {
    const p = profil({
      marque: {
        logoActif: true, logo: { bucket: 'images', cle: 'moi/l.png' },
        position: 'bas-droite', taillePct: 10, opacite: 1,
      },
      margesSures: { hautPct: 5, basPct: 5, gauchePct: 4, droitePct: 4 },
    });
    const r = rectangleLogo(p, { largeur: 1080, hauteur: 1920 },
      { chemin: '/x', largeur: 400, hauteur: 200 });
    expect(r.largeur % 2).toBe(0);
    expect(r.hauteur % 2).toBe(0);
    // 10 % de 1080 = 108, rapport 0,5 -> 54 de haut.
    expect(r.largeur).toBe(108);
    expect(r.hauteur).toBe(54);
    // Bas-droite : marge droite 4 % de 1080 = 43, marge basse 5 % de 1920 = 96.
    expect(r.x).toBe(1080 - 43 - 108);
    expect(r.y).toBe(1920 - 96 - 54);
  });

  it('le logo reste DANS le cadre, meme avec des marges absurdes', () => {
    const p = profil({
      marque: {
        logoActif: true, logo: { bucket: 'images', cle: 'moi/l.png' },
        position: 'bas-droite', taillePct: 50,
      },
      margesSures: { hautPct: 40, basPct: 40, gauchePct: 40, droitePct: 40 },
    });
    const r = rectangleLogo(p, { largeur: 1080, hauteur: 1920 },
      { chemin: '/x', largeur: 100, hauteur: 400 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.largeur).toBeLessThanOrEqual(1080);
    expect(r.y + r.hauteur).toBeLessThanOrEqual(1920);
  });

  it('le CTA visuel reste dans le cadre', () => {
    for (const position of ['haut', 'centre', 'bas'] as const) {
      const p = profil({
        ctaVisuel: { actif: true, position },
        margesSures: { hautPct: 8, basPct: 8, gauchePct: 6, droitePct: 6 },
      });
      const r = rectangleCta(p, { largeur: 1080, hauteur: 1920 });
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.largeur).toBeLessThanOrEqual(1080);
      expect(r.y + r.hauteur).toBeLessThanOrEqual(1920);
    }
  });

  it('un fondu ne depasse jamais la moitie du plan', () => {
    expect(dureeFondu(3000, 0.4)).toBe(0.2);
    expect(dureeFondu(300, 10)).toBe(0.3);
    expect(dureeFondu(0, 10)).toBe(0);
  });

  it('le premier plan n’a pas de fondu d’entree, le dernier pas de fondu de sortie', () => {
    const p = profil({ transitions: { active: true, transitionId: 'crossfade', dureeMs: 300 } });
    const premier = filtreTransition(p, 0, 3, 2);
    const milieu = filtreTransition(p, 1, 3, 2);
    const dernier = filtreTransition(p, 2, 3, 2);
    expect(premier).not.toContain('t=in');
    expect(premier).toContain('t=out');
    expect(milieu).toContain('t=in');
    expect(milieu).toContain('t=out');
    expect(dernier).toContain('t=in');
    expect(dernier).not.toContain('t=out');
  });

  it('un clip unique ne recoit aucun fondu — il n’y a aucune jonction', () => {
    const p = profil({ transitions: { active: true, transitionId: 'crossfade', dureeMs: 300 } });
    expect(filtreTransition(p, 0, 1, 5)).toBe('');
  });

  it('les transitions que ce lot ne rend pas sont TRACEES, jamais silencieuses', () => {
    for (const id of TRANSITIONS_NON_RENDUES) {
      const p = profil({ transitions: { active: true, transitionId: id, dureeMs: 300 } });
      const style = construireStyle(p, contexte([2, 2]));
      expect(style.transitionsNonRendues).toContain(id);
      // Rendues comme `cut` : aucun effet approximatif non demande.
      expect(style.fragmentsParClip.every((f) => !f.includes('fade'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// LA PREUVE — ffmpeg execute vraiment le graphe
// ---------------------------------------------------------------------------

async function ffmpegDisponible(): Promise<boolean> {
  try { await executer('ffmpeg', ['-hide_banner', '-version']); return true; } catch { return false; }
}

const AVEC_FFMPEG = await ffmpegDisponible();

describe.skipIf(!AVEC_FFMPEG)('PREUVE — ffmpeg accepte le graphe et la duree est tenue', () => {
  let dossier = '';

  async function fabriquerRush(chemin: string, secondes: number, teinte: string) {
    await executer('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${teinte}:s=320x568:r=30:d=${secondes}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secondes}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-y', chemin,
    ]);
  }

  async function fabriquerLogo(chemin: string) {
    await executer('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=white:s=100x50:d=1', '-frames:v', '1',
      '-y', chemin,
    ]);
  }

  async function mesurer(fichier: string) {
    const { stdout } = await executer('ffprobe', [
      '-hide_banner', '-loglevel', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', fichier,
    ]);
    const o = JSON.parse(stdout) as {
      format: { duration: string };
      streams: Array<{ codec_type: string; duration?: string }>;
    };
    return {
      duree: Number(o.format.duration),
      video: o.streams.filter((s) => s.codec_type === 'video').length,
      audio: o.streams.filter((s) => s.codec_type === 'audio').length,
      dureeAudio: Number(o.streams.find((s) => s.codec_type === 'audio')?.duration ?? 0),
      dureeVideo: Number(o.streams.find((s) => s.codec_type === 'video')?.duration ?? 0),
    };
  }

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'studiio-lot2b-'));
  });

  it('rend un montage complet : look + transitions + logo + CTA, duree INTACTE', async () => {
    const a = join(dossier, 'a.mp4');
    const b = join(dossier, 'b.mp4');
    const logo = join(dossier, 'logo.png');
    await fabriquerRush(a, 2, 'red');
    await fabriquerRush(b, 3, 'blue');
    await fabriquerLogo(logo);

    const cible: CibleRendu = { largeur: 320, hauteur: 568, fps: 30 };
    const sources: SourceLocale[] = [
      { ordre: 0, chemin: a, entreeSecondes: 0, dureeRetenueSecondes: 2,
        crop: { largeur: 320, hauteur: 568, x: 0, y: 0 }, aAudio: true },
      { ordre: 1, chemin: b, entreeSecondes: 0, dureeRetenueSecondes: 3,
        crop: { largeur: 320, hauteur: 568, x: 0, y: 0 }, aAudio: true },
    ];

    const p = profil({
      lut: { active: true, lutId: 'cinema-warm', intensite: 0.8 },
      transitions: { active: true, transitionId: 'crossfade', dureeMs: 300 },
      marque: {
        logoActif: true, logo: { bucket: 'images', cle: 'moi/logo.png' },
        position: 'bas-droite', taillePct: 20, opacite: 0.8,
      },
      couleurs: { accent: '#FF00AA' },
      ctaVisuel: { actif: true, dureeSecondes: 2, position: 'bas' },
      margesSures: { hautPct: 4, basPct: 4, gauchePct: 4, droitePct: 4 },
    });

    const style = construireStyle(p, {
      cible: { largeur: 320, hauteur: 568 },
      clips: [{ dureeSecondes: 2 }, { dureeSecondes: 3 }],
      dureeTotaleSecondes: 5,
      logo: { chemin: logo, largeur: 100, hauteur: 50 },
      indicePremiereEntree: 2,
    });
    // Le style demande bien quelque chose.
    expect(style.post).not.toBe('');
    expect(style.fragmentsParClip.some((f) => f.length > 0)).toBe(true);

    const sortie = join(dossier, 'montage.mp4');
    const args = argumentsRendu(sources, cible, sortie, {
      recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: 5,
    }, style);

    // ⚠️ CE `await` EST LE TEST. Un graphe mal forme fait sortir ffmpeg en
    // erreur, et `execFile` rejette.
    await executer('ffmpeg', args);
    await stat(sortie);

    const m = await mesurer(sortie);
    expect(m.video).toBe(1);
    // Le son du Lot 2A est LA.
    expect(m.audio).toBe(1);
    // 2 + 3 = 5 s. La tolerance couvre l'arrondi de trame, pas une derive.
    expect(Math.abs(m.duree - 5)).toBeLessThan(0.15);
    // Et les deux pistes ne derivent pas l'une par rapport a l'autre.
    expect(Math.abs(m.dureeAudio - m.dureeVideo)).toBeLessThan(0.15);

    await rm(dossier, { recursive: true, force: true });
  }, 120_000);

  it('la duree est la MEME avec et sans style — le plan n’a pas bouge', async () => {
    const a = join(dossier, 'a.mp4');
    const b = join(dossier, 'b.mp4');
    await fabriquerRush(a, 2, 'green');
    await fabriquerRush(b, 2, 'black');

    const cible: CibleRendu = { largeur: 320, hauteur: 568, fps: 30 };
    const sources: SourceLocale[] = [
      { ordre: 0, chemin: a, entreeSecondes: 0, dureeRetenueSecondes: 2,
        crop: { largeur: 320, hauteur: 568, x: 0, y: 0 }, aAudio: true },
      { ordre: 1, chemin: b, entreeSecondes: 0, dureeRetenueSecondes: 2,
        crop: { largeur: 320, hauteur: 568, x: 0, y: 0 }, aAudio: true },
    ];
    const audio = { recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: 4 };

    const sansStyle = join(dossier, 'sans.mp4');
    await executer('ffmpeg', argumentsRendu(sources, cible, sansStyle, audio));

    const p = profil({
      lut: { active: true, lutId: 'vibrant', intensite: 1 },
      transitions: { active: true, transitionId: 'flash', dureeMs: 400 },
    });
    const style = construireStyle(p, {
      cible: { largeur: 320, hauteur: 568 },
      clips: [{ dureeSecondes: 2 }, { dureeSecondes: 2 }],
      dureeTotaleSecondes: 4, logo: null, indicePremiereEntree: 2,
    });
    const avecStyle = join(dossier, 'avec.mp4');
    await executer('ffmpeg', argumentsRendu(sources, cible, avecStyle, audio, style));

    const sans = await mesurer(sansStyle);
    const avec = await mesurer(avecStyle);
    expect(Math.abs(avec.duree - sans.duree)).toBeLessThan(0.05);
    expect(avec.audio).toBe(sans.audio);

    await rm(dossier, { recursive: true, force: true });
  }, 120_000);
});
