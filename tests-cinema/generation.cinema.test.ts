/**
 * CINEMA IA — LOT 3 : generation REELLE (fournisseur simule), bout en bout.
 *
 * Ce banc produit de vrais fichiers (ffmpeg, local, gratuit) via le SEUL
 * fournisseur actif, les attache a des plans comme le ferait l'interface, et
 * verifie que le MP4 final les montre vraiment — pas une carte de secours.
 *
 * Il verifie aussi, de bout en bout (pas seulement au niveau de la fonction
 * pure) : la regeneration economique (une scene touchee, les autres
 * reprises du cache) et le format 9:16 (cadrage sans deformation).
 *
 *   npm run test:cinema
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { preparerFilm, produireFilm } from '@/lib/cinema/atelier';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { rapportCoherencePersonnage, signalIdentiteSimulee } from '@/lib/cinema/generation/coherence';
import { couleurIdentite } from '@/lib/cinema/generation/simule';
import { monterFilm } from '@/lib/cinema/montage';
import { TAILLES } from '@/lib/cinema/types';
import { couleurMoyenne } from './fixtures-medias';

const RACINE = path.resolve(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');

const HISTOIRE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Nina murmure « je ne reculerai pas ».',
  'Le jour se leve sur la salle vide.',
  'Personne ne dira ce qui s est joue ici.',
].join(' ');

const CASTING = [
  { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire' },
];

/** '0xRRGGBB' -> canal dominant ('r' | 'v' | 'b'), meme convention que `fixtures-medias.dominante`. */
function dominanteHex(hex: string): 'r' | 'v' | 'b' {
  const n = parseInt(hex.replace(/^0x/, ''), 16);
  const r = (n >> 16) & 0xff, v = (n >> 8) & 0xff, b = n & 0xff;
  if (r >= v && r >= b) return 'r';
  return v >= b ? 'v' : 'b';
}
function dominanteRgb([r, v, b]: [number, number, number]): 'r' | 'v' | 'b' {
  if (r >= v && r >= b) return 'r';
  return v >= b ? 'v' : 'b';
}

