import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  creerDemandeCompte, creerDemandeMeta, executerDemande, prefixesStockageDuCompte,
  statutPublic, statutGlobal, RefusSuppression, TABLES_CONTENUS, TABLES_JETONS, TABLES_CONSERVEES,
  LOTS_MAX_PAR_PASSE,
} from '@/lib/rgpd/suppression-donnees';
import { A, B, dependances } from './helpers/rgpd-faux';

/**
 * Suppression RÉELLE des données — tout est simulé (base, stockage, registre).
 * Ce que ces tests protègent : tout disparaît pour A, RIEN pour B ; une
 * étape ratée n'est jamais « terminée » ; la reprise finit le travail ; le
 * stockage n'est purgé que sous des préfixes dérivés d'un UUID valide.
 */

const lignesDe = (rows: Record<string, unknown>[] | undefined, uid: string) => (rows ?? []).filter((r) => r.user_id === uid);
const clesDe = (s: Set<string> | undefined, uid: string) => [...(s ?? [])].filter((c) => c.includes(uid));

describe('suppression complète du compte', () => {
  it('A : tout disparaît (base + stockage), comptabilité conservée, compte anonymisé ; B : intact', async () => {
    const { deps, base, stockage } = dependances();
    const avantB = JSON.stringify({ t: Object.fromEntries(Object.entries(base.tables).map(([k, v]) => [k, lignesDe(v, B)])), u: base.tables.users.find((u) => u.id === B) });
    const objetsBAvant = Object.fromEntries(Object.entries(stockage.objets).map(([k, v]) => [k, clesDe(v, B).sort()]));

    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);

    expect(d.statut).toBe('terminee');
    expect(d.etapes.every((e) => e.statut === 'terminee')).toBe(true);
    for (const t of [...TABLES_JETONS, ...TABLES_CONTENUS]) expect(lignesDe(base.tables[t], A), t).toEqual([]);
    for (const t of ['credit_transactions', 'subscriptions', 'rendus']) expect(lignesDe(base.tables[t], A).length, t).toBe(1);
    const ua = base.tables.users.find((u) => u.id === A)!;
    expect(ua.email).toBe(`supprime-${A}@supprime.invalid`);
    expect(ua.name).toBe('');
    expect(ua.avatar_url).toBe('');
    expect(ua.blocked).toBe(true);
    expect(ua.deleted_at).toBeTruthy();
    for (const b of Object.keys(stockage.objets)) expect(clesDe(stockage.objets[b], A), b).toEqual([]);

    // Isolation : B strictement inchangé, et les préfixes partagés aussi.
    const apresB = JSON.stringify({ t: Object.fromEntries(Object.entries(base.tables).map(([k, v]) => [k, lignesDe(v, B)])), u: base.tables.users.find((u) => u.id === B) });
    expect(apresB).toBe(avantB);
    expect(Object.fromEntries(Object.entries(stockage.objets).map(([k, v]) => [k, clesDe(v, B).sort()]))).toEqual(objetsBAvant);
    expect(stockage.objets.media.has('converted/partage.mp4')).toBe(true);
    expect(stockage.objets.media.has('externes/abc.jpg')).toBe(true);
    // Aucune requête de base sans filtre sur A.
    for (const a of base.appels.filter((x) => x.op !== 'select')) {
      expect(a.filtres.some((f) => (f.colonne === 'user_id' || f.colonne === 'id') && f.op === 'eq' && f.valeur === A), `${a.op} ${a.table}`).toBe(true);
    }
  });

  it('idempotente : rejouer la même demande, ou en créer une 2e, ne casse rien', async () => {
    const { deps, base, stockage, registre } = dependances();
    const code = (await creerDemandeCompte(A, 'utilisateur', deps)).code;
    const d1 = await executerDemande(code, deps);
    const appels = base.appels.length;
    const d2 = await executerDemande(code, deps);
    expect(d2.statut).toBe('terminee');
    expect(base.appels.length).toBe(appels); // demande terminée : plus rien n'est rejoué
    expect(d2).toEqual(d1);

    const d3 = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d3.statut).toBe('terminee');
    expect(lignesDe(base.tables.videos, B).length).toBe(1);
    expect(clesDe(stockage.objets.media, B).length).toBeGreaterThan(0);
    expect(registre.demandes.size).toBe(2);
  });

  it('panne partielle du stockage : `partielle`, compte NON anonymisé, puis reprise → `terminee`', async () => {
    const { deps, base, stockage, registre } = dependances();
    stockage.panneApres = 2; // deux lots passent, le 3e tombe
    const code = (await creerDemandeCompte(A, 'utilisateur', deps)).code;
    const d = await executerDemande(code, deps);

    expect(d.statut).toBe('partielle');
    const etape = (id: string) => d.etapes.find((e) => e.id === id)!;
    expect(etape('stockage').statut).toBe('partielle');
    expect(etape('stockage').statut).not.toBe('terminee');
    expect(etape('jetons_sociaux').statut).toBe('terminee');
    expect(etape('compte').statut).toBe('en_attente'); // n'anonymise pas tant que tout n'est pas fait
    expect(base.tables.users.find((u) => u.id === A)!.email).toBe('a@exemple.test');
    expect(registre.demandes.get(code)!.statut).toBe('partielle'); // le registre dit la même chose
    expect(statutPublic(registre.demandes.get(code)!).statut).toBe('partielle');

    stockage.panneApres = null;
    const r = await executerDemande(code, deps);
    expect(r.statut).toBe('terminee');
    expect(r.etapes.find((e) => e.id === 'stockage')!.tentatives).toBe(2);
    expect(r.etapes.find((e) => e.id === 'jetons_sociaux')!.tentatives).toBe(1); // non rejouée
    for (const b of Object.keys(stockage.objets)) expect(clesDe(stockage.objets[b], A)).toEqual([]);
    expect(clesDe(stockage.objets.media, B).length).toBeGreaterThan(0);
  });

  it('panne totale du stockage dès le départ : `echec` d’étape, jamais `terminee`', async () => {
    const { deps, stockage } = dependances();
    stockage.panneApres = 0;
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'stockage')!.statut).toBe('echec');
    expect(d.statut).toBe('partielle'); // jetons et contenus sont faits, pas le reste
    expect(d.statut).not.toBe('terminee');
  });

  it('erreur de base (colonne absente) → échec ; table absente → rien à supprimer', async () => {
    const { deps, base } = dependances();
    base.absentes.add('chat_logs');
    base.enPanne.add('videos');
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'contenus')!.statut).toBe('partielle');
    expect(d.statut).toBe('partielle');
    base.enPanne.clear();
    const r = await executerDemande(d.code, deps);
    expect(r.statut).toBe('terminee');
  });

  it('abonnement qui facture encore → refus, RIEN n’est supprimé', async () => {
    const { deps, base, stockage } = dependances();
    const avant = JSON.stringify(base.tables);
    const nbObjets = Object.values(stockage.objets).reduce((n, s) => n + s.size, 0);
    const d = await executerDemande((await creerDemandeCompte(B, 'utilisateur', deps)).code, deps);
    expect(d.statut).toBe('echec');
    expect(d.motif).toBe('verifications:abonnement_actif');
    expect(JSON.stringify(base.tables)).toBe(avant);
    expect(Object.values(stockage.objets).reduce((n, s) => n + s.size, 0)).toBe(nbObjets);
  });

  it('compte protégé (administrateur) → refus, rien supprimé', async () => {
    const { deps, base } = dependances();
    const d = await executerDemande(
      (await creerDemandeCompte(A, 'admin', deps)).code,
      { ...deps, estCompteProtege: (e) => e === 'a@exemple.test' },
    );
    expect(d.statut).toBe('echec');
    expect(d.motif).toBe('verifications:compte_protege');
    expect(lignesDe(base.tables.videos, A).length).toBe(1);
  });

  it('borne par passe : au-delà, `partielle` honnête, et la passe suivante continue', async () => {
    const { deps, stockage } = dependances();
    stockage.objets.media = new Set(Array.from({ length: (LOTS_MAX_PAR_PASSE + 5) * 1000 }, (_, i) => `${A}/f-${i}.jpg`));
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'stockage')!.motif).toBe('stockage:borne_atteinte');
    expect(d.statut).toBe('partielle');
    const r = await executerDemande(d.code, deps);
    expect(r.statut).toBe('terminee');
    expect(stockage.objets.media.size).toBe(0);
  }, 30_000); // des dizaines de milliers d'objets simulés : délai explicite sous charge
});

