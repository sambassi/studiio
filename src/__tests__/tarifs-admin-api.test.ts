// @vitest-environment node
/**
 * Tarifs & crédits — routes `/api/admin/tarifs` (GET/PUT) et `/api/tarifs`.
 *
 * Base en mémoire (app_settings, tarifs_rendu, audit_log, users), session
 * simulée. Prouve : prix d'aujourd'hui par défaut, un PUT admin s'applique à
 * la lecture suivante sans redémarrage, historique écrit, garde 401/403,
 * validation 400 sans rien écrire, et UI = serveur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session, DEV_AUTH_BYPASS: false }));
vi.mock('@/lib/db/supabase', async () => {
  const m = await import('./aides/base-memoire-tarifs');
  return { supabaseAdmin: m.supabaseAdminMemoire, supabase: m.supabaseAdminMemoire };
});

import { base, reinitialiserBase } from './aides/base-memoire-tarifs';
import { GET as getAdmin, PUT as putAdmin } from '@/app/api/admin/tarifs/route';
import { GET as getPublic } from '@/app/api/tarifs/route';
import { lireTarifs, prixDe, reinitialiserTarifs } from '@/lib/tarifs/serveur';
import { CLE_ACTION_IA, CATALOGUE_TARIFS, type CleTarif } from '@/lib/tarifs/catalogue';

const ADMIN = { user: { id: 'admin-1', email: 'contact.artboost@gmail.com' } };
const CLIENT = { user: { id: 'client-1', email: 'client@exemple.fr' } };

const put = (corps: unknown) => putAdmin(new Request('http://localhost/api/admin/tarifs', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}) as never);

beforeEach(() => {
  reinitialiserBase();
  reinitialiserTarifs();
  base.tables.users = [
    { id: 'admin-1', email: 'contact.artboost@gmail.com', role: 'admin' },
    { id: 'client-1', email: 'client@exemple.fr', role: 'user' },
  ];
  etat.session = ADMIN;
});

/** Les prix codés AVANT la configuration admin — `AI_CREDITS` de /api/ai/image inclus. */
const PRIX_AUJOURDHUI: Record<CleTarif, number> = {
  'audio.full_1000_chars': 1,
  'render.reel': 10,
  'render.tv': 15,
  'render.infographic': 25,
  'avatar.avatar_iii': 40,
  'avatar.avatar_iv': 40,
  'avatar.avatar_v': 40,
  'avatar.jumeau': 40,
  'ai.remove_background': 2,
  'ai.magic_eraser': 3,
  'ai.magic_edit': 5,
  'ai.upscale': 3,
  'ai.image_to_video': 15,
  'ai.generate_background': 5,
  'ai.magic_layers': 3,
  'ai.style_transfer': 5,
  'ai.ocr': 1,
  'autopilot.poster_reference': 5,
};
const AI_CREDITS_ROUTE: Record<string, number> = {
  'remove-bg': 2, 'magic-eraser': 3, 'magic-edit': 5, 'upscale': 3, 'image-to-video': 15,
  'generate-bg': 5, 'magic-layers': 3, 'style-transfer': 5, 'ocr': 1,
};

describe('GET /api/admin/tarifs', () => {
  it('base vide → les prix d’aujourd’hui, aucun changement économique', async () => {
    const r = await getAdmin();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.prix).toEqual(PRIX_AUJOURDHUI);
    for (const [action, credits] of Object.entries(AI_CREDITS_ROUTE)) {
      expect(j.prix[CLE_ACTION_IA[action]]).toBe(credits);
    }
    expect(j.catalogue).toHaveLength(CATALOGUE_TARIFS.length);
    expect(j.max).toBe(10_000);
    expect(j.gratuits.length).toBe(3);
    expect(j.valeurCreditChf).toBeNull();
    expect(j.source).toBe('configuration');
    expect(j.historique).toEqual([]);
  });
});

