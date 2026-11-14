// Corrections de traductions — routes (base simulée en mémoire, aucun réseau) :
// lecture publique, administration (JSON/CSV), correction, validation, import, pannes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const base = vi.hoisted(() => ({
  store: new Map<string, string>(),
  echecLecture: false,
  echecEcriture: false,
  ecritures: 0,
  admin: true,
  audit: [] as unknown[],
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'app_settings') throw new Error(`table inattendue ${table}`);
      return {
        select: () => ({
          eq: (_c: string, cle: string) => ({
            maybeSingle: async () => (base.echecLecture ? { data: null, error: { message: 'panne' } } : { data: base.store.has(cle) ? { value: base.store.get(cle) } : null, error: null }),
          }),
        }),
        upsert: async (ligne: { key: string; value: string }) => {
          if (base.echecEcriture) return { error: { message: 'panne' } };
          base.store.set(ligne.key, ligne.value); base.ecritures += 1; return { error: null };
        },
      };
    },
  },
}));
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => (base.admin ? { error: null, session: { user: { id: 'u1', email: 'admin@studiio.test' } } } : { error: NextResponse.json({ success: false }, { status: 403 }), session: null }),
  logAdminAction: async (a: unknown) => { base.audit.push(a); },
}));

import { GET as lirePublic, viderMemo } from '@/app/api/i18n/[locale]/route';
import { GET as lireAdmin, PATCH as modifier } from '@/app/api/admin/traductions/route';
import { POST as importer } from '@/app/api/admin/traductions/import/route';
import { chargerMessages } from '@/i18n/provider';

const json = (m: string, url: string, corps?: unknown) => new NextRequest(`http://localhost${url}`, { method: m, body: corps === undefined ? undefined : JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const lectureAdmin = async (loc = 'ln') => (await (await lireAdmin(json('GET', `/api/admin/traductions?locale=${loc}`))).json());
// Clés réelles du catalogue : `common.close` est traduite en ln (« Kokanga ») ; `notifications.rushIntrouvable.titleOne` a la variable {n}.
const CLE = 'common.close';
const CLE_VAR = 'notifications.rushIntrouvable.titleOne';

beforeEach(() => {
  base.store.clear(); base.echecLecture = false; base.echecEcriture = false; base.ecritures = 0; base.admin = true; base.audit = []; viderMemo();
});

describe('route publique /api/i18n/<langue>', () => {
  it('renvoie les corrections { clé: texte } — sans auteur ni statut', async () => {
    await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'Kokanga ye', valider: true }));
    viderMemo();
    const r = await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } });
    expect(await r.json()).toEqual({ corrections: { [CLE]: 'Kokanga ye' } });
  });
  it('français ou langue inconnue : 404 ; panne de base : 200 sans correction (l\'app ne casse jamais)', async () => {
    expect((await lirePublic(json('GET', '/api/i18n/fr'), { params: { locale: 'fr' } })).status).toBe(404);
    expect((await lirePublic(json('GET', '/api/i18n/xx'), { params: { locale: 'xx' } })).status).toBe(404);
    base.echecLecture = true; viderMemo();
    const r = await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ corrections: {} });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('administration — lecture', () => {
  it('refuse un non-administrateur', async () => {
    base.admin = false;
    expect((await lireAdmin(json('GET', '/api/admin/traductions?locale=ln'))).status).toBe(403);
  });
  it('rejette le français (source) et les langues inconnues', async () => {
    expect((await lireAdmin(json('GET', '/api/admin/traductions?locale=fr'))).status).toBe(400);
    expect((await lireAdmin(json('GET', '/api/admin/traductions?locale=zz'))).status).toBe(400);
  });
  it('tableau du lingala : traductions du catalogue, statuts « non validée », mention Partiel', async () => {
    const j = await lectureAdmin('ln');
    expect(j.statutAffiche).toBe('partial');
    expect(j.compteurs.traduites).toBeGreaterThan(400);
    expect(j.compteurs.validees).toBe(0);
    expect(j.compteurs.nonValidees).toBe(j.compteurs.traduites);
    const l = j.lignes.find((x: { cle: string }) => x.cle === CLE);
    expect(l.texte).toBe('Kokanga');
    expect(['non_validee_attestee', 'non_validee_a_verifier']).toContain(l.statut);
  });
  it('bàsàa : quasi tout est manquant (français affiché)', async () => {
    const j = await lectureAdmin('bas');
    expect(j.compteurs.traduites).toBeLessThan(10);
    expect(j.compteurs.manquantes).toBeGreaterThan(3000);
  });
  it('panne de lecture → 503 (jamais un tableau vide trompeur)', async () => {
    base.echecLecture = true;
    expect((await lireAdmin(json('GET', '/api/admin/traductions?locale=ln'))).status).toBe(503);
  });
});

