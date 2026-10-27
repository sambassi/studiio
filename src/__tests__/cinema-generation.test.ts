/**
 * CINEMA IA — LOT 3 : generation IA, prix, plafond. Partie PURE + registre.
 *
 * Aucun reseau ici (le fournisseur simule tourne sous ffmpeg local — c'est
 * le banc `tests-cinema/generation.cinema.test.ts` qui l'exerce vraiment, en
 * produisant de vrais fichiers). Ce fichier verifie : le registre de
 * fournisseurs (ferme, aucun payant actif), le catalogue de tarifs (un
 * inconnu n'est jamais zero), le plafond (une estimation inconnue est
 * TOUJOURS refusee, jamais traitee comme gratuite), et le mecanisme de
 * continuite (positions alignees sur `plan.personnages`).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CATALOGUE_GENERATION, coutUniteGeneration, devisGeneration, libelleUsdGeneration,
  MESSAGE_TARIF_GENERATION_INCONNU, PLAFOND_USD_PAR_FILM_DEFAUT, tarifGeneration, verifierPlafond,
} from '@/lib/cinema/generation/couts';
import {
  enregistrerFournisseur, fournisseurGeneration, fournisseursDeclares,
  type FournisseurGenerationIA,
} from '@/lib/cinema/generation/fournisseur';
import { apparencesDuPlan, genererMediaPlan } from '@/lib/cinema/generation/atelier';
import { preparerFilm } from '@/lib/cinema/atelier';
import { ID_FOURNISSEUR_SIMULE, couleurIdentite } from '@/lib/cinema/generation/simule';

// Ce fichier éprouve la MÉCANIQUE du fournisseur simulé (devis, plafond, empreinte) : il lui
// faut donc son interrupteur, éteint en production (`CINEMA_GENERATION_SIMULEE`, voir
// cinema-generation-simulee-eteinte.test.ts pour l'état par défaut).
process.env.CINEMA_GENERATION_SIMULEE = 'true';

const CASTING = [
  { nom: 'Nina', description: 'cheveux courts, veste rouge' },
  { nom: 'Marco', description: 'grand, barbe, ceinture noire' },
];
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Le jour se leve sur la salle vide.';

const filmDeTest = () => preparerFilm({
  histoire: HISTOIRE, personnages: CASTING, idFilm: 'film-gen-test',
  maintenant: () => new Date('2026-10-26T09:00:00Z'),
});

describe('registre des fournisseurs — ferme, aucun payant actif', () => {
  it('le fournisseur simule est enregistre ; ETEINT par defaut, actif seulement avec son interrupteur', () => {
    const avant = process.env.CINEMA_GENERATION_SIMULEE;
    try {
      delete process.env.CINEMA_GENERATION_SIMULEE;
      expect(fournisseurGeneration(ID_FOURNISSEUR_SIMULE)).not.toBeNull(); // declare
      expect(fournisseurGeneration(ID_FOURNISSEUR_SIMULE)?.actif).toBe(false); // mais eteint
      process.env.CINEMA_GENERATION_SIMULEE = 'true';
      expect(fournisseurGeneration(ID_FOURNISSEUR_SIMULE)?.actif).toBe(true);
    } finally {
      if (avant === undefined) delete process.env.CINEMA_GENERATION_SIMULEE; else process.env.CINEMA_GENERATION_SIMULEE = avant;
    }
  });

  it('un id inconnu ne rend aucun fournisseur improvise', () => {
    expect(fournisseurGeneration('nimporte-quoi')).toBeNull();
  });

  it('aucun fournisseur DECLARE n’est a la fois actif ET facturable (inconnu)', () => {
    // Le seul actif du registre doit avoir un tarif CONNU et nul — jamais
    // un fournisseur actif dont le cout serait inconnu.
    for (const f of fournisseursDeclares()) {
      if (!f.actif) continue;
      const tarifImage = tarifGeneration(f.id, 'image');
      if (tarifImage) expect(tarifImage.usdParUnite).not.toBeNull();
    }
  });
});

describe('catalogue de tarifs — un inconnu n’est jamais zero', () => {
  it('seules les entrees du fournisseur simule sont actives', () => {
    const actives = CATALOGUE_GENERATION.filter((t) => t.actif);
    expect(actives.every((t) => t.fournisseurId === 'simule')).toBe(true);
    expect(actives.every((t) => t.usdParUnite === 0)).toBe(true);
  });

  it('les fournisseurs declares mais eteints ont un tarif NULL, jamais 0', () => {
    const eteints = CATALOGUE_GENERATION.filter((t) => !t.actif);
    expect(eteints.length).toBeGreaterThan(0);
    for (const t of eteints) expect(t.usdParUnite).toBeNull();
  });

  it('coutUniteGeneration rend null pour un fournisseur/operation non catalogue', () => {
    expect(coutUniteGeneration('inconnu', 'image')).toBeNull();
    expect(coutUniteGeneration('simule', 'image')).toBe(0);
  });

  it('devisGeneration rend un total null des qu une ligne est inconnue', () => {
    const d1 = devisGeneration('simule', [{ planId: 'p1', operations: ['image', 'video'] }]);
    expect(d1.totalUsd).toBe(0);
    const d2 = devisGeneration('replicate-flux-schnell', [{ planId: 'p1', operations: ['image'] }]);
    expect(d2.totalUsd).toBeNull();
    expect(d2.lignes[0].usd).toBeNull();
  });

  it('libelleUsdGeneration distingue gratuit, chiffre et inconnu', () => {
    expect(libelleUsdGeneration(0)).toMatch(/gratuit/i);
    expect(libelleUsdGeneration(0.5)).toBe('0.5000 USD');
    expect(libelleUsdGeneration(null)).toBe(MESSAGE_TARIF_GENERATION_INCONNU);
  });
});

describe('plafond ferme — une estimation inconnue n’est jamais gratuite', () => {
  it('autorise une operation gratuite sous le plafond', () => {
    const v = verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: 0, plafondUsd: 0 });
    expect(v.autorise).toBe(true);
  });

  it('refuse un cout INCONNU quel que soit le plafond (meme tres large)', () => {
    const v = verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: null, plafondUsd: 1_000_000 });
    expect(v.autorise).toBe(false);
    expect(v.motif).toBe(MESSAGE_TARIF_GENERATION_INCONNU);
  });

  it('refuse un depassement du plafond, cumul compris', () => {
    const v1 = verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: 1.5, plafondUsd: 1 });
    expect(v1.autorise).toBe(false);
    const v2 = verifierPlafond({ dejaDepenseUsd: 0.8, coutProposeUsd: 0.3, plafondUsd: 1 });
    expect(v2.autorise).toBe(false);
    expect(v2.motif).toMatch(/plafond depasse/i);
  });

  it('refuse un plafond invalide (negatif, NaN, infini)', () => {
    expect(verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: 0, plafondUsd: -1 }).autorise).toBe(false);
    expect(verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: 0, plafondUsd: NaN }).autorise).toBe(false);
    expect(verifierPlafond({ dejaDepenseUsd: 0, coutProposeUsd: 0, plafondUsd: Infinity }).autorise).toBe(false);
  });

  it('le plafond par defaut est un nombre fini positif', () => {
    expect(Number.isFinite(PLAFOND_USD_PAR_FILM_DEFAUT)).toBe(true);
    expect(PLAFOND_USD_PAR_FILM_DEFAUT).toBeGreaterThan(0);
  });
});

describe('genererMediaPlan — l’ordre tenu : fournisseur actif > devis > plafond > appel', () => {
  const racinePublique = require('path').join(require('os').tmpdir(), 'cinema-gen-test-' + Date.now());

  it('refuse tout fournisseur inconnu, sans rien calculer de plus', async () => {
    const film = filmDeTest();
    const planId = film.scenes[0].plans[0].id;
    const r = await genererMediaPlan(film, planId, { fournisseurId: 'inconnu', operation: 'image', racinePublique });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(/fournisseur inconnu/);
  });

  it('refuse un fournisseur DECLARE mais ETEINT, sans jamais l’appeler', async () => {
    const appelImage = vi.fn(async (): Promise<ReturnType<FournisseurGenerationIA['genererImage']> extends Promise<infer T> ? T : never> => ({ ok: false, erreur: 'ne doit jamais etre appele' }));
    const eteint: FournisseurGenerationIA = {
      id: 'test-eteint', libelle: 'Test eteint', actif: false,
      genererImage: appelImage,
      genererVideo: async () => ({ ok: false, erreur: 'ne doit jamais etre appele' }),
    };
    enregistrerFournisseur(eteint);

    const film = filmDeTest();
    const planId = film.scenes[0].plans[0].id;
    const r = await genererMediaPlan(film, planId, { fournisseurId: 'test-eteint', operation: 'image', racinePublique });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(/non branche/);
    expect(appelImage).not.toHaveBeenCalled();
  });

  it('refuse un fournisseur ACTIF mais SANS TARIF catalogue, sans jamais l’appeler — un prix inconnu n’est jamais traite comme gratuit', async () => {
    const appelImage = vi.fn(async () => ({ ok: true as const, fichier: '/inexistant', nomSuggere: 'x.png' }));
    const sansTarif: FournisseurGenerationIA = {
      id: 'test-sans-tarif', libelle: 'Test sans tarif catalogue', actif: true,
      genererImage: appelImage,
      genererVideo: async () => ({ ok: false, erreur: 'non demande' }),
    };
    enregistrerFournisseur(sansTarif);

    const film = filmDeTest();
    const planId = film.scenes[0].plans[0].id;
    const r = await genererMediaPlan(film, planId, { fournisseurId: 'test-sans-tarif', operation: 'image', racinePublique, plafondUsd: 1_000_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreur).toBe(MESSAGE_TARIF_GENERATION_INCONNU);
      expect(r.verification?.autorise).toBe(false);
    }
    // La garde a joue AVANT l'appel fournisseur : meme avec un plafond
    // enorme, un cout inconnu ne laisse jamais passer l'appel.
    expect(appelImage).not.toHaveBeenCalled();
  });

  it('refuse de generer une video sans image prealable sur le plan', async () => {
    const film = filmDeTest();
    const planId = film.scenes[0].plans[0].id; // aucun media attache
    const r = await genererMediaPlan(film, planId, { fournisseurId: 'simule', operation: 'video', racinePublique });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(/image/);
  });
});

describe('apparencesDuPlan — ce qu’un fournisseur recoit', () => {
  it('ne porte que les personnages PRESENTS dans le plan, avec leur apparence active', () => {
    const film = filmDeTest();
    const scene = film.scenes.find((s) => s.personnages.length > 0)!;
    const plan = { ...scene.plans[0], personnages: [film.personnages[0].id] };
    const apparences = apparencesDuPlan(film, plan);
    expect(apparences).toHaveLength(1);
    expect(apparences[0].nom).toBe('Nina');
    expect(apparences[0].description).toContain('veste rouge');
  });

  it('rend un tableau vide pour un plan sans personnage', () => {
    const film = filmDeTest();
    expect(apparencesDuPlan(film, { personnages: [] })).toEqual([]);
  });
});

describe('couleurIdentite (fournisseur simule) — stable et discriminante', () => {
  it('la MEME apparence donne TOUJOURS la meme couleur', () => {
    expect(couleurIdentite('veste rouge, cheveux courts')).toBe(couleurIdentite('veste rouge, cheveux courts'));
  });

  it('deux apparences DIFFERENTES donnent le plus souvent des couleurs differentes', () => {
    // Pas une garantie absolue (8 couleurs, collisions possibles) : on
    // verifie que CE jeu precis de personnages du film de test se distingue.
    expect(couleurIdentite('cheveux courts, veste rouge')).not.toBe(couleurIdentite('grand, barbe, ceinture noire'));
  });
});
