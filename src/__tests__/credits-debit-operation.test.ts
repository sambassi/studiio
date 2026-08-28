/**
 * Le débit hors rendu, côté serveur — contrat et non-régression.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST CORRIGÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `deductCredits` faisait `SELECT` → comparaison en JavaScript → `UPDATE`
 * avec une valeur ABSOLUE → `INSERT` séparé. Quatre parcours en dépendent :
 * IA image, avatar, cron autopilote, ajustement admin.
 *
 * Deux appels concurrents lisaient le même solde et écrivaient la même
 * valeur : un débit disparaissait. Le journal pouvait manquer alors que le
 * solde avait bougé. Et rien n'écrivait `reference_id`, donc un rejeu
 * débitait une seconde fois.
 *
 * L'atomicité elle-même se prouve sur un vrai moteur — `tests-pg/
 * debit-operation.pg.test.ts`. Ici on vérifie le CONTRAT : ce qui est
 * envoyé au SQL, ce qui ne l'est jamais, et ce qui n'a pas bougé.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  referenceOperation, referenceRendu, TYPES_TRANSACTION,
} from '@/lib/credits/atomique';

const rpcAppels: Array<{ nom: string; args: Record<string, unknown> }> = [];
const tablesEcrites: string[] = [];
let ligneUser: Record<string, unknown> | null = null;
let reponseRpc: unknown = null;

function requete(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    single: async () => ({ data: ligneUser, error: null }),
    maybeSingle: async () => ({ data: ligneUser, error: null }),
    update: () => { tablesEcrites.push(`update:${table}`); return api; },
    insert: () => { tablesEcrites.push(`insert:${table}`); return api; },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    rpc: async (nom: string, args: Record<string, unknown>) => {
      rpcAppels.push({ nom, args });
      return { data: reponseRpc, error: null };
    },
  },
  supabase: { from: (t: string) => requete(t) },
}));

const { deductCredits } = await import('@/lib/credits/system');

beforeEach(() => {
  rpcAppels.length = 0;
  tablesEcrites.length = 0;
  ligneUser = { id: 'moi', email: 'quelquun@exemple.fr', credits: 100 };
  reponseRpc = [{ ok: true, solde: 60, deja_debite: false, motif: null }];
});

// ────────────────────────────────────────────────────────────────────────────
// Le lire-modifier-écrire a disparu
// ────────────────────────────────────────────────────────────────────────────

describe('Le débit passe par une seule instruction SQL', () => {
  it('il appelle `debiter_credits_operation`, et rien d autre', async () => {
    await deductCredits('moi', 40, 'avatar');
    expect(rpcAppels).toHaveLength(1);
    expect(rpcAppels[0].nom).toBe('debiter_credits_operation');
  });

  it('il n écrit plus jamais `users.credits` ni le journal en direct', async () => {
    await deductCredits('moi', 40, 'avatar');
    // C'était le défaut : deux écritures séparées, hors transaction.
    expect(tablesEcrites).toEqual([]);
  });

  it('aucune valeur absolue de solde ne part vers la base', async () => {
    // ─────────────────────────────────────────────────────────────────────
    // CETTE ASSERTION ÉTAIT INSTABLE, ET C'ÉTAIT MA FAUTE
    //
    // Elle cherchait `'100'` et `'60'` comme SOUS-CHAÎNES du JSON des
    // arguments. Or ces arguments portent une référence jetable bâtie sur un
    // UUID aléatoire : le jour où il contenait `06600f4fb0f2`, le test
    // tombait. Environ deux exécutions sur quinze.
    //
    // Une recherche textuelle sur un document qui contient de l'aléatoire ne
    // peut pas être stable. Ce qu'on veut vérifier n'est d'ailleurs pas
    // « ces caractères n'apparaissent nulle part » mais « aucun ARGUMENT ne
    // transporte un solde ». On le vérifie donc argument par argument.
    // ─────────────────────────────────────────────────────────────────────
    await deductCredits('moi', 40, 'avatar');
    const args = rpcAppels[0].args;

    // 1. La liste des arguments est FERMÉE : aucun champ supplémentaire ne
    //    pourrait glisser un solde à côté.
    expect(Object.keys(args).sort()).toEqual(
      ['p_description', 'p_montant', 'p_reference', 'p_type', 'p_user_id'],
    );

    // 2. Le seul argument numérique est le montant, et il vaut le montant.
    const numeriques = Object.entries(args).filter(([, v]) => typeof v === 'number');
    expect(numeriques).toEqual([['p_montant', 40]]);

    // 3. Ni le solde lu (100) ni le solde calculé (60) n'est transmis, en
    //    valeur — la base décrémente elle-même.
    for (const valeur of Object.values(args)) {
      expect(valeur).not.toBe(100);
      expect(valeur).not.toBe(60);
      expect(valeur).not.toBe('100');
      expect(valeur).not.toBe('60');
    }
  });

  it('une référence contenant « 60 » ne fait plus échouer la garantie', async () => {
    // Le cas déterministe qui reproduisait l'instabilité : la référence
    // contient légitimement les caractères que l'ancienne assertion
    // cherchait. Elle n'est pas un solde, et rien ne doit s'en émouvoir.
    await deductCredits('moi', 40, 'avatar', 'avatar:v60-lot100');
    const args = rpcAppels[0].args;
    expect(args.p_reference).toBe('avatar:v60-lot100');
    expect(JSON.stringify(args)).toContain('60');
    // Et la garantie tient toujours : aucun argument n'est un solde.
    const numeriques = Object.entries(args).filter(([, v]) => typeof v === 'number');
    expect(numeriques).toEqual([['p_montant', 40]]);
    for (const valeur of Object.values(args)) {
      expect(valeur).not.toBe(100);
      expect(valeur).not.toBe(60);
    }
  });

  it('le code source ne contient plus de décrément calculé en JavaScript', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/credits/system.ts'), 'utf-8');
    const corps = src.slice(src.indexOf('export async function deductCredits'));
    const fin = corps.indexOf('export async function addCredits');
    const zone = corps.slice(0, fin > 0 ? fin : undefined);
    expect(zone).not.toContain('currentCredits - amount');
    expect(zone).not.toMatch(/\.update\(\s*\{\s*credits:/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Ce que le SQL reçoit, et ce qu'il ne reçoit jamais
// ────────────────────────────────────────────────────────────────────────────

describe('L identité et le type viennent du serveur', () => {
  it('`user_id` est celui passé par l appelant serveur, jamais un corps HTTP', async () => {
    await deductCredits('moi', 40, 'avatar');
    expect(rpcAppels[0].args.p_user_id).toBe('moi');
  });

  it('le `type` reste une valeur du CHECK de la colonne', async () => {
    await deductCredits('moi', 40, 'avatar');
    expect(rpcAppels[0].args.p_type).toBe('render');
    expect(TYPES_TRANSACTION).toContain(rpcAppels[0].args.p_type as never);
  });

  it('la raison de l appel est enregistrée — elle était jetée', async () => {
    // `_reason` était préfixé d'un underscore : le paramètre existait et
    // n'était utilisé nulle part. Toutes les lignes disaient « render ».
    await deductCredits('moi', 40, 'avatar');
    expect(rpcAppels[0].args.p_description).toBe('avatar');
  });
});

describe('Idempotence : la référence', () => {
  it('une référence fournie part telle quelle', async () => {
    await deductCredits('moi', 10, 'render', 'autopilote:job-7');
    expect(rpcAppels[0].args.p_reference).toBe('autopilote:job-7');
  });

  it('sans référence, une clé jetable est fabriquée — jamais vide', async () => {
    await deductCredits('moi', 10, 'ia:ocr');
    const ref = String(rpcAppels[0].args.p_reference);
    expect(ref.length).toBeGreaterThan(0);
    expect(ref.startsWith('op:ia:ocr:')).toBe(true);
  });

  it('deux appels sans référence en produisent DEUX différentes', async () => {
    // C'est le comportement d'aujourd'hui, conservé : une retouche d'image
    // n'a pas de sujet stable, et fabriquer une fausse clé stable ferait
    // disparaître la seconde retouche.
    await deductCredits('moi', 10, 'ia:ocr');
    await deductCredits('moi', 10, 'ia:ocr');
    expect(rpcAppels[0].args.p_reference).not.toBe(rpcAppels[1].args.p_reference);
  });

  it('`referenceOperation` lie l opération à un sujet du serveur', () => {
    expect(referenceOperation('autopilote', 'job-7')).toBe('autopilote:job-7');
    expect(referenceOperation('avatar', 'v1')).toBe('avatar:v1');
  });

  it('sans sujet stable, elle rend `null` au lieu d inventer une clé', () => {
    for (const [op, sujet] of [['autopilote', null], ['autopilote', ''], ['', 'x'], ['  ', ' ']] as const) {
      expect(referenceOperation(op as string, sujet as string | null)).toBeNull();
    }
  });

  it('les deux espaces de références ne se marchent pas dessus', () => {
    // `rendu:<postId>` est celui du socle de rendu. Un préfixe partagé ferait
    // qu'un montage payé annulerait le débit d'une autre opération.
    expect(referenceRendu('p1')).toBe('rendu:p1');
    expect(referenceOperation('autopilote', 'p1')).not.toBe(referenceRendu('p1'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Les refus
// ────────────────────────────────────────────────────────────────────────────

describe('Les refus remontent, ils ne passent pas en silence', () => {
  it('solde insuffisant garde son message exact', async () => {
    // Des appelants lisent ce message : `avatar/generate` rembourse dessus.
    reponseRpc = [{ ok: false, solde: 5, deja_debite: false, motif: 'solde_insuffisant' }];
    await expect(deductCredits('moi', 40, 'avatar')).rejects.toThrow('Insufficient credits');
  });

  it('un autre refus est dit avec son motif', async () => {
    reponseRpc = [{ ok: false, solde: 0, deja_debite: false, motif: 'montant_invalide' }];
    await expect(deductCredits('moi', -1, 'avatar')).rejects.toThrow(/montant_invalide/);
  });

  it('la migration absente ne débite pas en silence', async () => {
    reponseRpc = [{ ok: false, solde: 0, deja_debite: false, motif: 'socle_absent' }];
    await expect(deductCredits('moi', 40, 'avatar')).rejects.toThrow(/socle_absent/);
  });

  it('un rejeu rend `true` sans rien retirer', async () => {
    reponseRpc = [{ ok: true, solde: 60, deja_debite: true, motif: null }];
    await expect(deductCredits('moi', 40, 'avatar', 'avatar:v1')).resolves.toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Ce qui ne devait PAS changer
// ────────────────────────────────────────────────────────────────────────────

describe('Les comptes gardent exactement leur comportement', () => {
  it('administrateur : aucun débit, aucun appel SQL', async () => {
    ligneUser = { id: 'moi', email: 'contact.artboost@gmail.com', credits: 100 };
    await expect(deductCredits('moi', 40, 'avatar')).resolves.toBe(true);
    expect(rpcAppels).toEqual([]);
    expect(tablesEcrites).toEqual([]);
  });

  it('utilisateur normal : le débit part', async () => {
    ligneUser = { id: 'moi', email: 'quelquun@exemple.fr', credits: 100 };
    await deductCredits('moi', 40, 'avatar');
    expect(rpcAppels).toHaveLength(1);
  });

  it("l'exemption reste celle par e-mail, distincte de la politique par rôle", () => {
    // Les deux mécanismes coexistent depuis la facturation différenciée : le
    // rôle en base gouverne les RENDUS, la liste d'e-mails gouverne ces
    // quatre parcours-ci. Les fusionner changerait ce que paient des comptes
    // réels — ce n'est pas ce lot.
    const src = readFileSync(join(process.cwd(), 'src/lib/credits/system.ts'), 'utf-8');
    expect(src).toContain("import { isAdmin } from '@/lib/admin'");
    expect(src).toContain('if (u?.email && isAdmin(u.email)) return true;');
  });
});

describe('Rien d autre n a bougé', () => {
  it('le mode Série reste plafonné à deux', async () => {
    const { BATCH_SERIE_DISPONIBLE, BATCH_SERIE_MAX, batchCountAutorise } =
      await import('@/lib/creer/batchDisponible');
    expect(BATCH_SERIE_DISPONIBLE).toBe(true);
    expect(BATCH_SERIE_MAX).toBe(2);
    expect(batchCountAutorise(10)).toBe(2);
  });

  it('/api/render/batch reste désactivée', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it('la reprise après échec reste fermée', async () => {
    const { repriseAutorisee } = await import('@/lib/creer/batchRun');
    expect(repriseAutorisee([]).autorisee).toBe(false);
  });

  it('la migration n ajoute ni table, ni colonne, ni index', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-08-30-debit-operation.sql'), 'utf-8',
    );
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/create\s+table/i);
    expect(code).not.toMatch(/add\s+column/i);
    expect(code).not.toMatch(/create\s+(unique\s+)?index/i);
    expect(code).not.toMatch(/drop\s+/i);
    // Une seule chose créée : la fonction.
    expect((code.match(/create or replace function/gi) || [])).toHaveLength(1);
  });

  it('aucun tarif n est dupliqué : `tarifs_rendu` reste la table du rendu', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-08-30-debit-operation.sql'), 'utf-8',
    );
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toContain('tarifs_rendu');
  });
});