describe('generation IA (fournisseur simule) — bout en bout', () => {
  it('genere, attache, rend et montre des medias GENERES dans le MP4 final', async () => {
    const film0 = preparerFilm({
      titre: 'Avant le jour (genere)', histoire: HISTOIRE, personnages: CASTING,
      idFilm: 'film-generation-e2e', format: '16:9', qualite: 'standard', nbScenes: 4,
    });
    expect(film0.scenes).toHaveLength(4);

    const nina = film0.personnages[0];
    const plansNina = film0.scenes.flatMap((s) => s.plans).filter((p) => p.personnages.includes(nina.id));
    expect(plansNina.length).toBeGreaterThanOrEqual(2);
    const planA = plansNina[0]; // premiere scene ou Nina figure
    const planB = plansNina[1]; // une AUTRE scene, meme personnage

    // ── MISSION 1 : generer une image, puis une courte video depuis elle ──
    const genA = await genererMediaPlan(film0, planA.id, { fournisseurId: 'simule', operation: 'image', racinePublique: PUBLIC });
    expect(genA.ok, genA.ok ? '' : (genA as any).erreur).toBe(true);
    if (!genA.ok) return;
    expect(genA.media.origine).toBe('genere');
    expect(genA.media.fournisseurGeneration).toBe('simule');
    expect(genA.film.coutGenerationUsd).toBe(0); // fournisseur local, gratuit

    const genVideoA = await genererMediaPlan(genA.film, planA.id, { fournisseurId: 'simule', operation: 'video', racinePublique: PUBLIC });
    expect(genVideoA.ok, genVideoA.ok ? '' : (genVideoA as any).erreur).toBe(true);
    if (!genVideoA.ok) return;
    expect(genVideoA.media.genre).toBe('video');
    expect(genVideoA.media.dureeS).not.toBeNull();

    const genB = await genererMediaPlan(genVideoA.film, planB.id, { fournisseurId: 'simule', operation: 'image', racinePublique: PUBLIC });
    expect(genB.ok, genB.ok ? '' : (genB as any).erreur).toBe(true);
    if (!genB.ok) return;

    let film = genB.film;

    // ── MISSION 2 : rapport de continuite — MECANISME, pas une garantie ──
    const rapport = rapportCoherencePersonnage(film, nina.id);
    expect(rapport.nbPlansGeneres).toBe(2); // planA (image, la video ecrase le MEME plan) + planB
    expect(rapport.continuiteGlobale).toBe(true); // meme reference active aux deux generations
    expect(rapport.coherenceVisuelleGarantie).toBe(false); // JAMAIS garanti
    expect(rapport.avertissement).toMatch(/aucune coherence visuelle/i);
    // Signal du fournisseur simule : meme texte de reference -> meme couleur.
    expect(signalIdentiteSimulee(nina.references[0].description, nina.references[0].description)).toBe(true);
    expect(signalIdentiteSimulee(nina.references[0].description, film.personnages[1].references[0].description)).toBe(false);

    // ── MISSION 4 (partie 1) : plan sans media echoue toujours proprement ──
    // (verifie indirectement : scene 4 n'a jamais recu de media genere, elle
    // utilisera donc la carte de plan — c'est le comportement ATTENDU, pas
    // un echec : aucun media declare n'y est manquant.)

    // ── Production : la voix, le montage, le rendu ─────────────────────
    const premier = await produireFilm(film, { racine: RACINE, concurrence: 2 });
    expect(premier.avertissements.filter((a) => !a.startsWith('voix produites par le moteur'))).toEqual([]);
    expect(premier.mp4).not.toBeNull();
    const mp4 = premier.mp4!;
    expect(mp4.codecVideo).toBe('h264');
    expect(mp4.codecAudio).toBeTruthy();
    expect(mp4.largeur).toBe(1920);
    expect(mp4.hauteur).toBe(1080);

    // ── Les medias GENERES sont-ils vraiment a l'image ? ────────────────
    const montage = monterFilm(premier.film);
    const segA = montage.segments.find((s) => s.planId === planA.id)!;
    const segB = montage.segments.find((s) => s.planId === planB.id)!;
    const attendue = dominanteHex(couleurIdentite(nina.references[0].description));
    for (const seg of [segA, segB]) {
      const instant = seg.debutS + Math.min(1, seg.dureeS / 3);
      const obtenue = dominanteRgb(await couleurMoyenne(mp4.fichier, instant));
      expect(obtenue, `plan ${seg.planId} a ${instant.toFixed(1)}s`).toBe(attendue);
    }

    // ── MISSION 4 (partie 2) : regeneration economique, avec de vrais medias ──
    const sceneB = premier.film.scenes.find((s) => s.plans.some((p) => p.id === planB.id))!;
    const regenB = await genererMediaPlan(premier.film, planB.id, { fournisseurId: 'simule', operation: 'image', racinePublique: PUBLIC, graine: 999 });
    expect(regenB.ok).toBe(true);
    if (!regenB.ok) return;

    const second = await produireFilm(regenB.film, { racine: RACINE, scenesDemandees: [sceneB.id], concurrence: 2 });
    expect(second.scenesRendues).toEqual([sceneB.id]);
    expect(second.scenesReutilisees.length).toBe(premier.film.scenes.length - 1);

    console.log('[cinema/lot3] MP4 :', mp4.fichier, '|', mp4.dureeS, 's |', mp4.octets, 'octets');
  }, 1_800_000);

  it('genere au format 9:16 sans deformation (meme ratio que le fournisseur simule produit)', async () => {
    const film0 = preparerFilm({
      titre: 'Portrait', histoire: 'Nina regarde le ciel. Nina sourit enfin.',
      personnages: [{ nom: 'Nina', description: 'veste rouge' }],
      idFilm: 'film-generation-9x16', format: '9:16', qualite: 'standard', nbScenes: 3,
    });
    const planId = film0.scenes.flatMap((s) => s.plans).find((p) => p.personnages.length > 0)!.id;

    const gen = await genererMediaPlan(film0, planId, { fournisseurId: 'simule', operation: 'image', racinePublique: PUBLIC });
    expect(gen.ok, gen.ok ? '' : (gen as any).erreur).toBe(true);
    if (!gen.ok) return;

    expect(gen.media.largeur).toBeLessThan(gen.media.hauteur); // vertical
    const montage = monterFilm(gen.film);
    const segment = montage.segments.find((s) => s.planId === planId)!;
    expect(segment.cadrage).not.toBeNull();
    // Le fournisseur simule rend DEJA le ratio du film : aucun rognage.
    const tailleCible = TAILLES.standard['9:16'];
    const ratioMedia = gen.media.largeur / gen.media.hauteur;
    const ratioCible = tailleCible.w / tailleCible.h;
    expect(Math.abs(ratioMedia - ratioCible)).toBeLessThan(0.02);
    expect(segment.cadrage!.rogneX).toBeLessThan(0.02);
    expect(segment.cadrage!.rogneY).toBeLessThan(0.02);
  }, 60_000);
});
