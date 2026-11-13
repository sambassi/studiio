/**
 * PAIEMENT MOBILE MONEY — les neuf cas qui décident d'un encaissement.
 *
 * Ce ne sont pas les cas nominaux qui coûtent de l'argent : ce sont la
 * notification reçue deux fois, le montant qui ne correspond pas, la
 * confirmation qui arrive en retard, le retour du navigateur sans paiement.
 * Aucun ne se provoque chez un vrai prestataire — ils se jouent tous ici,
 * sans un franc déplacé et sans un appel sortant.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Base en mémoire : `pawapay_depots`, `users`, et la fonction SQL ───────
import type { Depot } from '@/lib/paiements/pawapay/depots';

/** La ligne telle que la base la stocke — le type du module fait foi. */
type LigneDepot = Depot;

const base = {
  depots: [] as LigneDepot[],
  soldes: new Map<string, number>(),
  /** Index unique partiel `reference_id like 'mm:%'` — la garantie d'unicité. */
  references: new Map<string, string>(),
  fonctionAbsente: false,
};

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'pawapay_depots') throw new Error(`table inattendue : ${table}`);
    const filtres: Array<(l: LigneDepot) => boolean> = [];
    // Les tris s'empilent, comme en SQL : le premier `order` décide, les
    // suivants départagent. Reproduire cela FIDÈLEMENT est tout l'enjeu ici —
    // c'est l'ordre de relecture qui empêche la file de se bloquer.
    const tris: Array<{ col: string; croissant: boolean; nullsFirst: boolean }> = [];
    let patch: Partial<LigneDepot> | null = null;
    let insertion: LigneDepot | null = null;
    let limite: number | undefined;
    let compterSeulement = false;
    const champ = (l: LigneDepot, k: string) => (l as never as Record<string, unknown>)[k];
    const retenues = () => base.depots.filter((l) => filtres.every((f) => f(l)));
    const comparer = (a: LigneDepot, b: LigneDepot) => {
      for (const t of tris) {
        const va = champ(a, t.col) as string | null;
        const vb = champ(b, t.col) as string | null;
        if (va === vb) continue;
        if (va === null || va === undefined) return t.nullsFirst ? -1 : 1;
        if (vb === null || vb === undefined) return t.nullsFirst ? 1 : -1;
        return (va < vb ? -1 : 1) * (t.croissant ? 1 : -1);
      }
      return 0;
    };
    const exec = () => {
      if (insertion) { base.depots.push(insertion); return { data: [insertion], error: null, count: 1 }; }
      let rows = retenues();
      if (patch) for (const l of rows) Object.assign(l, patch);
      if (compterSeulement) return { data: null, error: null, count: rows.length };
      rows = [...rows].sort(comparer);
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows, error: null, count: rows.length };
    };
    const cmp = (k: string, v: unknown, op: '<' | '>=') =>
      filtres.push((l) => {
        const x = champ(l, k) as string;
        return op === '<' ? x < (v as string) : x >= (v as string);
      });
    const api: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.head) compterSeulement = true;
        return api;
      },
      insert: (v: LigneDepot) => { insertion = v; return api; },
      update: (p: Partial<LigneDepot>) => { patch = p; return api; },
      eq: (k: string, v: unknown) => { filtres.push((l) => champ(l, k) === v); return api; },
      lt: (k: string, v: unknown) => { cmp(k, v, '<'); return api; },
      gte: (k: string, v: unknown) => { cmp(k, v, '>='); return api; },
      order: (c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => {
        tris.push({ col: c, croissant: o?.ascending !== false, nullsFirst: !!o?.nullsFirst });
        return api;
      },
      limit: async (n: number) => { limite = n; return exec(); },
      maybeSingle: async () => { const r = exec(); return { data: r.data?.[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => void) => Promise.resolve().then(exec).then(ok),
    };
    return api;
  };

  const rpc = async (nom: string, p: Record<string, unknown>) => {
    if (nom !== 'crediter_credits_mobile_money') throw new Error(`rpc inattendue : ${nom}`);
    if (base.fonctionAbsente) {
      return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
    }
    const ref = String(p.p_reference);
    const user = String(p.p_user_id);
    const montant = Number(p.p_montant);
    if (!ref.startsWith('mm:')) return { data: [{ ok: false, solde: 0, deja_credite: false, motif: 'reference_invalide' }], error: null };
    const titulaire = base.references.get(ref);
    if (titulaire !== undefined) {
      const solde = base.soldes.get(user) ?? 0;
      return titulaire === user
        ? { data: [{ ok: true, solde, deja_credite: true, motif: null }], error: null }
        : { data: [{ ok: false, solde, deja_credite: false, motif: 'reference_autre_compte' }], error: null };
    }
    base.references.set(ref, user);
    const solde = (base.soldes.get(user) ?? 0) + montant;
    base.soldes.set(user, solde);
    return { data: [{ ok: true, solde, deja_credite: false, motif: null }], error: null };
  };

  return { supabaseAdmin: { from, rpc }, supabase: {} };
});

