/**
 * DEUX MODES AUDIO EXCLUSIFS : « les personnages parlent » / « une voix raconte l'histoire ».
 * Moteur vocal SIMULE (aucun reseau, aucun credit). Tests A a D de la mission, plus le film historique.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const lectures: Array<{ voix: string; texte: string }> = [];
vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3' },
  MsEdgeTTS: class {
    voix = '';
    async setMetadata(v: string) { this.voix = v; }
    toStream(texte: string) {
      lectures.push({ voix: this.voix, texte });
      const flux = new EventEmitter();
      setTimeout(() => { flux.emit('data', Buffer.from('voix')); flux.emit('end'); }, 0);
      return { audioStream: flux };
    }
    close() { /* rien */ }
  },
}));

const { synthetiserFilm } = await import('@/lib/cinema/voix');
const { voixAJouer } = await import('@/lib/cinema/audio');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { monterFilm } = await import('@/lib/cinema/montage');
const { appliquerPatch, erreurPatch } = await import('@/lib/cinema/patch');
const { diagnosticAudio, auditFidelite } = await import('@/lib/cinema/fidelite');
const { scenesAReproduire } = await import('@/lib/cinema/empreinte');
const { VOIX_NARRATEUR, voixDistincte, VOIX_FILM } = await import('@/lib/cinema/personnages');
const { locuteurNomme } = await import('@/lib/cinema/scenario');
type Film = import('@/lib/cinema/types').Film;

const CAST = [{ nom: 'Maya' }, { nom: 'Karim' }];
const HISTOIRE_AB = 'Maya entre dans la salle. Maya dit : « Bonjour Karim ». Karim répond : « Bonjour Maya ». Le jour se lève sur la salle.';
const film = (histoire = HISTOIRE_AB, mode?: 'personnages' | 'narrateur'): Film => {
  const f = preparerFilm({ histoire, personnages: CAST.map((c, i) => ({ ...c, ...(mode ? { voix: voixDistincte(i) } : {}) })), idFilm: 'f-audio', titre: 't' });
  return mode ? { ...f, modeAudio: mode } : f;
};
const plans = (f: Film) => f.scenes.flatMap((s) => s.plans);

async function lire(f: Film) {
  const racine = await mkdtemp(path.join(tmpdir(), 'audio-'));
  lectures.length = 0;
  try { return await synthetiserFilm(f, { racinePublique: racine, repli: false, reutiliser: false }); }
  finally { await rm(racine, { recursive: true, force: true }); }
}

describe('le locuteur vient du texte HORS citation — jamais du contenu de la replique', () => {
  it('« Karim répond : « Bonjour Maya » » : c’est Karim qui parle (Maya est celle a qui l’on parle)', () => {
    const f = film();
    const r = plans(f).filter((p) => p.dialogue?.genre === 'replique');
    expect(r.map((p) => p.dialogue!.personnageId)).toEqual(['pers-maya', 'pers-karim']);
    expect(r.map((p) => p.dialogue!.texte)).toEqual(['Bonjour Karim', 'Bonjour Maya']);
  });
  it('un nom present seulement dans la citation ne designe pas le locuteur', () => {
    const f = film('Maya entre. « Karim, viens ici ». Karim sourit.');
    const p = plans(f).find((x) => x.dialogue?.genre === 'replique')!;
    expect(locuteurNomme(p.description, f.personnages)).toBeNull();
  });
});

describe('Test A — « Bonjour Karim » / « Bonjour Maya » : deux voix distinctes, aucun narrateur, rien de decrit', () => {
  it('chaque replique est lue, mot pour mot, avec la voix DE son personnage', async () => {
    const f = film(HISTOIRE_AB, 'personnages');
    await lire(f);
    expect(lectures).toEqual([
      { voix: VOIX_FILM[0].id, texte: 'Bonjour Karim' },
      { voix: VOIX_FILM[1].id, texte: 'Bonjour Maya' },
    ]);
    expect(lectures[0].voix).not.toBe(lectures[1].voix);
  });
  it('aucun narrateur : la voix off n’est jamais utilisee, et les phrases d’action restent muettes', async () => {
    const f = film(HISTOIRE_AB, 'personnages');
    await lire(f);
    expect(lectures.some((l) => l.voix === VOIX_NARRATEUR)).toBe(false);
    expect(lectures.some((l) => /entre dans la salle|Le jour se lève/.test(l.texte))).toBe(false);
    for (const p of plans(f).filter((x) => x.dialogue?.genre === 'narration')) expect(voixAJouer(f, p)).toBeNull();
  });
  it('au montage : les actions sont muettes (texte conserve), les repliques ont leur voix', async () => {
    const f = film(HISTOIRE_AB, 'personnages');
    const m = monterFilm(f, Object.fromEntries(plans(f).map((p) => [p.id, `v/${p.id}.mp3`])));
    const narr = m.segments.filter((s) => plans(f).find((p) => p.id === s.planId)?.dialogue?.genre === 'narration');
    expect(narr.every((s) => s.genre === 'muet' && s.voixUrl === null && s.texte.length > 0)).toBe(true);
    const rep = m.segments.filter((s) => s.genre === 'replique');
    expect(rep).toHaveLength(2);
    expect(rep.every((s) => s.voixUrl)).toBe(true);
  });
  it('une voix stable par personnage : la meme dans TOUTES ses repliques et ses scenes', async () => {
    const f = film('Maya dit : « Un ». Karim répond : « Deux ». Maya dit : « Trois ». Karim répond : « Quatre ». Maya dit : « Cinq ». Karim répond : « Six ».', 'personnages');
    await lire(f);
    const parVoix = (v: string) => lectures.filter((l) => l.voix === v).map((l) => l.texte);
    expect(parVoix(VOIX_FILM[0].id)).toEqual(['Un', 'Trois', 'Cinq']);
    expect(parVoix(VOIX_FILM[1].id)).toEqual(['Deux', 'Quatre', 'Six']);
    expect(f.scenes.length).toBeGreaterThan(1);
  });
});

