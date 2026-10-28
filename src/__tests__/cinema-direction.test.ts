// @vitest-environment node
/**
 * CINEMA IA — DIRECTION ARTISTIQUE : styles et mouvements de camera.
 *
 * Ce qui compte : les choix ATTEIGNENT la demande envoyee au fournisseur. Le fournisseur est
 * un double qui CAPTURE ce qu'il recoit (aucun appel reel, aucune depense).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { construirePromptImage } from '@/lib/ai/prompt-image';
import {
  STYLES_CINEMA, IDS_STYLES, styleEffectif, styleCinema, estStyleCinema,
} from '@/lib/cinema/direction/styles';
import {
  CAMERAS_CINEMA, IDS_CAMERAS, cameraAutomatique, cameraEffective, cameraCinema, estCameraCinema,
} from '@/lib/cinema/direction/camera';
import {
  blocStyle, directionDuPlan, promptImageAvecDirection, promptVideoAvecDirection, MARQUEUR_ORIGINAL, CAMERA_FIGEE,
} from '@/lib/cinema/direction/prompt';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration, type FournisseurGenerationIA,
} from '@/lib/cinema/generation/fournisseur';
import { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } from '@/lib/cinema/generation/replicate';
import { devisGeneration } from '@/lib/cinema/generation/couts';
import { devisFilm } from '@/lib/cinema/couts';
import { empreinteScene } from '@/lib/cinema/empreinte';
import { appliquerPatch } from '@/lib/cinema/patch';
import type { Film, IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Nina dit : « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const unFilm = (extra: Partial<Film> = {}): Film => ({
  ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-dir' }),
  proprietaire: 'u1', directionActive: true, ...extra,
});

describe('les six styles sont reels et DISTINCTS', () => {
  it('six styles, identifiants uniques et connus', () => {
    expect(STYLES_CINEMA).toHaveLength(6);
    expect(new Set(IDS_STYLES).size).toBe(6);
    expect([...IDS_STYLES].sort()).toEqual(['documentaire', 'noir', 'publicite', 'realiste', 'romantique', 'scifi']);
    expect(STYLES_CINEMA.map((s) => s.libelle)).toEqual([
      'Cinéma réaliste', 'Film noir', 'Publicité premium', 'Romantique', 'Documentaire', 'Science-fiction',
    ]);
  });

  it.each(['profil', 'eclairage', 'palette', 'ambiance', 'texture'] as const)('descripteur « %s » : six valeurs differentes, aucune vide', (cle) => {
    const valeurs = STYLES_CINEMA.map((s) => s.prompt[cle]);
    expect(new Set(valeurs).size).toBe(6);
    for (const v of valeurs) expect(v.trim().length).toBeGreaterThan(15);
  });

  it('chaque style a profil, eclairage, palette, ambiance, texture ET leur resume francais', () => {
    for (const s of STYLES_CINEMA) {
      expect(Object.keys(s.prompt).sort()).toEqual(['ambiance', 'eclairage', 'palette', 'profil', 'texture']);
      expect(Object.keys(s.detail).sort()).toEqual(['ambiance', 'eclairage', 'palette', 'texture']);
      expect(s.resume.length).toBeGreaterThan(10);
    }
  });

  it('les blocs de prompt sont tous differents, et chacun garde le CONTENU intact', () => {
    const blocs = STYLES_CINEMA.map(blocStyle);
    expect(new Set(blocs).size).toBe(6);
    for (const b of blocs) {
      expect(b).toContain('do not change the characters, their appearance, the dialogue or the setting');
      expect(b).toMatch(/^Cinematic style: /);
    }
    // Un trait propre a chaque style se retrouve dans SON bloc et dans aucun autre.
    const trait: Record<IdStyleCinema, RegExp> = {
      realiste: /35mm/, noir: /venetian blind/, publicite: /rim light/, romantique: /golden hour/, documentaire: /available ambient light/, scifi: /neon/,
    };
    for (const s of STYLES_CINEMA) {
      for (const autre of STYLES_CINEMA) expect(trait[s.id].test(blocStyle(autre)), `${s.id} vs ${autre.id}`).toBe(s.id === autre.id);
    }
  });

  it('miniatures : six fichiers statiques, DISTINCTS, sans texte incruste, jamais presentes comme generees', () => {
    const contenus = STYLES_CINEMA.map((s) => {
      expect(s.miniature).toMatch(/^\/cinema-styles\/[a-z]+\.svg$/);
      const f = join('public', s.miniature);
      expect(existsSync(f), f).toBe(true);
      return readFileSync(f, 'utf8');
    });
    expect(new Set(contenus).size).toBe(6);
    for (const c of contenus) {
      expect(c).toMatch(/^<svg[^>]*xmlns/);
      expect(c).not.toMatch(/<text\b/);
    }
  });
});

describe('style effectif : l’exception de scene l’emporte, puis le film, sinon rien', () => {
  const scene = (styleCinema?: IdStyleCinema) => ({ styleCinema });
  it('exception > film > aucun', () => {
    expect(styleEffectif({ styleCinema: 'noir' }, scene('romantique'))?.id).toBe('romantique');
    expect(styleEffectif({ styleCinema: 'noir' }, scene())?.id).toBe('noir');
    expect(styleEffectif({}, scene())).toBeNull();
    expect(styleEffectif({}, null)).toBeNull();
    expect(styleEffectif({ styleCinema: 'scifi' }, null)?.id).toBe('scifi');
  });
  it('un identifiant altere vaut « aucun » — jamais un style devine', () => {
    expect(styleEffectif({ styleCinema: 'inconnu' as never }, scene())).toBeNull();
    expect(styleEffectif({ styleCinema: 'noir' }, scene('inconnu' as never))?.id).toBe('noir');
    expect(estStyleCinema('noir')).toBe(true);
    expect(estStyleCinema('inconnu')).toBe(false);
    expect(styleCinema(null)).toBeNull();
  });
});

describe('mouvements de camera', () => {
  it('huit options, dont l’automatique par defaut ; chacune a une formulation distincte', () => {
    expect(IDS_CAMERAS).toEqual(['auto', 'fixe', 'travelling_avant', 'travelling_arriere', 'pano_gauche', 'pano_droite', 'suivi_lateral', 'orbite']);
    expect(CAMERAS_CINEMA[0].id).toBe('auto');
    const phrases = CAMERAS_CINEMA.filter((c) => c.id !== 'auto').map((c) => c.prompt!);
    expect(phrases).toHaveLength(7);
    expect(new Set(phrases).size).toBe(7);
    expect(cameraCinema('auto').prompt).toBeNull();
    expect(estCameraCinema('orbite')).toBe(true);
    expect(estCameraCinema('zoom_fou')).toBe(false);
  });

  const plan = (o: Partial<{ cadre: 'ensemble' | 'moyen' | 'rapproche' | 'insert'; description: string; dialogue: { texte: string } | null }> = {}) =>
    ({ cadre: 'moyen' as const, description: 'Nina attend.', dialogue: null, ...o });

  it.each([
    ['insert → fixe', plan({ cadre: 'insert' }), 'resolution', 'fixe'],
    ['sujet qui marche → suivi lateral', plan({ description: 'Nina marche vers le ring.' }), 'exposition', 'suivi_lateral'],
    ['sujet qui entre (accents/casse) → suivi lateral', plan({ description: 'Nina ENTRE dans la salle.' }), 'incident', 'suivi_lateral'],
    ['replique en gros plan → travelling avant', plan({ cadre: 'rapproche', dialogue: { texte: 'je tiens' } }), 'resolution', 'travelling_avant'],
    ['confrontation → orbite', plan({ description: 'Marco fixe Nina.' }), 'confrontation', 'orbite'],
    ['incident → suivi lateral', plan({ description: 'La corde casse.' }), 'incident', 'suivi_lateral'],
    ['resolution → travelling arriere', plan({ description: 'Le calme revient.' }), 'resolution', 'travelling_arriere'],
    ['epilogue → travelling arriere', plan({ description: 'Le jour se leve.' }), 'epilogue', 'travelling_arriere'],
    ['exposition en plan d’ensemble → panoramique droit', plan({ cadre: 'ensemble', description: 'La salle vide.' }), 'exposition', 'pano_droite'],
    ['exposition en plan moyen → travelling avant', plan({ description: 'Nina attend.' }), 'exposition', 'travelling_avant'],
  ] as const)('automatique : %s', (_n, p, intention, attendu) => {
    expect(cameraAutomatique(p, { intention })).toBe(attendu);
  });

  it('l’automatique ne renvoie JAMAIS « auto », meme sans scene ; le choix de l’utilisateur est respecte', () => {
    for (const intention of ['exposition', 'incident', 'confrontation', 'resolution', 'epilogue'] as const) {
      for (const cadre of ['ensemble', 'moyen', 'rapproche', 'insert'] as const) {
        expect(cameraAutomatique(plan({ cadre }), { intention })).not.toBe('auto');
      }
    }
    expect(cameraAutomatique(plan(), null)).not.toBe('auto');
    expect(cameraEffective({ ...plan(), camera: 'orbite' }, { intention: 'resolution' })).toMatchObject({ choix: 'orbite', effective: 'orbite', automatique: false });
    expect(cameraEffective(plan(), { intention: 'resolution' })).toMatchObject({ choix: 'auto', effective: 'travelling_arriere', automatique: true });
    // Valeur alteree : traitee comme automatique.
    expect(cameraEffective({ ...plan(), camera: 'zoom_fou' as never }, null).automatique).toBe(true);
  });
});

describe('prompts : la direction s’ajoute au moteur existant, sans le casser', () => {
  const base = construirePromptImage('Nina (veste rouge). Nina entre dans la salle.', { mode: 'texte' }).promptFinal;
  const video = construirePromptImage('Nina entre dans la salle.', { mode: 'video' }).promptFinal;
  const direction = (style: IdStyleCinema | null, camera: IdCameraCinema = 'auto') => {
    const f = unFilm({ ...(style ? { styleCinema: style } : null) });
    f.scenes[0].plans[0].camera = camera === 'auto' ? undefined : camera;
    return directionDuPlan(f, f.scenes[0].plans[0].id);
  };

  it('IMAGE sans style : le prompt est EXACTEMENT celui d’avant (aucune regression)', () => {
    expect(promptImageAvecDirection(base, direction(null))).toBe(base);
  });

  it('IMAGE avec style : le bloc est insere AVANT le texte original, qui reste intact', () => {
    const p = promptImageAvecDirection(base, direction('noir'));
    expect(p).toContain(blocStyle(styleCinema('noir')!));
    expect(p.indexOf('Cinematic style:')).toBeLessThan(p.indexOf(MARQUEUR_ORIGINAL));
    expect(p.slice(p.indexOf(MARQUEUR_ORIGINAL))).toBe(base.slice(base.indexOf(MARQUEUR_ORIGINAL)));
    expect(p.slice(0, base.indexOf(MARQUEUR_ORIGINAL))).toBe(base.slice(0, base.indexOf(MARQUEUR_ORIGINAL)));
  });

  it('les six styles donnent six prompts d’image differents', () => {
    expect(new Set(IDS_STYLES.map((s) => promptImageAvecDirection(base, direction(s)))).size).toBe(6);
  });

  it('VIDEO : la camera REMPLACE la consigne figee du prompt partage (sinon deux consignes se contrediraient)', () => {
    expect(video).toContain(CAMERA_FIGEE); // dependance explicite au module partage : si elle change, ce test le dit
    const p = promptVideoAvecDirection(video, direction(null, 'orbite'));
    expect(p).not.toContain(CAMERA_FIGEE);
    expect(p).toContain(`camera: ${cameraCinema('orbite').prompt}`);
    expect(p.slice(p.indexOf(MARQUEUR_ORIGINAL))).toBe(video.slice(video.indexOf(MARQUEUR_ORIGINAL)));
  });

  it('VIDEO : sept mouvements, sept prompts ; l’automatique envoie un mouvement CONCRET', () => {
    const ids = IDS_CAMERAS.filter((c) => c !== 'auto');
    expect(new Set(ids.map((c) => promptVideoAvecDirection(video, direction(null, c)))).size).toBe(7);
    const auto = promptVideoAvecDirection(video, direction(null, 'auto'));
    expect(auto).toMatch(/camera: /);
    expect(auto).not.toContain('camera: undefined');
    expect(auto).not.toContain('camera: null');
  });

  it('VIDEO : le style est rappele pour que la video ne derive pas du look de l’image', () => {
    const p = promptVideoAvecDirection(video, direction('romantique', 'fixe'));
    expect(p).toContain('keep the romantic cinema look of the input image');
    expect(p).toContain(styleCinema('romantique')!.prompt.eclairage);
    expect(promptVideoAvecDirection(video, direction(null, 'fixe'))).not.toContain('look of the input image');
  });

  it('un prompt sans marqueur (autre moteur) recoit la direction a la fin, sans erreur', () => {
    expect(promptImageAvecDirection('simple prompt', direction('scifi'))).toMatch(/^simple prompt\. Cinematic style: /);
  });
});

describe('ATELIER : ce que le fournisseur recoit REELLEMENT', () => {
  const demandes: { image: DemandeImageGeneration[]; video: DemandeVideoGeneration[] } = { image: [], video: [] };
  const faux = (id: string): FournisseurGenerationIA => ({
    id, libelle: 'double de test', actif: true,
    // Echec « jamais envoye » : aucune generation, aucune depense, aucun fichier.
    async genererImage(d) { demandes.image.push(d); return { ok: false, erreur: 'double', jamaisEnvoye: true }; },
    async genererVideo(d) { demandes.video.push(d); return { ok: false, erreur: 'double', jamaisEnvoye: true }; },
  });
  beforeEach(() => {
    demandes.image.length = 0; demandes.video.length = 0;
    enregistrerFournisseur(faux(ID_REPLICATE_IMAGE));
    enregistrerFournisseur(faux(ID_REPLICATE_VIDEO));
  });

  /** Un film dont le premier plan a deja une IMAGE (pour la video). */
  function filmAvecImage(extra: Partial<Film> = {}): Film {
    const f = unFilm(extra);
    f.scenes[0].plans[0].media = { url: 'cinema/film-dir/medias/p1.png', genre: 'image', largeur: 64, hauteur: 64, dureeS: null, octets: 100, origine: 'import' } as never;
    return f;
  }
  const image = (film: Film, planId: string) => genererMediaPlan(film, planId, { fournisseurId: ID_REPLICATE_IMAGE, operation: 'image', racinePublique: '/tmp/x' });
  const video = (film: Film, planId: string) => genererMediaPlan(film, planId, { fournisseurId: ID_REPLICATE_VIDEO, operation: 'video', racinePublique: '/tmp/x' });

  /** Le prompt de base d'un plan, tel que le moteur existant le construit (sans direction). */
  const promptDeBase = (f: Film, planId: string): string => {
    const plan = f.scenes.flatMap((x) => x.plans).find((p) => p.id === planId)!;
    const presents = f.personnages.filter((p) => plan.personnages.includes(p.id));
    const texte = presents.length
      ? `${presents.map((p) => `${p.nom} (${p.references.at(-1)?.description || 'apparence non decrite'})`).join(', ')}. ${plan.description}`
      : plan.description;
    return construirePromptImage(texte, { mode: 'texte' }).promptFinal;
  };

  it('film sans choix : prompt d’image IDENTIQUE a celui d’avant', async () => {
    const f = unFilm();
    const id = f.scenes[0].plans[0].id;
    await image(f, id);
    expect(demandes.image[0].promptConstruit).toBe(promptDeBase(f, id));
    expect(demandes.image[0].promptConstruit).not.toContain('Cinematic style');
  });

  it('style du film : atteint la demande d’image ; description et personnages NON modifies', async () => {
    const f = unFilm({ styleCinema: 'noir' });
    const id = f.scenes[0].plans[0].id;
    await image(f, id);
    const recu = demandes.image[0].promptConstruit;
    const base = promptDeBase(f, id);
    expect(recu).toContain(blocStyle(styleCinema('noir')!));
    // Tout ce que disait le prompt d'avant est la, dans le meme ordre : seul le bloc de style est ajoute.
    expect(recu).toBe(promptImageAvecDirection(base, directionDuPlan(f, id)));
    expect(recu.slice(recu.indexOf(MARQUEUR_ORIGINAL))).toBe(base.slice(base.indexOf(MARQUEUR_ORIGINAL)));
    // L'apparence transmise au fournisseur est celle du casting, inchangee par le style.
    for (const p of demandes.image[0].personnages) {
      expect(p.description).toBe(f.personnages.find((x) => x.id === p.id)!.references.at(-1)!.description);
    }
  });

  it('EXCEPTION de scene : chaque plan recoit le style de SA scene', async () => {
    const f = unFilm({ styleCinema: 'noir' });
    f.scenes[1].styleCinema = 'romantique';
    await image(f, f.scenes[0].plans[0].id);
    await image(f, f.scenes[1].plans[0].id);
    expect(demandes.image[0].promptConstruit).toContain(styleCinema('noir')!.prompt.profil);
    expect(demandes.image[0].promptConstruit).not.toContain(styleCinema('romantique')!.prompt.profil);
    expect(demandes.image[1].promptConstruit).toContain(styleCinema('romantique')!.prompt.profil);
    expect(demandes.image[1].promptConstruit).not.toContain(styleCinema('noir')!.prompt.profil);
  });

  it('exception SANS style de film : la scene concernee seule est stylee', async () => {
    const f = unFilm();
    f.scenes[1].styleCinema = 'scifi';
    await image(f, f.scenes[0].plans[0].id);
    await image(f, f.scenes[1].plans[0].id);
    expect(demandes.image[0].promptConstruit).not.toContain('Cinematic style');
    expect(demandes.image[1].promptConstruit).toContain('Cinematic style');
  });

  it('REGENERATION : le prompt est reconstruit depuis le film COURANT (le style change = le prompt change)', async () => {
    const f = unFilm({ styleCinema: 'noir' });
    const id = f.scenes[0].plans[0].id;
    await image(f, id);
    await image({ ...f, styleCinema: 'publicite' }, id);
    await image(appliquerPatch(f, { style: null }), id);
    expect(demandes.image[0].promptConstruit).toContain('film noir cinematography');
    expect(demandes.image[1].promptConstruit).toContain('premium commercial advertising');
    expect(demandes.image[1].promptConstruit).not.toContain('film noir cinematography');
    expect(demandes.image[2].promptConstruit).not.toContain('Cinematic style');
  });

  it('VIDEO : mouvement choisi par plan, transmis au fournisseur ; plans differents, mouvements differents', async () => {
    const f = filmAvecImage({ styleCinema: 'scifi' });
    f.scenes[0].plans[0].camera = 'orbite';
    f.scenes[1].plans[0].media = { ...f.scenes[0].plans[0].media! };
    f.scenes[1].plans[0].camera = 'travelling_arriere';
    await video(f, f.scenes[0].plans[0].id);
    await video(f, f.scenes[1].plans[0].id);
    expect(demandes.video[0].prompt).toContain(`camera: ${cameraCinema('orbite').prompt}`);
    expect(demandes.video[1].prompt).toContain(`camera: ${cameraCinema('travelling_arriere').prompt}`);
    expect(demandes.video[0].prompt).not.toContain(CAMERA_FIGEE);
    expect(demandes.video[0].prompt).toContain('keep the science fiction look of the input image');
  });

  it('VIDEO en automatique : un mouvement pertinent est CHOISI et envoye (jamais le texte « auto »)', async () => {
    const f = filmAvecImage();
    const plan = f.scenes[0].plans[0];
    await video(f, plan.id);
    const attendu = cameraAutomatique(plan, f.scenes[0]);
    expect(demandes.video[0].prompt).toContain(`camera: ${cameraCinema(attendu).prompt}`);
    expect(demandes.video[0].prompt).not.toMatch(/camera: auto/);
  });

  it('VIDEO d’un film d’avant (sans drapeau, sans camera choisie) : ancien prompt, consigne douce d’origine', async () => {
    const f = filmAvecImage();
    delete f.directionActive;
    expect('camera' in f.scenes[0].plans[0]).toBe(false);
    await video(f, f.scenes[0].plans[0].id);
    expect(demandes.video).toHaveLength(1);
    expect(demandes.video[0].prompt).toContain(CAMERA_FIGEE);
    expect(demandes.video[0].prompt).not.toMatch(/camera: /);
    expect(demandes.video[0].prompt).not.toContain('look of the input image');
  });

  it('VIDEO d’un film d’avant dont UN plan recoit une camera : seul ce plan change', async () => {
    const f = filmAvecImage();
    delete f.directionActive;
    f.scenes[0].plans[0].camera = 'orbite';
    await video(f, f.scenes[0].plans[0].id);
    expect(demandes.video[0].prompt).toContain(`camera: ${cameraCinema('orbite').prompt}`);
  });

  it('VIDEO d’un film neuf : camera automatique par defaut', async () => {
    const f = filmAvecImage();
    expect(f.directionActive).toBe(true);
    await video(f, f.scenes[0].plans[0].id);
    expect(demandes.video[0].prompt).toMatch(/camera: /);
    expect(demandes.video[0].prompt).not.toContain(CAMERA_FIGEE);
  });
});

