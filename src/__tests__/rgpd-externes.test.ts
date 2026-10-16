import { describe, it, expect } from 'vitest';
import {
  creerDemandeCompte, creerDemandeMeta, executerDemande, statutPublic, statutGlobalPublic, externesDe,
  FOURNISSEURS, CONSERVE_PUBLIC,
} from '@/lib/rgpd/suppression-donnees';
import { A, B, dependances } from './helpers/rgpd-faux';

/**
 * Fournisseurs externes : AUCUN appel fournisseur. Le statut ne dit jamais
 * « terminée » globalement tant qu'une opération manuelle reste à faire, et
 * `non_applicable` ne vient QUE de données locales qui prouvent l'absence.
 */

const etats = (d: { externes?: { fournisseur: string; etat: string }[] }) =>
  Object.fromEntries((d.externes ?? []).map((e) => [e.fournisseur, e.etat]));

/** Vide les traces fournisseur de A (B garde tout). */
function sansTracesExternes(jeu: ReturnType<typeof dependances>) {
  for (const t of ['user_avatars', 'avatar_versions', 'avatar_generations', 'user_voices', 'zernio_accounts', 'credit_transactions', 'subscriptions']) {
    jeu.base.tables[t] = (jeu.base.tables[t] ?? []).filter((r) => r.user_id !== A);
  }
  jeu.base.tables.social_accounts = jeu.base.tables.social_accounts.filter((r) => !(r.user_id === A && ['facebook', 'instagram'].includes(r.platform as string)));
  jeu.base.tables.users.find((u) => u.id === A)!.avatar_url = 'https://lh3.googleusercontent.com/a.jpg';
  jeu.liensMeta.liens.delete('facebook:1000001');
}

