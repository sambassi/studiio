// @vitest-environment node
/**
 * `lib/tarifs/serveur` — cache 5 s, repli JAMAIS gratuit, lecture partagée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/supabase', async () => {
  const m = await import('./aides/base-memoire-tarifs');
  return { supabaseAdmin: m.supabaseAdminMemoire, supabase: m.supabaseAdminMemoire };
});

import { base, reinitialiserBase } from './aides/base-memoire-tarifs';
import {
  CLE_REGLAGE_TARIFS, TTL_TARIFS_MS, ecrireTarifs, lireTarifs, prixDe, reinitialiserTarifs,
} from '@/lib/tarifs/serveur';
import { CATALOGUE_TARIFS, TARIFS_DEFAUT } from '@/lib/tarifs/catalogue';

let maintenant = 1_000_000;
const horloge = () => maintenant;

function reglage(prix: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  base.tables.app_settings = [{ key: CLE_REGLAGE_TARIFS, value: { prix, ...extra } }];
}

beforeEach(() => {
  reinitialiserBase();
  maintenant = 1_000_000;
  reinitialiserTarifs(horloge);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('cache (horloge injectée)', () => {
  it('une seule lecture pendant le TTL, relecture après', async () => {
    reglage({ 'avatar.avatar_v': 50 });
    expect(await prixDe('avatar.avatar_v')).toBe(50);
    reglage({ 'avatar.avatar_v': 60 }); // changé en base, hors admin
    maintenant += TTL_TARIFS_MS - 1;
    expect(await prixDe('avatar.avatar_v')).toBe(50);
    expect(base.lectures.app_settings).toBe(1);
    maintenant += 1;
    expect(await prixDe('avatar.avatar_v')).toBe(60);
    expect(base.lectures.app_settings).toBe(2);
  });

  it('une écriture admin vide le cache tout de suite', async () => {
    expect(await prixDe('ai.ocr')).toBe(1);
    await ecrireTarifs({ prix: { 'ai.ocr': 4 } }, 'contact.artboost@gmail.com');
    expect(await prixDe('ai.ocr')).toBe(4); // même instant : aucune attente de TTL
  });
});

describe('panne de base', () => {
  it('sans lecture précédente → prix codés, jamais 0 (avatar 40)', async () => {
    base.pannes.app_settings = true;
    base.pannes.tarifs_rendu = true;
    const c = await lireTarifs();
    expect(c.source).toBe('defaut');
    expect(c.prix).toEqual(TARIFS_DEFAUT);
    expect(await prixDe('avatar.avatar_v')).toBe(40);
    for (const e of CATALOGUE_TARIFS) expect(c.prix[e.cle]).toBeGreaterThan(0);
  });

  it('après une bonne lecture → dernière grille connue', async () => {
    reglage({ 'avatar.avatar_v': 50 });
    expect(await prixDe('avatar.avatar_v')).toBe(50);
    base.pannes.app_settings = true;
    base.pannes.tarifs_rendu = true;
    maintenant += TTL_TARIFS_MS + 1;
    expect(await prixDe('avatar.avatar_v')).toBe(50);
  });

  it('réglage seul illisible (tarifs_rendu OK) → dernière grille, pas les replis', async () => {
    reglage({ 'avatar.avatar_v': 50, 'ai.image_to_video': 30 });
    expect(await prixDe('ai.image_to_video')).toBe(30);
    base.pannes.app_settings = true;
    maintenant += TTL_TARIFS_MS + 1;
    expect(await prixDe('ai.image_to_video')).toBe(30);
    expect(await prixDe('avatar.avatar_v')).toBe(50);
  });

  it('réglage illisible pendant une écriture → refus, la configuration admin n’est pas écrasée', async () => {
    reglage({ 'avatar.avatar_v': 50, 'ai.image_to_video': 30 });
    base.pannes.app_settings = true;
    await expect(ecrireTarifs({ prix: { 'render.reel': 12 } }, 'contact.artboost@gmail.com')).rejects.toThrow();
    base.pannes.app_settings = false;
    expect((base.tables.app_settings[0].value as { prix: Record<string, number> }).prix).toEqual({ 'avatar.avatar_v': 50, 'ai.image_to_video': 30 });
    expect(base.tables.tarifs_rendu.find((l) => l.format === 'reel')?.credits).toBe(10);
  });
});

describe('valeurs stockées corrompues', () => {
  it('négatif, texte, décimal, null → repli de la clé seule', async () => {
    reglage({
      'avatar.avatar_v': -5,
      'avatar.avatar_iv': '25',
      'ai.ocr': 1.5,
      'ai.upscale': null,
      'avatar.avatar_iii': 10, // valide : gardé
      'cle.inconnue': 3,
    });
    base.tables.tarifs_rendu = [{ format: 'reel', credits: -1 }, { format: 'tv', credits: 'x' }];
    const { prix } = await lireTarifs();
    expect(prix['avatar.avatar_v']).toBe(40);
    expect(prix['avatar.avatar_iv']).toBe(40);
    expect(prix['ai.ocr']).toBe(1);
    expect(prix['ai.upscale']).toBe(3);
    expect(prix['avatar.avatar_iii']).toBe(10);
    expect(prix['render.reel']).toBe(10);
    expect(prix['render.tv']).toBe(15);
    expect(prix).not.toHaveProperty('cle.inconnue');
  });

  it('valeur JSON en chaîne illisible → grille de repli', async () => {
    base.tables.app_settings = [{ key: CLE_REGLAGE_TARIFS, value: '{pas du json' }];
    expect((await lireTarifs()).prix).toEqual(TARIFS_DEFAUT);
  });
});

describe('concurrence', () => {
  it('des lectures simultanées partagent UN chargement', async () => {
    reglage({ 'avatar.avatar_v': 50 });
    const r = await Promise.all(Array.from({ length: 10 }, () => prixDe('avatar.avatar_v')));
    expect(r).toEqual(Array(10).fill(50));
    expect(base.lectures.app_settings).toBe(1);
    expect(base.lectures.tarifs_rendu).toBe(1);
  });
});