describe('administration — corriger / valider une entrée', () => {
  it('une correction est enregistrée NON validée, tracée dans le journal d\'audit', async () => {
    const r = await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'Kokanga nzela' }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ligne).toMatchObject({ texte: 'Kokanga nzela', statut: 'non_validee', confiance: 'admin', par: 'admin@studiio.test' });
    expect(base.audit).toHaveLength(1);
    expect(JSON.stringify(base.audit[0])).not.toContain('Kokanga nzela');   // le texte n'est pas copié dans l'audit
  });
  it('valider telle quelle, puis modifier le texte REDONNE le statut non validée', async () => {
    let j = await (await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, valider: true }))).json();
    expect(j.ligne).toMatchObject({ texte: 'Kokanga', statut: 'validee' });
    expect(j.compteurs.validees).toBe(1);
    j = await (await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'Kokanga 2' }))).json();
    expect(j.ligne.statut).toBe('non_validee');
    j = await (await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'Kokanga 3', valider: true }))).json();
    expect(j.ligne.statut).toBe('validee');
    j = await (await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, valider: false }))).json();
    expect(j.ligne).toMatchObject({ texte: 'Kokanga 3', statut: 'non_validee' });
  });
  it('retirer une traduction (texte vide) → « manquante » : le français s\'affichera', async () => {
    const j = await (await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: '' }))).json();
    expect(j.ligne.statut).toBe('manquante');
    viderMemo();
    const pub = await (await lirePublic(json('GET', '/api/i18n/ln'), { params: { locale: 'ln' } })).json();
    expect(pub.corrections[CLE]).toBe('');
  });
  it('refuse : variables différentes, clé inconnue, langue française, validation d\'un texte vide, corps vide', async () => {
    const essai = async (corps: unknown) => (await modifier(json('PATCH', '/api/admin/traductions', corps))).status;
    expect(await essai({ locale: 'ln', cle: CLE_VAR, texte: 'Sans variable' })).toBe(422);
    expect(await essai({ locale: 'ln', cle: 'inconnue.cle', texte: 'x' })).toBe(400);
    expect(await essai({ locale: 'fr', cle: CLE, texte: 'x' })).toBe(400);
    expect(await essai({ locale: 'bas', cle: CLE, valider: true })).toBe(422);   // rien à valider : bàsàa n'a pas cette entrée
    expect(await essai({ locale: 'ln', cle: CLE })).toBe(400);
    expect(await essai({ locale: 'ln', cle: CLE, texte: '<b>x</b>' })).toBe(422);
    expect(base.ecritures).toBe(0);
  });
  it('avec la bonne variable, c\'est accepté', async () => {
    const r = await modifier(json('PATCH', '/api/admin/traductions', { locale: 'wo', cle: CLE_VAR, texte: '{n} rush introuvable (wo)' }));
    expect(r.status).toBe(200);
  });
  it('panne de LECTURE : rien n\'est écrit (jamais d\'écrasement) ; panne d\'ÉCRITURE : pas de faux succès', async () => {
    base.echecLecture = true;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'X' }))).status).toBe(503);
    expect(base.ecritures).toBe(0);
    base.echecLecture = false; base.echecEcriture = true;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'X' }))).status).toBe(500);
  });
  it('non-administrateur : 403, rien d\'écrit', async () => {
    base.admin = false;
    expect((await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'X' }))).status).toBe(403);
    expect(base.ecritures).toBe(0);
  });
});