const { confirmerDepot, reconcilier } = await import('@/lib/paiements/pawapay/confirmation');
const { lecteurSimule, poserIssueSimulee, reinitialiserSimulateur } = await import('@/lib/paiements/pawapay/simulateur');

const UTILISATEUR = 'u-1';
const ATTENDU = { montant: 20602, devise: 'XOF' };

function poserDepot(id: string, extra: Partial<LigneDepot> = {}): LigneDepot {
  const d: LigneDepot = {
    deposit_id: id, user_id: UTILISATEUR, offre_type: 'pack', offre_cle: 'medium',
    credits: 200, montant_local: ATTENDU.montant, devise: ATTENDU.devise, pays: 'SEN',
    prix_chf_cents: 2900, taux_eur_par_chf: 1.083, taux_le: '2026-11-11',
    statut: 'en_attente', motif_echec: null, credite_le: null,
    sandbox: true, derniere_verification_le: null,
    created_at: new Date().toISOString(), ...extra,
  };
  base.depots.push(d);
  return d;
}

const lecteur = lecteurSimule((id) => {
  const d = base.depots.find((x) => x.deposit_id === id);
  return d ? { montant: Number(d.montant_local), devise: d.devise } : null;
});

const solde = () => base.soldes.get(UTILISATEUR) ?? 0;
const depot = (id: string) => base.depots.find((d) => d.deposit_id === id)!;

beforeEach(() => {
  base.depots = [];
  base.soldes = new Map([[UTILISATEUR, 100]]);
  base.references = new Map();
  base.fonctionAbsente = false;
  reinitialiserSimulateur();
});

describe('1. Paiement réussi', () => {
  it('crédite exactement les crédits de l’offre, et marque le dépôt', async () => {
    poserDepot('d1');
    poserIssueSimulee('d1', { statut: 'reussi' });

    const r = await confirmerDepot('d1', lecteur);

    expect(r).toEqual({ issue: 'credite', credits: 200, solde: 300 });
    expect(solde()).toBe(300);
    expect(depot('d1').statut).toBe('reussi');
    expect(depot('d1').credite_le).not.toBeNull();
  });
});

describe('2. Paiement échoué, expiré, annulé', () => {
  it('ne crédite rien, et conserve le motif', async () => {
    for (const [id, statut] of [['d2', 'echoue'], ['d3', 'expire'], ['d4', 'annule']] as const) {
      poserDepot(id);
      poserIssueSimulee(id, { statut, motifEchec: 'FONDS_INSUFFISANTS' });
      const r = await confirmerDepot(id, lecteur);
      expect(r, id).toMatchObject({ issue: 'echoue', statut });
      expect(depot(id).statut, id).toBe(statut);
      expect(depot(id).motif_echec, id).toBe('FONDS_INSUFFISANTS');
    }
    expect(solde()).toBe(100);
  });
});