describe('garde des préfixes de stockage', () => {
  it.each([
    ['', 'vide'], ['..', 'traversée'], ['../x', 'traversée'], ['a/b', 'séparateur'], ['abc', 'non UUID'],
    ['*', 'joker'], [`${A}/..`, 'suffixe'], ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'majuscules'], [null, 'null'], [undefined, 'undefined'], [42, 'nombre'],
  ] as [unknown, string][])('refuse %j (%s)', async (uid: unknown) => {
    expect(() => prefixesStockageDuCompte(uid)).toThrow(RefusSuppression);
    const { deps, registre } = dependances();
    await expect(creerDemandeCompte(uid as string, 'utilisateur', deps)).rejects.toThrow(RefusSuppression);
    expect(registre.demandes.size).toBe(0);
  });

  it('préfixes : uniquement `<uid>/` et `<ns>/<uid>/`, jamais vides, jamais racine', () => {
    const p = prefixesStockageDuCompte(A);
    expect(p.length).toBe(16);
    for (const { prefixe } of p) {
      expect(prefixe === `${A}/` || /^(audio-complet|stock-attributions|fiches-contenu)\//.test(prefixe)).toBe(true);
      expect(prefixe.endsWith(`${A}/`)).toBe(true);
    }
  });

  it('un listage qui renvoie une clé hors du préfixe arrête tout, sans supprimer', async () => {
    const { deps, stockage } = dependances();
    stockage.intrus = [`${B}/rush-1.mp4`];
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'stockage')!.statut).toBe('echec');
    expect(stockage.objets.media.has(`${B}/rush-1.mp4`)).toBe(true);
    expect(stockage.appelsSupprimer).toBe(0);
  });
});

