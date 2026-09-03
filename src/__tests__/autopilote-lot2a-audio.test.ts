import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BUCKET_MUSIQUE, RECETTE_AUDIO_DEFAUT, VOLUME_MAX, VOLUME_MIN,
  estRecetteHistorique, lireRecetteAudio, normaliserRecette, recetteCanonique,
  recettePourUsage, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import {
  METHODE_RENDU, PREFIXE_METHODE_MIX, empreinteRecette, methodeRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import { argumentsRendu, rendraDeLAudio } from '@/lib/autopilot/analyse/rendu-ffmpeg';
import { audioDepuisStyle, sanitizeDesignStyle } from '@/lib/autopilot/textStyle';

/**
 * LOT 2A — MUSIQUE, SON ORIGINAL, VOLUMES.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS PROTEGENT
 * ---------------------------------------------------------------------------
 *
 * Deux choses, et la seconde est la plus dangereuse.
 *
 * La premiere est visible : le MP4 doit reellement porter ce qui a ete
 * demande. Les assertions portent donc sur la chaine de filtres transmise a
 * ffmpeg — pas sur un booleen intermediaire, pas sur un code de retour.
 *
 * La seconde ne se voit pas : la reutilisation d'un rendu reussi est
 * STRUCTURELLE (`rush_montage_renders_reussi_unique`). Si la recette
 * n'entrait pas dans `methode_rendu`, changer de musique rendrait L'ANCIEN
 * FICHIER, sans erreur et sans message. C'est la meme panne muette que les
 * passages rejoues de m3e-v2, et la moitie de ce fichier existe pour qu'elle
 * ne se rejoue pas.
 */

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const CLE = `${UID}/music/1788334481265-titre.mp3`;

const CIBLE = { largeur: 1080, hauteur: 1920, fps: 30 };
const CROP = { x: 0, y: 0, largeur: 1080, hauteur: 1920 };

function source(ordre: number, aAudio: boolean) {
  return {
    ordre, chemin: `/tmp/x/source-0${ordre}.mp4`,
    entreeSecondes: 0, dureeRetenueSecondes: 5, crop: CROP, aAudio,
  };
}

function recette(p: Partial<RecetteAudio> = {}): RecetteAudio {
  return normaliserRecette({ ...RECETTE_AUDIO_DEFAUT, ...p });
}

const MUSIQUE = { bucket: BUCKET_MUSIQUE, cle: CLE };

/** Le graphe, isole du reste des arguments. */
function graphe(args: string[]): string {
  const i = args.indexOf('-filter_complex');
  expect(i).toBeGreaterThan(-1);
  return args[i + 1];
}

function rendre(sources: ReturnType<typeof source>[], r: RecetteAudio, avecMusique: boolean) {
  return argumentsRendu(sources, CIBLE, '/tmp/x/montage.mp4', {
    recette: r,
    musique: avecMusique ? { chemin: '/tmp/x/musique' } : null,
    dureeSecondes: 10,
  });
}

function lireSource(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), 'utf8');
}

// ---------------------------------------------------------------------------
// A a D — les quatre cas obligatoires
// ---------------------------------------------------------------------------

describe('Lot 2A — les quatre cas du mix', () => {
  it('A. aucune musique + son original : le son des rushes est conserve', () => {
    const args = rendre([source(1, true), source(2, true)], recette(), false);
    const g = graphe(args);

    expect(g).toContain('concat=n=2:v=1:a=1');
    expect(g).not.toContain('amix');
    expect(args).toContain('[aout]');
    expect(args).not.toContain('-an');
    expect(args).toContain('aac');
  });

  it('A bis. le volume demande est bien celui ecrit dans le graphe', () => {
    const g = graphe(rendre([source(1, true)], recette({ volumeSonOriginal: 0.35 }), false));
    expect(g).toContain('[aconcat]volume=0.35[aorig]');
    expect(g).toContain('[aorig]anull[aout]');
  });

  it('B. musique + son original : les DEUX entrent dans le graphe', () => {
    const r = recette({ musique: MUSIQUE, volumeMusique: 0.4, volumeSonOriginal: 0.9 });
    const args = rendre([source(1, true), source(2, true)], r, true);
    const g = graphe(args);

    expect(g).toContain('volume=0.90[aorig]');
    expect(g).toContain('volume=0.40,');
    expect(g).toContain('[aorig][amus]amix=inputs=2:duration=first:normalize=0[aout]');
    // ⚠️ `normalize=0` : sans lui, `amix` diviserait chaque entree par deux et
    // le volume demande ne serait pas celui rendu.
    expect(g).not.toMatch(/amix=[^;]*normalize=1/);
    expect(args).toContain('-stream_loop');
  });

  it('C. musique seule : le son des rushes n entre PAS dans le graphe', () => {
    const r = recette({ musique: MUSIQUE, sonOriginal: false });
    const args = rendre([source(1, true), source(2, true)], r, true);
    const g = graphe(args);

    expect(g).toContain('concat=n=2:v=1:a=0');
    expect(g).not.toContain('[aconcat]');
    expect(g).not.toContain('amix');
    expect(g).toContain('[amus]anull[aout]');
    expect(args).toContain('[aout]');
  });

  it('D. ni musique ni son original : une sortie muette, valide', () => {
    const r = recette({ sonOriginal: false });
    const args = rendre([source(1, true)], r, false);
    const g = graphe(args);

    expect(g).toContain('concat=n=1:v=1:a=0');
    expect(args).toContain('-an');
    expect(args).not.toContain('[aout]');
    expect(args).not.toContain('aac');
  });
});