describe('AUCUNE DEPENSE, AUCUN DEVIS CHANGE par un choix de direction', () => {
  it('choisir style et camera : devis, plafond, budget, quotas, empreintes — tous inchanges', () => {
    const f = unFilm({ budgetApprouve: { usd: 0.5, perimetre: 'images', devisUsd: 0.1, approuveLe: 'x' }, coutGenerationUsd: 0.2 });
    const tout = f.scenes.map((s) => s.id);
    const avant = {
      devis: devisFilm(f, tout),
      image: devisGeneration(ID_REPLICATE_IMAGE, [{ planId: 'p', operations: ['image'] }]),
      video: devisGeneration(ID_REPLICATE_VIDEO, [{ planId: 'p', operations: ['video'] }]),
      empreintes: f.scenes.map((s) => empreinteScene(s, f.personnages)),
    };
    const apres = appliquerPatch(appliquerPatch(f, { style: 'noir' }), {
      scenes: [{ id: f.scenes[0].id, style: 'romantique' }], plans: [{ id: f.scenes[0].plans[0].id, camera: 'orbite' }],
    });
    expect(apres.styleCinema).toBe('noir');
    expect(devisFilm(apres, tout)).toEqual(avant.devis);
    expect(devisGeneration(ID_REPLICATE_IMAGE, [{ planId: 'p', operations: ['image'] }])).toEqual(avant.image);
    expect(devisGeneration(ID_REPLICATE_VIDEO, [{ planId: 'p', operations: ['video'] }])).toEqual(avant.video);
    expect(apres.scenes.map((s) => empreinteScene(s, apres.personnages))).toEqual(avant.empreintes);
    // Le budget approuve et la depense deja engagee ne bougent pas : aucune re-validation.
    expect(apres.budgetApprouve).toEqual(f.budgetApprouve);
    expect(apres.coutGenerationUsd).toBe(0.2);
  });

  it('changer le scenario d’un plan (texte) conserve camera et style', () => {
    const f = appliquerPatch(unFilm({ styleCinema: 'documentaire' }), { plans: [{ id: unFilm().scenes[0].plans[0].id, camera: 'pano_gauche' }] });
    const id = f.scenes[0].plans.find((p) => !p.dialogue)!.id;
    const apres = appliquerPatch(f, { plans: [{ id, texte: 'Nina traverse la salle en courant.' }] });
    expect(apres.styleCinema).toBe('documentaire');
    expect(apres.scenes[0].plans[0].camera).toBe('pano_gauche');
    expect(apres.scenes.flatMap((s) => s.plans).find((p) => p.id === id)!.description).toBe('Nina traverse la salle en courant.');
  });
});