describe('demande Meta', () => {
  it('rattachée : seules les données Meta de A partent ; le compte Studiio reste ; B intact', async () => {
    const { deps, base, liensMeta, stockage } = dependances();
    const d = await executerDemande((await creerDemandeMeta('facebook', '1000001', deps)).code, deps);
    expect(d.statut).toBe('terminee');
    expect(d.userId).toBe(A);
    const sa = base.tables.social_accounts;
    expect(sa.map((r) => r.id).sort()).toEqual(['sa-a-yt', 'sa-b-fb']);
    const ua = base.tables.users.find((u) => u.id === A)!;
    expect(ua.email).toBe('a@exemple.test'); // pas de suppression du compte
    expect(ua.avatar_url).toBe(''); // photo Facebook retirée
    expect(base.tables.users.find((u) => u.id === B)!.avatar_url).toContain('fbsbx.com');
    expect(lignesDe(base.tables.videos, A).length).toBe(1);
    expect(clesDe(stockage.objets.media, A).length).toBeGreaterThan(0);
    expect(liensMeta.liens.has('facebook:1000001')).toBe(false);
    expect(liensMeta.liens.get('facebook:1000002')).toBe(B);
  });

  it('non rattachée : `en_attente` (vérification manuelle), rien n’est touché, jamais « terminée »', async () => {
    const { deps, base } = dependances();
    const avant = JSON.stringify(base.tables);
    const d = await executerDemande((await creerDemandeMeta('facebook', '999', deps)).code, deps);
    expect(d.statut).toBe('en_attente');
    expect(d.userId).toBeNull();
    expect(JSON.stringify(base.tables)).toBe(avant);
  });

  it('lien illisible (panne) : `echec`, reprise possible ensuite', async () => {
    const { deps, liensMeta } = dependances();
    const resoudre = liensMeta.resoudre;
    liensMeta.resoudre = async () => { throw new Error('MinIO'); };
    const code = (await creerDemandeMeta('facebook', '1000001', deps)).code;
    expect((await executerDemande(code, deps)).statut).toBe('echec');
    liensMeta.resoudre = resoudre;
    expect((await executerDemande(code, deps)).statut).toBe('terminee');
  });

  it('identifiant Meta non numérique refusé', async () => {
    const { deps } = dependances();
    await expect(creerDemandeMeta('facebook', '../1', deps)).rejects.toThrow(RefusSuppression);
  });
});

describe('statut public', () => {
  it('ne contient ni uid, ni identifiant Meta, ni adresse, ni motif interne', async () => {
    const { deps } = dependances();
    const d = await executerDemande((await creerDemandeMeta('facebook', '1000001', deps)).code, deps);
    const json = JSON.stringify(statutPublic(d));
    expect(json).not.toContain(A);
    expect(json).not.toContain('1000001');
    expect(json).not.toContain('@');
    expect(json).not.toContain('motif');
  });

  it('statut global calculé des étapes uniquement', () => {
    const e = (statut: any) => ({ id: 'stockage' as const, statut, tentatives: 1, maj: null });
    expect(statutGlobal([e('terminee'), e('terminee')])).toBe('terminee');
    expect(statutGlobal([e('terminee'), e('echec')])).toBe('partielle');
    expect(statutGlobal([e('echec'), e('en_attente')])).toBe('echec');
    expect(statutGlobal([e('en_attente'), e('en_attente')])).toBe('en_attente');
    expect(statutGlobal([])).toBe('en_attente');
  });
});

describe('plan des tables', () => {
  const sql = [join(process.cwd(), 'migrations'), join(process.cwd(), 'src/lib/db/migrations')]
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(dir, f), 'utf-8')))
    .join('\n');

  it.each([...TABLES_JETONS, ...TABLES_CONTENUS])('%s existe dans les migrations avec une colonne user_id', (table) => {
    const re = new RegExp(`create table (if not exists )?(public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i');
    const m = sql.match(re);
    expect(m, `create table ${table}`).toBeTruthy();
    expect(/\buser_id\b/i.test(m![3])).toBe(true);
  });

  it('aucune table conservée n’est dans les listes de suppression', () => {
    for (const t of TABLES_CONSERVEES) {
      expect((TABLES_CONTENUS as readonly string[]).includes(t)).toBe(false);
      expect((TABLES_JETONS as readonly string[]).includes(t)).toBe(false);
    }
  });
});