describe('PUT /api/admin/tarifs — modification', () => {
  it('avatar_v 40 → 50 : la lecture suivante rend 50, sans redémarrage', async () => {
    expect(await prixDe('avatar.avatar_v')).toBe(40); // grille en cache
    const r = await put({ prix: { 'avatar.avatar_v': 50 } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.changements).toEqual([{ cle: 'avatar.avatar_v', ancien: 40, nouveau: 50 }]);
    expect(await prixDe('avatar.avatar_v')).toBe(50);
    expect((await lireTarifs()).prix['avatar.avatar_iii']).toBe(40);
  });

  it('render.reel → la ligne tarifs_rendu (lue par le débit SQL) est mise à jour', async () => {
    const r = await put({ prix: { 'render.reel': 12 } });
    expect(r.status).toBe(200);
    expect(base.tables.tarifs_rendu.find((l) => l.format === 'reel')?.credits).toBe(12);
    expect(base.tables.tarifs_rendu.find((l) => l.format === 'tv')?.credits).toBe(15);
    expect(await prixDe('render.reel')).toBe(12);
  });

  it('audit_log reçoit { cle, ancien, nouveau } et l’admin', async () => {
    await put({ prix: { 'avatar.avatar_v': 50 }, valeurCreditChf: 0.1 });
    const lignes = base.tables.audit_log;
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({
      admin_email: 'contact.artboost@gmail.com',
      action: 'update_pricing',
      target_id: 'avatar.avatar_v',
      details: { cle: 'avatar.avatar_v', ancien: 40, nouveau: 50 },
    });
    expect(lignes[1].details).toEqual({ cle: 'credit.value_chf', ancien: null, nouveau: 0.1 });
    const h = (await (await getAdmin()).json()).historique;
    expect(h.map((x: { cle: string }) => x.cle).sort()).toEqual(['avatar.avatar_v', 'credit.value_chf']);
    expect(h[0].admin).toBe('contact.artboost@gmail.com');
  });

  it('valeur identique → aucun changement, rien écrit', async () => {
    const r = await put({ prix: { 'avatar.avatar_v': 40 } });
    expect((await r.json()).changements).toEqual([]);
    expect(base.ecritures).toBe(0);
  });
});

describe('garde admin', () => {
  it.each([
    ['client connecté', () => CLIENT, 403],
    ['anonyme', () => null, 401],
  ])('%s → %i sur GET et PUT, rien écrit', async (_nom, session, code) => {
    etat.session = session();
    const g = await getAdmin();
    expect(g.status).toBe(code);
    expect(JSON.stringify(await g.json())).not.toMatch(/coutsFournisseur|valeurCredit/);
    const p = await put({ prix: { 'avatar.avatar_v': 1 } });
    expect(p.status).toBe(code);
    expect(base.ecritures).toBe(0);
    expect(base.tables.audit_log).toHaveLength(0);
    reinitialiserTarifs();
    expect(await prixDe('avatar.avatar_v')).toBe(40);
  });
});

describe('validation → 400, rien écrit', () => {
  it.each([
    ['négatif', { prix: { 'avatar.avatar_v': -1 } }, 'avatar.avatar_v'],
    ['non entier', { prix: { 'avatar.avatar_v': 2.5 } }, 'avatar.avatar_v'],
    ['chaîne', { prix: { 'avatar.avatar_v': '50' } }, 'avatar.avatar_v'],
    ['> max', { prix: { 'avatar.avatar_v': 10_001 } }, 'avatar.avatar_v'],
    ['clé inconnue', { prix: { 'avatar.inexistant': 5 } }, 'avatar.inexistant'],
    ['valeur du crédit négative', { valeurCreditChf: -0.1 }, 'valeurCreditChf'],
    ['valeur du crédit nulle', { valeurCreditChf: 0 }, 'valeurCreditChf'],
    ['valeur du crédit texte', { valeurCreditChf: 'abc' }, 'valeurCreditChf'],
    ['valeur du crédit > 100', { valeurCreditChf: 101 }, 'valeurCreditChf'],
  ])('%s', async (_nom, corps, champ) => {
    const r = await put(corps);
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.erreurs.map((e: { champ: string }) => e.champ)).toContain(champ);
    expect(base.ecritures).toBe(0);
    expect(base.tables.app_settings).toHaveLength(0);
    expect(base.tables.audit_log).toHaveLength(0);
  });

  it('un champ invalide bloque TOUT le lot (pas d’écriture partielle)', async () => {
    const r = await put({ prix: { 'avatar.avatar_iii': 10, 'avatar.avatar_v': -5 } });
    expect(r.status).toBe(400);
    expect(base.ecritures).toBe(0);
    expect(await prixDe('avatar.avatar_iii')).toBe(40);
  });
});

describe('GET /api/tarifs — l’écran lit ce que débite le serveur', () => {
  it('client : même grille que prixDe, exempte false', async () => {
    await put({ prix: { 'avatar.avatar_v': 50, 'ai.ocr': 2 } });
    etat.session = CLIENT;
    const r = await getPublic();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.exempte).toBe(false);
    for (const e of CATALOGUE_TARIFS) expect(j.prix[e.cle]).toBe(await prixDe(e.cle));
    expect(j.prix['avatar.avatar_v']).toBe(50);
    expect(j).not.toHaveProperty('coutsFournisseur');
    expect(j).not.toHaveProperty('valeurCreditChf');
  });

  it('admin : exempte true, le prix public reste affiché (50)', async () => {
    await put({ prix: { 'avatar.avatar_v': 50 } });
    const j = await (await getPublic()).json();
    expect(j.exempte).toBe(true);
    expect(j.prix['avatar.avatar_v']).toBe(50);
  });

  it('anonyme → 401', async () => {
    etat.session = null;
    expect((await getPublic()).status).toBe(401);
  });
});