// ---------------------------------------------------------------------------
// E a G — les volumes
// ---------------------------------------------------------------------------

describe('Lot 2A — les volumes', () => {
  it('E. volume musique a 0 : la piste reste EN PLACE et muette', () => {
    // ⚠️ Retirer la source changerait la presence meme d'une piste audio dans
    // le conteneur — ce que personne n'a demande en baissant un curseur.
    const r = recette({ musique: MUSIQUE, volumeMusique: 0 });
    const g = graphe(rendre([source(1, true)], r, true));
    expect(g).toContain('volume=0.00,');
    expect(g).toContain('amix=inputs=2');
  });

  it('F. volume du son original a 0 : original present et muet', () => {
    const g = graphe(rendre([source(1, true)], recette({ volumeSonOriginal: 0 }), false));
    expect(g).toContain('[aconcat]volume=0.00[aorig]');
  });

  it('G. un volume hors bornes est REFUSE, jamais borne en silence', () => {
    for (const mauvais of [1.5, -0.1, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = lireRecetteAudio({ volumeMusique: mauvais });
      expect(r.ok, `volumeMusique=${mauvais}`).toBe(false);
      if (!r.ok) expect(r.motif).toBe('volume_invalide');
    }
    for (const mauvais of [1.01, -1]) {
      const r = lireRecetteAudio({ volumeSonOriginal: mauvais });
      expect(r.ok).toBe(false);
    }
    // Les bornes elles-memes passent.
    expect(lireRecetteAudio({ volumeMusique: VOLUME_MIN }).ok).toBe(true);
    expect(lireRecetteAudio({ volumeMusique: VOLUME_MAX }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H a J — les reglages par defaut
// ---------------------------------------------------------------------------

describe('Lot 2A — defaut du compte et reglage de la video', () => {
  it('H. une ancienne `designStyle` sans audio continue de fonctionner', () => {
    const ancienne = sanitizeDesignStyle({ montage: { format: '9:16', dureeSecondes: 30 } });
    expect(ancienne.audio).toBeUndefined();
    expect(audioDepuisStyle(ancienne)).toEqual(RECETTE_AUDIO_DEFAUT);
    // Et le defaut EST le comportement historique.
    expect(estRecetteHistorique(audioDepuisStyle(ancienne))).toBe(true);
    expect(methodeRendu(audioDepuisStyle(ancienne))).toBe(METHODE_RENDU);
  });

  it('H bis. une `designStyle` invalide ne cree pas d etat incoherent', () => {
    const cassee = sanitizeDesignStyle({ audio: { volumeMusique: 42 } });
    expect(cassee.audio).toBeUndefined();
    expect(audioDepuisStyle(cassee)).toEqual(RECETTE_AUDIO_DEFAUT);
  });

  it('I. un defaut enregistre est bien relu a la creation suivante', () => {
    const enregistree = { musique: MUSIQUE, volumeMusique: 0.3, sonOriginal: false, volumeSonOriginal: 1 };
    const relu = sanitizeDesignStyle({ audio: enregistree });
    expect(relu.audio).toEqual(normaliserRecette(enregistree as RecetteAudio));
    expect(audioDepuisStyle(relu)).toEqual(normaliserRecette(enregistree as RecetteAudio));
  });

  it('J. le reglage d une video ne passe PAS par `designStyle`', () => {
    // La preuve est structurelle : la recette voyage dans le corps de
    // `POST /rendu`, et l'ecran n'ecrit `designStyle` que sur un geste dedie.
    const ecran = lireSource('src/components/creer/PassagesSuggeres.tsx');
    expect(ecran).toContain('audio,');
    // Aucune ECRITURE de `designStyle` : l'ecran ne connait que sa recette.
    expect(ecran).not.toMatch(/designStyle\s*:/);

    const chaine = lireSource('src/lib/autopilot/analyse/chaine-passerelle.ts');
    expect(chaine).toContain("body: JSON.stringify({ audio: o.audio })");
    expect(chaine).not.toMatch(/designStyle\s*:/);

    // Et le seul ecrivain du defaut est le bouton dedie.
    const panneau = lireSource('src/components/creer/AutopilotPanel.tsx');
    expect(panneau).toContain('onEnregistrerAudioDefaut');
    expect(panneau).toContain('designStyle: { ...config.designStyle, audio }');
  });
});

// ---------------------------------------------------------------------------
// K a M — duree de la musique, et clips muets
// ---------------------------------------------------------------------------

describe('Lot 2A — duree de la musique et clips sans piste', () => {
  it('K. musique plus courte : elle boucle, de facon deterministe', () => {
    const args = rendre([source(1, true)], recette({ musique: MUSIQUE }), true);
    // `-stream_loop -1` est une option d'ENTREE : elle precede son `-i`.
    const i = args.indexOf('-stream_loop');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('-1');
    expect(args[i + 2]).toBe('-i');
    expect(args[i + 3]).toBe('/tmp/x/musique');
  });

  it('L. musique plus longue : elle est coupee a la duree du montage', () => {
    const g = graphe(rendre([source(1, true)], recette({ musique: MUSIQUE }), true));
    // La duree du montage passee au moteur est 10 s.
    expect(g).toContain('atrim=duration=10');
    // ...et le fondu de sortie evite que le morceau claque a la coupe.
    expect(g).toContain('afade=t=out:st=9.5:d=0.5');
  });

  it('M. un clip sans piste audio ne fait pas echouer le rendu', () => {
    const args = rendre([source(1, true), source(2, false)], recette(), false);
    const g = graphe(args);
    // Le silence comble la source muette : `concat` exige le meme nombre de
    // flux par segment.
    expect(g).toContain('anullsrc=r=48000:cl=stereo');
    expect(g).toContain('concat=n=2:v=1:a=1');
    expect(args).toContain('[aout]');
  });

  it('M bis. clip muet + clip sonore + musique : rendu valide', () => {
    const r = recette({ musique: MUSIQUE });
    const args = rendre([source(1, true), source(2, false)], r, true);
    const g = graphe(args);
    expect(g).toContain('anullsrc');
    expect(g).toContain('amix=inputs=2');
    expect(rendraDeLAudio([source(1, true), source(2, false)], r, true)).toBe(true);
  });

  it('M ter. TOUS les clips muets, sans musique : sortie muette assumee', () => {
    const sources = [source(1, false), source(2, false)];
    const args = rendre(sources, recette(), false);
    expect(args).toContain('-an');
    expect(rendraDeLAudio(sources, recette(), false)).toBe(false);
    // Mais avec une musique, le montage redevient sonore.
    expect(rendraDeLAudio(sources, recette({ musique: MUSIQUE }), true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// L'IDENTITE DU RENDU — la panne muette
// ---------------------------------------------------------------------------

describe('Lot 2A — identite du rendu, et reutilisation du cache', () => {
  const base = recette({ musique: MUSIQUE, volumeMusique: 0.5, volumeSonOriginal: 0.8 });

  it('meme plan + MEME recette : meme identite, donc rendu reutilisable', () => {
    const jumelle = recette({ musique: { ...MUSIQUE }, volumeMusique: 0.5, volumeSonOriginal: 0.8 });
    expect(methodeRendu(jumelle)).toBe(methodeRendu(base));
    expect(recetteCanonique(jumelle)).toBe(recetteCanonique(base));
  });

  it('meme plan + MUSIQUE differente : identite differente', () => {
    const autre = recette({ ...base, musique: { bucket: BUCKET_MUSIQUE, cle: `${UID}/music/autre.mp3` } });
    expect(methodeRendu(autre)).not.toBe(methodeRendu(base));
  });

  it('meme plan + VOLUME MUSIQUE different : identite differente', () => {
    expect(methodeRendu(recette({ ...base, volumeMusique: 0.51 })))
      .not.toBe(methodeRendu(base));
  });

  it('meme plan + SON ORIGINAL different : identite differente', () => {
    expect(methodeRendu(recette({ ...base, sonOriginal: false })))
      .not.toBe(methodeRendu(base));
  });

  it('meme plan + VOLUME ORIGINAL different : identite differente', () => {
    expect(methodeRendu(recette({ ...base, volumeSonOriginal: 0.81 })))
      .not.toBe(methodeRendu(base));
  });

  it('aucune recette : le chemin historique, au caractere pres', () => {
    expect(methodeRendu(null)).toBe(METHODE_RENDU);
    expect(methodeRendu(undefined)).toBe(METHODE_RENDU);
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT)).toBe(METHODE_RENDU);
    expect(METHODE_RENDU).toBe('x264-crf23-concat-v1');

    // Et le GRAPHE aussi est celui d'avant : ni volume, ni amix, ni bus
    // intermediaire. C'est ce qui rend la reutilisation legitime.
    const avant = argumentsRendu([source(1, true), source(2, true)], CIBLE, '/tmp/x/montage.mp4');
    const apres = rendre([source(1, true), source(2, true)], RECETTE_AUDIO_DEFAUT, false);
    expect(apres).toEqual(avant);
    expect(graphe(avant)).toContain('[vout][aout]');
    expect(graphe(avant)).not.toContain('volume=');
  });

  it('l identite tient dans les 40 caracteres de la colonne', () => {
    const m = methodeRendu(base);
    expect(m.startsWith(PREFIXE_METHODE_MIX)).toBe(true);
    expect(m.length).toBeLessThanOrEqual(40);
    expect(empreinteRecette(base)).toMatch(/^[0-9a-f]{24}$/);
  });

  it('la forme canonique ne depend pas de l ordre des proprietes', () => {
    // ⚠️ LE PIEGE QUE `JSON.stringify` AURAIT LAISSE PASSER.
    const a = { musique: MUSIQUE, volumeMusique: 0.4, sonOriginal: true, volumeSonOriginal: 0.7 };
    const b = { volumeSonOriginal: 0.7, sonOriginal: true, volumeMusique: 0.4, musique: MUSIQUE };
    expect(recetteCanonique(a as RecetteAudio)).toBe(recetteCanonique(b as RecetteAudio));
    expect(empreinteRecette(a as RecetteAudio)).toBe(empreinteRecette(b as RecetteAudio));
  });

  it('deux recettes AUDITIVEMENT identiques ne paient pas deux encodages', () => {
    // Sans musique, le volume de la musique ne veut rien dire.
    expect(methodeRendu(recette({ volumeMusique: 0.1 })))
      .toBe(methodeRendu(recette({ volumeMusique: 0.9 })));
    // Son original coupe : son volume ne veut rien dire non plus.
    expect(methodeRendu(recette({ musique: MUSIQUE, sonOriginal: false, volumeSonOriginal: 0.2 })))
      .toBe(methodeRendu(recette({ musique: MUSIQUE, sonOriginal: false, volumeSonOriginal: 0.9 })));
  });

  it('la forme canonique nomme TOUS les champs de la recette', () => {
    // Ajouter un champ a `RecetteAudio` sans l'ajouter a la forme canonique
    // ferait deux recettes differentes sous une meme empreinte. Ce test casse
    // ce jour-la.
    const canon = recetteCanonique(base);
    for (const champ of ['version', 'musique', 'volumeMusique', 'sonOriginal', 'volumeSonOriginal']) {
      expect(canon).toContain(`${champ}=`);
    }
    expect(Object.keys(RECETTE_AUDIO_DEFAUT).sort())
      .toEqual(['musique', 'sonOriginal', 'volumeMusique', 'volumeSonOriginal']);
  });
});

// ---------------------------------------------------------------------------
// SECURITE — le schema ferme
// ---------------------------------------------------------------------------

describe('Lot 2A — securite du contrat', () => {
  it('une URL, un `musicUrl`, un chemin local sont REFUSES', () => {
    for (const corps of [
      { musique: { bucket: BUCKET_MUSIQUE, cle: 'https://ailleurs.test/x.mp3' } },
      { musique: { bucket: BUCKET_MUSIQUE, cle: '/etc/passwd' } },
      { musicUrl: 'https://ailleurs.test/x.mp3' },
      { musique: { url: 'https://ailleurs.test/x.mp3' } },
      { musique: { bucket: 'videos', cle: CLE } },
      { musique: { bucket: BUCKET_MUSIQUE, cle: CLE, chemin: '/tmp/x' } },
    ]) {
      const r = lireRecetteAudio(corps);
      // Soit le champ est inconnu, soit la musique est invalide — jamais accepte.
      expect(r.ok, JSON.stringify(corps)).toBe(false);
    }
  });

  it('une expression ou un argument ffmpeg est REFUSE', () => {
    for (const corps of [
      { filtre: 'amix=inputs=2' }, { args: ['-vf', 'drawtext'] },
      { codec: 'libx265' }, { crf: 10 }, { volume: 'volume=2.0' },
      { sonOriginal: 'oui' },
    ]) {
      expect(lireRecetteAudio(corps).ok, JSON.stringify(corps)).toBe(false);
    }
  });

  it('le schema est FERME : toute propriete inconnue est refusee', () => {
    const r = lireRecetteAudio({ ...RECETTE_AUDIO_DEFAUT, inconnu: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motif).toBe('champ_inconnu');
  });

  it('un corps vide ou non objet est refuse', () => {
    for (const corps of ['x', 42, [], true]) {
      expect(lireRecetteAudio(corps).ok).toBe(false);
    }
  });

  it('`usage` n archive ni URL, ni jeton, ni signature', () => {
    const u = JSON.stringify(recettePourUsage(recette({ musique: MUSIQUE, volumeMusique: 0.3 })));
    expect(u).not.toContain('://');
    for (const interdit of ['token', 'signature', 'secret', 'X-Amz', 'Expires']) {
      expect(u.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
    // ...mais il porte de quoi auditer.
    expect(u).toContain('audio-v1');
    expect(u).toContain(BUCKET_MUSIQUE);
  });

  it('la propriete de la musique est verifiee cote SERVEUR, avant le stockage', () => {
    const src = lireSource('src/lib/autopilot/analyse/musique-source.ts');
    // Le prefixe est teste AVANT le premier appel au stockage.
    expect(src.indexOf('startsWith(`${userId}/`)')).toBeLessThan(src.indexOf('statObject'));
    expect(src).toContain("piste.cle.includes('..')");
    expect(src).toContain("piste.cle.includes('://')");
    // Et la route l'appelle.
    const route = lireSource('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
    expect(route).toContain('verifierMusique(recette.musique, userId)');
    expect(route).toContain('lireRecetteAudio(champ)');
  });

  it('le moteur ne construit jamais d URL et ne sort jamais du reseau interne', () => {
    for (const f of [
      'src/lib/autopilot/analyse/recette-audio.ts',
      'src/lib/autopilot/analyse/musique-source.ts',
    ]) {
      const src = lireSource(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/\bfetch\s*\(|axios|presigned|signedUrl/i);
    }
  });
});

// ---------------------------------------------------------------------------
// N — ce que le lot ne touche PAS
// ---------------------------------------------------------------------------

describe('Lot 2A — l anti-repetition m3e-v3 est intacte', () => {
  it('aucun fichier du lot ne touche aux coupes ni aux candidats', () => {
    for (const f of [
      'src/lib/autopilot/analyse/recette-audio.ts',
      'src/lib/autopilot/analyse/musique-source.ts',
      'src/components/creer/ReglagesAudio.tsx',
    ]) {
      const src = lireSource(f);
      for (const interdit of [
        'ecarterChevauchements', 'chevauchentTrop', 'CHEVAUCHEMENT_MAX',
        'calerCoupes', 'planifierMontage', 'ALGORITHME_COUPES',
      ]) {
        expect(src, `${f} ne doit pas toucher ${interdit}`).not.toContain(interdit);
      }
    }
  });

  it('le seuil et l algorithme des coupes n ont pas bouge', () => {
    const coupes = lireSource('src/lib/autopilot/analyse/coupe-contrat.ts');
    expect(coupes).toContain("export const ALGORITHME_COUPES = 'm3e-v3'");
    expect(coupes).toContain('export const CHEVAUCHEMENT_MAX = 0.20');
    expect(coupes).toContain('export const CHEVAUCHEMENT_MIN_SECONDES = 0.25');
  });

  it('l identite du PLAN ne porte aucune trace d audio', () => {
    // ⚠️ LA DECISION D'ARCHITECTURE, GARDEE PAR UN TEST. La musique appartient
    // a la materialisation, pas au choix editorial : la faire entrer dans
    // l'identite du plan obligerait a recalculer un montage qui n'a pas bouge.
    const contrat = lireSource('src/lib/autopilot/analyse/montage-contrat.ts');
    const identite = contrat.slice(
      contrat.indexOf('export interface IdentitePlan'),
      contrat.indexOf('export interface MontagePlan'),
    );
    expect(identite.length).toBeGreaterThan(0);
    for (const interdit of ['musique', 'audio', 'volume', 'recette']) {
      expect(identite.toLowerCase(), `IdentitePlan ne doit pas porter ${interdit}`)
        .not.toContain(interdit);
    }
    // Et le moteur du plan n'importe rien de la recette.
    expect(contrat).not.toContain('recette-audio');
    expect(lireSource('src/lib/autopilot/analyse/montage.ts')).not.toContain('recette-audio');
  });
});