describe('3. Notification reçue deux fois', () => {
  it('⚠️ le second passage ne crédite PAS une seconde fois', async () => {
    poserDepot('d5');
    poserIssueSimulee('d5', { statut: 'reussi' });

    const un = await confirmerDepot('d5', lecteur);
    const deux = await confirmerDepot('d5', lecteur);
    const trois = await confirmerDepot('d5', lecteur);

    expect(un.issue).toBe('credite');
    expect(deux).toEqual({ issue: 'deja_credite', credits: 200 });
    expect(trois).toEqual({ issue: 'deja_credite', credits: 200 });
    expect(solde()).toBe(300);
  });

  it('même en course : deux confirmations simultanées, un seul crédit', async () => {
    poserDepot('d6');
    poserIssueSimulee('d6', { statut: 'reussi' });

    const [a, b] = await Promise.all([
      confirmerDepot('d6', lecteur),
      confirmerDepot('d6', lecteur),
    ]);

    const issues = [a.issue, b.issue].sort();
    expect(issues).toEqual(['credite', 'deja_credite']);
    expect(solde()).toBe(300);
  });
});

describe('4. Montant ou devise incorrects', () => {
  it('un montant inférieur à l’attendu NE crédite pas', async () => {
    poserDepot('d7');
    poserIssueSimulee('d7', { statut: 'reussi', montant: 10000 });

    const r = await confirmerDepot('d7', lecteur);

    expect(r).toMatchObject({ issue: 'refuse', motif: 'montant_insuffisant' });
    expect(solde()).toBe(100);
    expect(depot('d7').statut).toBe('echoue');
  });

  it('une devise différente NE crédite pas', async () => {
    poserDepot('d8');
    poserIssueSimulee('d8', { statut: 'reussi', devise: 'XAF' });

    const r = await confirmerDepot('d8', lecteur);

    expect(r).toMatchObject({ issue: 'refuse', motif: 'devise_differente' });
    expect(solde()).toBe(100);
  });

  it('un montant SUPÉRIEUR est accepté — le payeur n’est pas lésé', async () => {
    poserDepot('d9');
    poserIssueSimulee('d9', { statut: 'reussi', montant: ATTENDU.montant + 5 });
    expect((await confirmerDepot('d9', lecteur)).issue).toBe('credite');
  });
});

describe('5. Confirmation retardée', () => {
  it('reste en attente, puis crédite quand le prestataire confirme', async () => {
    poserDepot('d10');
    poserIssueSimulee('d10', { statut: 'reussi', retard: 2 });

    expect((await confirmerDepot('d10', lecteur)).issue).toBe('en_attente');
    expect((await confirmerDepot('d10', lecteur)).issue).toBe('en_attente');
    expect(solde()).toBe(100);
    expect(depot('d10').statut).toBe('en_attente');

    expect((await confirmerDepot('d10', lecteur)).issue).toBe('credite');
    expect(solde()).toBe(300);
  });
});

describe('6. Retour du navigateur sans paiement', () => {
  it('⚠️ revenir sur le site ne crédite RIEN tant que le prestataire n’a pas confirmé', async () => {
    poserDepot('d11'); // aucune issue posée : le payeur a fermé la page

    const r = await confirmerDepot('d11', lecteur);

    expect(r).toEqual({ issue: 'en_attente' });
    expect(solde()).toBe(100);
    expect(depot('d11').credite_le).toBeNull();
  });
});