describe('import CSV', () => {
  const csv = (...lignes: string[]) => ['cle;francais;traduction', ...lignes].join('\n');
  it('importe, ignore les cellules vides, compte les inchangées, refuse les lignes invalides sans s\'arrêter', async () => {
    const r = await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: csv(
      `${CLE};Fermer;Kokanga ya sika`,        // importée
      'common.save;Enregistrer;Kobómbisa',    // identique au catalogue → inchangée
      'common.cancel;Annuler;',               // vide → ignorée
      'inconnue.cle;x;Oyo',                   // clé inconnue → refusée
      `${CLE_VAR};x;Sans variable`,           // variables → refusée
    ) }));
    const j = await r.json();
    expect(j.success).toBe(true);
    expect(j.rapport).toMatchObject({ importees: 1, inchangees: 1, vides: 1, refuseesTotal: 2 });
    expect(j.rapport.refusees.map((x: { cle: string }) => x.cle).sort()).toEqual(['inconnue.cle', CLE_VAR].sort());
    expect((await lectureAdmin('ln')).lignes.find((l: { cle: string }) => l.cle === CLE).texte).toBe('Kokanga ya sika');
  });
  it('« validées » marque les entrées importées comme validées', async () => {
    const j = await (await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', validees: true, csv: csv(`${CLE};Fermer;Kokanga ya sika`) }))).json();
    expect(j.compteurs.validees).toBe(1);
  });
  it('EXPORT puis RÉIMPORT du même fichier : rien ne change, rien ne s\'efface (les vides sont ignorés)', async () => {
    await modifier(json('PATCH', '/api/admin/traductions', { locale: 'ln', cle: CLE, texte: 'Kokanga bis' }));
    const avant = await lectureAdmin('ln');
    const exportCsv = await (await lireAdmin(json('GET', '/api/admin/traductions?locale=ln&format=csv'))).text();
    expect(exportCsv.split('\n')[0]).toBe('"cle";"francais";"traduction";"statut";"confiance";"source"');
    const j = await (await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: exportCsv }))).json();
    expect(j.rapport.importees).toBe(0);
    expect(j.rapport.refuseesTotal).toBe(0);
    expect((await lectureAdmin('ln')).compteurs).toEqual(avant.compteurs);
  });
  it('fichier sans colonnes cle/traduction, vide ou énorme : refusé proprement', async () => {
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: 'a;b\n1;2' }))).status).toBe(422);
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: '   ' }))).status).toBe(400);
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: 'x'.repeat(2 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'fr', csv: csv('a;b;c') }))).status).toBe(400);
  });
  it('panne de lecture : 503, rien d\'importé ; non-admin : 403', async () => {
    base.echecLecture = true;
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: csv(`${CLE};x;Y`) }))).status).toBe(503);
    base.echecLecture = false; base.admin = false;
    expect((await importer(json('POST', '/api/admin/traductions/import', { locale: 'ln', csv: csv(`${CLE};x;Y`) }))).status).toBe(403);
    expect(base.ecritures).toBe(0);
  });
});

describe('le visiteur voit la correction (fournisseur de langue)', () => {
  it('une correction PRIME sur le catalogue ; un retrait retombe en français ; panne = catalogue seul', async () => {
    const reel = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ corrections: { [CLE]: 'Kokanga CORRIGÉ', 'common.save': '' } }), { status: 200 })) as typeof fetch;
      const m = (await chargerMessages('ln')) as { common: Record<string, string> };
      expect(m.common.close).toBe('Kokanga CORRIGÉ');
      expect(m.common.save).toBe('Enregistrer');                 // retiré → français
      expect(m.common.cancel).toBe('Kolongola');                 // catalogue intact
      globalThis.fetch = vi.fn(async () => { throw new Error('réseau coupé'); }) as typeof fetch;
      const m2 = (await chargerMessages('ln')) as { common: Record<string, string> };
      expect(m2.common.close).toBe('Kokanga');                   // panne : catalogue livré
      globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch;
      expect(((await chargerMessages('ln')) as { common: Record<string, string> }).common.close).toBe('Kokanga');
    } finally { globalThis.fetch = reel; }
  });
});