describe('Test B — une voix raconte : seul le RECIT ecrit par l’utilisateur est lu', () => {
  it('le recit est lu par la voix off, mot pour mot ; aucune replique n’est lue ; aucun texte ajoute', async () => {
    const f = film(HISTOIRE_AB, 'narrateur');
    await lire(f);
    expect(lectures.every((l) => l.voix === VOIX_NARRATEUR)).toBe(true);
    expect(lectures.map((l) => l.texte)).toEqual(['Maya entre dans la salle.', 'Le jour se lève sur la salle.']);
    for (const l of lectures) expect(HISTOIRE_AB).toContain(l.texte);
    expect(lectures.some((l) => /Bonjour/.test(l.texte))).toBe(false);
  });
  it('les repliques restent affichees mais muettes au montage', () => {
    const f = film(HISTOIRE_AB, 'narrateur');
    const m = monterFilm(f, Object.fromEntries(plans(f).map((p) => [p.id, `v/${p.id}.mp3`])));
    const rep = m.segments.filter((s) => /Bonjour/.test(s.texte));
    expect(rep).toHaveLength(2);
    expect(rep.every((s) => s.genre === 'muet' && s.voixUrl === null)).toBe(true);
  });
  it('sans phrase de recit : on l’explique, on n’ecrit RIEN a la place', async () => {
    const f = film('Maya dit : « Bonjour ». Karim répond : « Salut ».', 'narrateur');
    expect(diagnosticAudio(f).map((p) => p.code)).toEqual(['aucun_recit']);
    expect(diagnosticAudio(f)[0].conseil).toMatch(/Studiio n’écrit jamais de texte à ta place/);
    await lire(f);
    expect(lectures).toEqual([]);
  });
});

describe('Test C — un locuteur ambigu : on demande, on n’attribue JAMAIS au hasard', () => {
  const AMBIGU = 'Maya entre dans la salle. « Bonjour ». Karim sourit.';
  it('la replique sans nom hors citation est signalee comme ambigue et N’EST PAS LUE', async () => {
    const f = film(AMBIGU, 'personnages');
    const p = plans(f).find((x) => x.dialogue?.genre === 'replique')!;
    expect(voixAJouer(f, p)).toBeNull();
    const d = diagnosticAudio(f).find((x) => x.code === 'locuteur_ambigu')!;
    expect(d.message).toMatch(/ne dit pas qui parle/);
    expect(d.planIds).toEqual([p.id]);
    await lire(f);
    expect(lectures).toEqual([]);
  });
  it('« qui parle ? » : le choix de l’utilisateur la rend lisible, avec la voix du personnage choisi', async () => {
    const f0 = film(AMBIGU, 'personnages');
    const p = plans(f0).find((x) => x.dialogue?.genre === 'replique')!;
    expect(erreurPatch({ plans: [{ id: p.id, locuteur: 'pers-karim' }] })).toBeNull();
    const f = appliquerPatch(f0, { plans: [{ id: p.id, locuteur: 'pers-karim' }] });
    expect(diagnosticAudio(f).some((x) => x.code === 'locuteur_ambigu')).toBe(false);
    await lire(f);
    expect(lectures).toEqual([{ voix: f.personnages.find((x) => x.id === 'pers-karim')!.voix, texte: 'Bonjour' }]);
    expect(auditFidelite(f).ecarts.some((e) => e.genre === 'locuteur_devine')).toBe(false);
  });
  it('le choix d’un locuteur inconnu est ignore (jamais une voix inventee)', () => {
    const f0 = film(AMBIGU, 'personnages');
    const p = plans(f0).find((x) => x.dialogue?.genre === 'replique')!;
    const f = appliquerPatch(f0, { plans: [{ id: p.id, locuteur: 'pers-fantome' }] });
    expect(voixAJouer(f, plans(f).find((x) => x.id === p.id)!)).toBeNull();
  });
  it('mode « personnages » sans aucune replique : on dit qu’il faut en ajouter', () => {
    const f = film('Maya entre dans la salle. Karim la regarde.', 'personnages');
    const d = diagnosticAudio(f);
    expect(d.map((x) => x.code)).toEqual(['aucune_replique']);
    expect(d[0].conseil).toMatch(/Ajoute des répliques entre guillemets/);
  });
  it('deux personnages qui parlent avec la MEME voix : signale', () => {
    const f0 = film(HISTOIRE_AB, 'personnages');
    const f = appliquerPatch(f0, { voix: [{ personnageId: 'pers-maya', voix: VOIX_FILM[1].id }] });
    expect(diagnosticAudio(f).map((x) => x.code)).toContain('voix_partagee');
    expect(diagnosticAudio(f0)).toEqual([]);
  });
});