describe('7. Rechargement de crédits et 8. souscription', () => {
  it('un pack crédite en « achat », un plan en « abonnement »', async () => {
    poserDepot('d12', { offre_type: 'pack', offre_cle: 'medium', credits: 200 });
    poserDepot('d13', { offre_type: 'plan', offre_cle: 'pro', credits: 600 });
    poserIssueSimulee('d12', { statut: 'reussi' });
    poserIssueSimulee('d13', { statut: 'reussi' });

    expect((await confirmerDepot('d12', lecteur)).issue).toBe('credite');
    expect((await confirmerDepot('d13', lecteur)).issue).toBe('credite');

    expect(solde()).toBe(900);
    // Deux références distinctes : un renouvellement manuel du même plan
    // crédite à nouveau, parce que c'est un AUTRE dépôt.
    expect([...base.references.keys()].sort()).toEqual(['mm:d12', 'mm:d13']);
  });

  it('un renouvellement manuel est un nouveau dépôt, et crédite à nouveau', async () => {
    poserDepot('d14', { offre_type: 'plan', offre_cle: 'pro', credits: 600 });
    poserIssueSimulee('d14', { statut: 'reussi' });
    await confirmerDepot('d14', lecteur);

    poserDepot('d15', { offre_type: 'plan', offre_cle: 'pro', credits: 600 });
    poserIssueSimulee('d15', { statut: 'reussi' });
    await confirmerDepot('d15', lecteur);

    expect(solde()).toBe(1300);
  });
});

describe('9. Réconciliation des paiements en attente', () => {
  it('⚠️ rattrape les dépôts qu’aucune notification n’a confirmés', async () => {
    poserDepot('r1');
    poserDepot('r2');
    poserDepot('r3');
    poserDepot('r4');
    poserIssueSimulee('r1', { statut: 'reussi' });
    poserIssueSimulee('r2', { statut: 'echoue' });
    poserIssueSimulee('r3', { statut: 'reussi', montant: 1 });
    // r4 : toujours sans nouvelle

    const bilan = await reconcilier(base.depots.filter((d) => d.statut === 'en_attente'), lecteur);

    expect(bilan).toEqual({ examines: 4, credites: 1, echoues: 1, encoreEnAttente: 1, refuses: 1, erreurs: 0 });
    expect(solde()).toBe(300);
  });

  it('repassée deux fois, elle ne double aucun crédit', async () => {
    poserDepot('r5');
    poserIssueSimulee('r5', { statut: 'reussi' });

    await reconcilier([depot('r5')], lecteur);
    await reconcilier([depot('r5')], lecteur);

    expect(solde()).toBe(300);
  });

  it('un dépôt en erreur n’empêche pas les autres d’aboutir', async () => {
    poserDepot('r6');
    poserDepot('r7');
    poserIssueSimulee('r7', { statut: 'reussi' });
    const capricieux = async (id: string) => {
      if (id === 'r6') throw new Error('prestataire injoignable');
      return lecteur(id);
    };

    const bilan = await reconcilier([depot('r6'), depot('r7')], capricieux);

    expect(bilan.erreurs).toBe(1);
    expect(bilan.credites).toBe(1);
    expect(solde()).toBe(300);
  });
});

describe('Dépôt qui n’est pas le nôtre', () => {
  it('⚠️ une notification pour une AUTRE application du même compte marchand est ignorée', async () => {
    const r = await confirmerDepot('depot-afroboost', lecteur);
    expect(r).toEqual({ issue: 'depot_inconnu' });
    expect(solde()).toBe(100);
  });
});

