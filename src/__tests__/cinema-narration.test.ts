/**
 * Narration par film : « avec » (defaut, comportement d'avant) ou « sans ». Meme moteur de voix,
 * aucun deuxieme systeme ; les repliques des personnages ne dependent jamais de ce reglage.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const demandes: string[] = [];
vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3' },
  MsEdgeTTS: class {
    async setMetadata() { /* connexion simulee */ }
    toStream(texte: string) {
      demandes.push(texte);
      const flux = new EventEmitter();
      setTimeout(() => { flux.emit('data', Buffer.from('voix')); flux.emit('end'); }, 0);
      return { audioStream: flux };
    }
    close() { /* rien */ }
  },
}));

const { synthetiserFilm } = await import('@/lib/cinema/voix');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { monterFilm } = await import('@/lib/cinema/montage');
const { appliquerPatch, erreurPatch } = await import('@/lib/cinema/patch');
const { scenesAReproduire, empreinteScene } = await import('@/lib/cinema/empreinte');

const casting = [{ nom: 'Nina', role: 'p', description: '', urlImage: null }, { nom: 'Marco', role: 'a', description: '', urlImage: null }];
const HISTOIRE = 'Nina entre dans la salle. Marco dit : « je ne reculerai pas ». Nina sourit dans la salle.';
const film = () => preparerFilm({ histoire: HISTOIRE, personnages: casting, idFilm: 'f-n', titre: 't' });
const nbPlans = (f: ReturnType<typeof film>, genre: string) => f.scenes.flatMap((s) => s.plans).filter((p) => p.dialogue?.genre === genre);

async function voix(f: ReturnType<typeof film>) {
  const racine = await mkdtemp(path.join(tmpdir(), 'narr-'));
  demandes.length = 0;
  try { return await synthetiserFilm(f, { racinePublique: racine, repli: false, reutiliser: false }); }
  finally { await rm(racine, { recursive: true, force: true }); }
}

describe('le film a de la narration et des repliques', () => {
  it('le film de test comporte les deux genres', () => {
    expect(nbPlans(film(), 'narration').length).toBeGreaterThan(0);
    expect(nbPlans(film(), 'replique')).toHaveLength(1);
  });
});

describe('moteur de voix existant', () => {
  it('par defaut (reglage absent) : recits ET repliques sont lus — comportement d’avant inchange', async () => {
    const f = film();
    const r = await voix(f);
    expect(Object.keys(r.voix)).toHaveLength(nbPlans(f, 'narration').length + 1);
    expect(demandes.some((t) => /je ne reculerai pas/.test(t))).toBe(true);
  });

  it('sans narration : seule la replique est synthetisee, aucun recit', async () => {
    const f = { ...film(), narration: false };
    const r = await voix(f);
    expect(Object.keys(r.voix)).toHaveLength(1);
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatch(/je ne reculerai pas/);
    for (const p of nbPlans(f, 'narration')) expect(r.voix[p.id]).toBeUndefined();
  });

  it('« avec narration » explicite = le defaut', async () => {
    const f = { ...film(), narration: true };
    expect(Object.keys((await voix(f)).voix)).toHaveLength(nbPlans(f, 'narration').length + 1);
  });
});

describe('montage : le recit reste affiche, mais muet', () => {
  it('sans narration : le texte du recit est conserve, genre « muet », jamais de voix', () => {
    const f = { ...film(), narration: false };
    const voixToutes = Object.fromEntries(f.scenes.flatMap((s) => s.plans).map((p) => [p.id, `v/${p.id}.mp3`]));
    const m = monterFilm(f, voixToutes);
    for (const p of nbPlans(f, 'narration')) {
      const seg = m.segments.find((x) => x.planId === p.id)!;
      expect(seg.genre).toBe('muet');
      expect(seg.voixUrl).toBeNull();
      expect(seg.texte).toBe(p.dialogue!.texte);
    }
    const repl = nbPlans(f, 'replique')[0];
    const segR = m.segments.find((x) => x.planId === repl.id)!;
    expect(segR.genre).toBe('replique');
    expect(segR.voixUrl).toBe(`v/${repl.id}.mp3`);
  });

  it('avec narration : montage identique a celui d’avant', () => {
    const f = film();
    expect(monterFilm({ ...f, narration: true }).segments.map((s) => s.genre)).toEqual(monterFilm(f).segments.map((s) => s.genre));
  });
});

describe('reglage enregistre par le PATCH', () => {
  it('« narration » ne prend qu’un booleen', () => {
    expect(erreurPatch({ narration: 'non' })).toMatch(/vrai ou faux/);
    expect(erreurPatch({ narration: false })).toBeNull();
  });

  it('couper la narration rend « a reproduire » les scenes qui ont du recit, et ne touche ni le texte ni les repliques', () => {
    const f = film();
    const off = appliquerPatch(f, { narration: false });
    expect(off.narration).toBe(false);
    expect(off.histoire).toBe(f.histoire);
    expect(scenesAReproduire(off).length).toBeGreaterThan(0);
    expect(off.scenes.flatMap((s) => s.plans).map((p) => p.dialogue)).toEqual(f.scenes.flatMap((s) => s.plans).map((p) => p.dialogue));
  });

  it('rien ne change si le reglage est deja celui-la (aucune scene salie pour rien)', () => {
    const f = film();
    expect(scenesAReproduire(appliquerPatch(f, { narration: true }))).toEqual([]);
    const off = appliquerPatch(f, { narration: false });
    expect(appliquerPatch(off, { narration: false })).toEqual(off);
  });

  it('remettre la narration : le reglage disparait (film comme avant) et les scenes sont a reproduire', () => {
    const off = appliquerPatch(film(), { narration: false });
    const on = appliquerPatch(off, { narration: true });
    expect('narration' in on).toBe(false);
    expect(on.scenes.every((s) => s.empreinte === '' || !s.plans.some((p) => p.dialogue?.genre === 'narration'))).toBe(true);
    expect(empreinteScene(on.scenes[0], on.personnages)).toBeTruthy();
  });
});