describe('Test D — changer de mode et revenir : rien n’est perdu', () => {
  it('histoire, personnages, scenes, plans et dialogues sont IDENTIQUES apres un aller-retour', () => {
    const f0 = film(HISTOIRE_AB, 'personnages');
    const avant = JSON.stringify({ h: f0.histoire, p: f0.personnages, s: f0.scenes.map((s) => s.plans.map((pl) => [pl.id, pl.description, pl.dialogue, pl.personnages])) });
    const f1 = appliquerPatch(f0, { modeAudio: 'narrateur' });
    const f2 = appliquerPatch(f1, { modeAudio: 'personnages' });
    expect(f1.modeAudio).toBe('narrateur');
    const apres = (f: Film) => JSON.stringify({ h: f.histoire, p: f.personnages, s: f.scenes.map((s) => s.plans.map((pl) => [pl.id, pl.description, pl.dialogue, pl.personnages])) });
    expect(apres(f1)).toBe(avant);
    expect(apres(f2)).toBe(avant);
    expect(f2.modeAudio).toBe('personnages');
  });
  it('le changement rend « a reproduire » les scenes qui ont du texte dit, rien d’autre', () => {
    const f = appliquerPatch(film(HISTOIRE_AB, 'personnages'), { modeAudio: 'narrateur' });
    expect(scenesAReproduire(f).length).toBeGreaterThan(0);
    const memeMode = appliquerPatch(film(HISTOIRE_AB, 'personnages'), { modeAudio: 'personnages' });
    expect(scenesAReproduire(memeMode)).toEqual([]);
  });
  it('un mode inconnu est refuse', () => {
    expect(erreurPatch({ modeAudio: 'les-deux' })).toMatch(/mode audio inconnu/);
    expect(erreurPatch({ voix: [{ personnageId: 'pers-maya', voix: 'fr-FR-Inconnue' }] })).toMatch(/voix inconnue/);
  });
});

describe('les anciens films : leur comportement audio ne change PAS tant qu’on n’a pas choisi', () => {
  it('sans `modeAudio` : repliques ET recit lus, comme avant', async () => {
    const f = film(HISTOIRE_AB);
    expect(f.modeAudio).toBeUndefined();
    await lire(f);
    expect(lectures.map((l) => l.texte)).toEqual(['Maya entre dans la salle.', 'Bonjour Karim', 'Bonjour Maya', 'Le jour se lève sur la salle.']);
    expect(lectures[0].voix).toBe(VOIX_NARRATEUR);
  });
  it('l’ancien reglage « sans narration » continue d’agir sur un film historique', async () => {
    await lire({ ...film(HISTOIRE_AB), narration: false });
    expect(lectures.map((l) => l.texte)).toEqual(['Bonjour Karim', 'Bonjour Maya']);
  });
  it('dans un nouveau mode, l’ancien reglage `narration` est ignore (aucun reglage contradictoire)', async () => {
    await lire({ ...film(HISTOIRE_AB, 'narrateur'), narration: false });
    expect(lectures.map((l) => l.texte)).toEqual(['Maya entre dans la salle.', 'Le jour se lève sur la salle.']);
  });
  it('un film historique n’a aucun diagnostic de mode', () => {
    expect(diagnosticAudio(film('Maya entre. Karim sort.'))).toEqual([]);
  });
  it('le meme patch ne bascule jamais un film historique de lui-meme', () => {
    const f = appliquerPatch(film(HISTOIRE_AB), { style: 'noir' });
    expect(f.modeAudio).toBeUndefined();
  });
});