describe('inventaire des opérations externes (compte)', () => {
  it('traces locales partout → tout « a_faire_manuellement » ; global ≠ terminee', async () => {
    const jeu = dependances();
    jeu.base.tables.user_avatars = [{ id: 'av', user_id: A, provider_avatar_id: 'hg-avatar-secret' }];
    jeu.base.tables.user_voices = [{ id: 'v', user_id: A, provider: 'elevenlabs', provider_voice_id: 'el-voice-secret' }];
    jeu.base.tables.zernio_accounts = [{ id: 'z', user_id: A, profile_id: 'zr-profile-secret', account_id: 'zr-acc' }];
    jeu.base.tables.subscriptions = [{ id: 's', user_id: A, status: 'canceled', stripe_subscription_id: 'sub_secret', stripe_customer_id: 'cus_secret' }];

    const d = await executerDemande((await creerDemandeCompte(A, 'admin', jeu.deps)).code, jeu.deps);

    expect(d.statut).toBe('terminee'); // dans Studiio
    expect(etats(d)).toEqual({ heygen: 'a_faire_manuellement', elevenlabs: 'a_faire_manuellement', zernio: 'a_faire_manuellement', stripe: 'a_faire_manuellement', meta: 'a_faire_manuellement' });
    expect(statutGlobalPublic(d)).toBe('terminee_studiio_externes_restantes');

    // Les identifiants sont relevés AVANT la suppression locale (registre privé)…
    const refs = d.referencesExternes!.map((r) => `${r.fournisseur}:${r.valeur}`);
    expect(refs).toEqual(expect.arrayContaining(['heygen:hg-avatar-secret', 'elevenlabs:el-voice-secret', 'zernio:zr-profile-secret', 'stripe:sub_secret', 'stripe:cus_secret']));
    expect(jeu.base.tables.user_avatars.filter((r) => r.user_id === A)).toEqual([]);

    // …mais JAMAIS publiés.
    const pub = statutPublic(d);
    expect(pub.statut).toBe('terminee_studiio_externes_restantes');
    expect(pub.studiio).toBe('terminee');
    expect(pub.message).toMatch(/Terminée dans Studiio — opérations externes restantes/);
    expect(pub.conserve).toEqual([...CONSERVE_PUBLIC]);
    expect(pub.conserve).toContain('comptabilite (credit_transactions, subscriptions, rendus)');
    const json = JSON.stringify(pub);
    for (const secret of ['hg-avatar-secret', 'el-voice-secret', 'zr-profile-secret', 'sub_secret', 'cus_secret', A, '@', 'referencesExternes']) {
      expect(json).not.toContain(secret);
    }
    expect(pub.externes.map((e) => Object.keys(e).sort().join(','))).toEqual(FOURNISSEURS.map(() => 'action,etat,fournisseur'));
  });

  it('aucune trace locale → tout « non_applicable » → global terminee', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d)).toEqual({ heygen: 'non_applicable', elevenlabs: 'non_applicable', zernio: 'non_applicable', stripe: 'non_applicable', meta: 'non_applicable' });
    expect(statutPublic(d).statut).toBe('terminee');
  });

  it('voix HeyGen dans user_voices → heygen, pas elevenlabs', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    jeu.base.tables.user_voices = [{ id: 'v', user_id: A, provider: 'heygen', provider_voice_id: 'hv' }];
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d)).toMatchObject({ heygen: 'a_faire_manuellement', elevenlabs: 'non_applicable' });
  });

  it('achat Stripe (reference stripe:) → stripe à faire ; achat sans référence Stripe → non applicable', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    jeu.base.tables.credit_transactions = [{ id: 'c', user_id: A, type: 'purchase', reference_id: 'pawapay:x' }];
    let d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d).stripe).toBe('non_applicable');

    const jeu2 = dependances();
    sansTracesExternes(jeu2);
    jeu2.base.tables.credit_transactions = [{ id: 'c', user_id: A, type: 'purchase', reference_id: 'stripe:cs:cs_test' }];
    d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu2.deps)).code, jeu2.deps);
    expect(etats(d).stripe).toBe('a_faire_manuellement');
  });

  it('connexion Facebook (lien Meta seul) → meta à faire', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    jeu.liensMeta.liens.set('facebook:1000009', A);
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d).meta).toBe('a_faire_manuellement');
  });

  it('lecture locale en échec → « a_faire_manuellement », jamais un faux « non applicable »', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    jeu.base.enPanne.add('zernio_accounts'); // lecture ET suppression en panne
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d).zernio).toBe('a_faire_manuellement');
    expect(d.statut).toBe('partielle');
  });

  it('table absente → rien chez ce fournisseur (non applicable)', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    jeu.base.absentes.add('zernio_accounts');
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d).zernio).toBe('non_applicable');
  });

  it('inventaire FIGÉ : une reprise après suppression locale ne le recalcule pas en « non applicable »', async () => {
    const jeu = dependances();
    jeu.stockage.panneApres = 0;
    const code = (await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code;
    const d1 = await executerDemande(code, jeu.deps);
    expect(d1.statut).toBe('partielle');
    expect(etats(d1).zernio).toBe('a_faire_manuellement');
    jeu.stockage.panneApres = null;
    const d2 = await executerDemande(code, jeu.deps);
    expect(d2.statut).toBe('terminee');
    expect(etats(d2).zernio).toBe('a_faire_manuellement'); // zernio_accounts de A a disparu entre-temps
    expect(statutGlobalPublic(d2)).toBe('terminee_studiio_externes_restantes');
  });

  it('B n’est jamais lu pour l’inventaire de A', async () => {
    const jeu = dependances();
    await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    for (const a of jeu.base.appels.filter((x) => x.op === 'select')) {
      expect(a.filtres.some((f) => (f.colonne === 'user_id' || f.colonne === 'id') && f.op === 'eq' && f.valeur === A), a.table).toBe(true);
    }
    expect(B).not.toBe(A);
  });

  it('demande de compte sans inventaire (ancienne) → tous à faire, jamais terminee global', () => {
    const d = { code: '0'.repeat(32), portee: 'compte', statut: 'terminee', etapes: [], creeLe: '', majLe: '' } as never;
    expect(externesDe(d).every((e) => e.etat === 'a_faire_manuellement')).toBe(true);
    expect(statutGlobalPublic(d)).toBe('terminee_studiio_externes_restantes');
  });
});

describe('portée Meta', () => {
  it('Meta seul, non applicable (autorisation déjà retirée côté Meta) → global terminee', async () => {
    const jeu = dependances();
    const d = await executerDemande((await creerDemandeMeta('facebook', '1000001', jeu.deps)).code, jeu.deps);
    expect(d.statut).toBe('terminee');
    expect(d.externes).toEqual([{ fournisseur: 'meta', action: 'revoquer_autorisation_application', etat: 'non_applicable' }]);
    expect(statutPublic(d).statut).toBe('terminee');
  });
});

describe('ligne users', () => {
  it('stripe_customer_id / zernio_profile_id sur users → à faire, identifiants relevés en privé', async () => {
    const jeu = dependances();
    sansTracesExternes(jeu);
    Object.assign(jeu.base.tables.users.find((u) => u.id === A)!, { stripe_customer_id: 'cus_x', zernio_profile_id: 'zp_x' });
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', jeu.deps)).code, jeu.deps);
    expect(etats(d)).toMatchObject({ stripe: 'a_faire_manuellement', zernio: 'a_faire_manuellement', heygen: 'non_applicable' });
    expect(d.referencesExternes!.map((r) => r.valeur).sort()).toEqual(['cus_x', 'zp_x']);
    expect(JSON.stringify(statutPublic(d))).not.toMatch(/cus_x|zp_x/);
  });
});