describe('Socle absent', () => {
  it('⚠️ sans la fonction SQL, on LÈVE au lieu de créditer sans garantie', async () => {
    base.fonctionAbsente = true;
    poserDepot('d16');
    poserIssueSimulee('d16', { statut: 'reussi' });

    await expect(confirmerDepot('d16', lecteur)).rejects.toThrow(/indisponible/);
    expect(solde()).toBe(100);
    // Le dépôt reste ouvert : la réconciliation le reprendra après migration.
    expect(depot('d16').statut).toBe('en_attente');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE FILET NE DOIT PAS POUVOIR S'ANNULER TOUT SEUL

   La réconciliation est ce qui rend le crédit indépendant de la notification.
   Si on peut la neutraliser, l'argument entier tombe — et elle tombe en
   silence : aucune erreur, aucun journal, seulement des crédits qui
   n'arrivent plus. Trois défenses, trois épreuves.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('Famine de la file de réconciliation', () => {
  it('⚠️ cinquante paiements jamais honorés n’empêchent PAS de relire un paiement récent', async () => {
    const { depotsEnAttente } = await import('@/lib/paiements/pawapay/depots');
    const vieux = new Date(Date.now() - 3 * 3600_000).toISOString();

    // L'attaque : saturer la fenêtre de dépôts plus anciens que tout le reste.
    for (let i = 0; i < 50; i += 1) {
      poserDepot(`squat-${i}`, { created_at: vieux, derniere_verification_le: null });
    }
    poserDepot('vrai-paiement', { created_at: new Date().toISOString() });
    poserIssueSimulee('vrai-paiement', { statut: 'reussi' });

    // Premier passage : la fenêtre est pleine de squatteurs, c'est attendu.
    const passe1 = await depotsEnAttente(50);
    await reconcilier(passe1, lecteur);
    expect(solde()).toBe(100);

    // ⚠️ LE POINT QUI COMPTE : relus, les squatteurs passent en fin de file.
    // Au second passage, le vrai paiement est atteint et crédité.
    const passe2 = await depotsEnAttente(50);
    expect(passe2.map((d) => d.deposit_id)).toContain('vrai-paiement');
    await reconcilier(passe2, lecteur);
    expect(solde()).toBe(300);
  });

  it('un dépôt relu passe derrière ceux qui ne l’ont jamais été', async () => {
    const { depotsEnAttente, marquerVerifie } = await import('@/lib/paiements/pawapay/depots');
    poserDepot('deja-vu', { created_at: new Date(Date.now() - 7200_000).toISOString() });
    poserDepot('jamais-vu', { created_at: new Date().toISOString() });

    await marquerVerifie('deja-vu');
    const file = await depotsEnAttente(10);
    expect(file[0].deposit_id).toBe('jamais-vu');
  });
});

describe('Dépôts abandonnés', () => {
  it('au-delà de vingt-quatre heures, un dépôt en attente sort de la file', async () => {
    const { expirerDepotsAbandonnes, depotsEnAttente } = await import('@/lib/paiements/pawapay/depots');
    poserDepot('abandonne', { created_at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    poserDepot('recent');

    expect(await expirerDepotsAbandonnes()).toBe(1);
    expect(depot('abandonne').statut).toBe('expire');
    expect(depot('abandonne').motif_echec).toBe('sans_reponse');
    expect((await depotsEnAttente(10)).map((d) => d.deposit_id)).toEqual(['recent']);
  });

  it('⚠️ expirer ne PERD pas le paiement : une confirmation tardive crédite quand même', async () => {
    const { expirerDepotsAbandonnes } = await import('@/lib/paiements/pawapay/depots');
    poserDepot('tardif', { created_at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    await expirerDepotsAbandonnes();
    expect(depot('tardif').statut).toBe('expire');

    // Le prestataire finit par confirmer. `confirmerDepot` ne regarde que
    // `credite_le` : le crédit a lieu, l'argent encaissé est honoré.
    poserIssueSimulee('tardif', { statut: 'reussi' });
    const r = await confirmerDepot('tardif', lecteur);
    expect(r).toEqual({ issue: 'credite', credits: 200, solde: 300 });
    expect(depot('tardif').statut).toBe('reussi');
  });
});

describe('Plafond de paiements ouverts par compte', () => {
  it('compte les paiements ouverts du compte, et ignore les abandonnés', async () => {
    const { depotsOuvertsDuCompte } = await import('@/lib/paiements/pawapay/depots');
    poserDepot('o1'); poserDepot('o2');
    poserDepot('vieux', { created_at: new Date(Date.now() - 48 * 3600_000).toISOString() });
    poserDepot('fini', { statut: 'reussi' });
    poserDepot('autrui', { user_id: 'u-2' });

    expect(await depotsOuvertsDuCompte(UTILISATEUR)).toBe(2);
    expect(await depotsOuvertsDuCompte('u-2')).toBe(1);
  });
});
