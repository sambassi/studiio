/**
 * A_0c — UN SEUL WORKER PAR CRÉNEAU.
 *
 * ---------------------------------------------------------------------------
 * LE DÉFAUT QUE CE LOT FERME
 * ---------------------------------------------------------------------------
 *
 * `creneauxExistants()` lit les posts déjà produits et compare en JavaScript.
 * C'est un CONTRÔLE, pas un verrou. Deux crons qui se croisent y lisent tous
 * les deux « créneau libre », puis analysent tous les deux, appellent Sonnet
 * tous les deux, encodent tous les deux, et débitent tous les deux — avant que
 * le premier n'écrive la preuve que l'autre attendait. Le second travail est
 * perdu, et il a coûté deux fournisseurs et un rendu.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT : que la décision soit prise par la BASE, en
 * une instruction, et AVANT la première dépense. Un verrou posé après
 * l'analyse ne verrouille rien — le doublon a déjà payé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

const MIGRATION = lire('migrations/2026-09-07-autopilot-generation-slots.sql');
const CRON = lire('src/app/api/cron/autopilot/route.ts');
const MODULE = lire('src/lib/autopilot/automatique/creneau.ts');

// ── Une base en mémoire qui se comporte comme la vraie ────────────────────
type Ligne = {
  statut: 'en_cours' | 'terminee' | 'echouee';
  jeton: string; bailExpireLe: number; renduId: string | null;
};
const table = new Map<string, Ligne>();
let maintenant = 1_000_000;

/**
 * ⚠️ CE FAUX REPRODUIT L'ATOMICITÉ, PAS SEULEMENT LA FORME.
 *
 * Il applique la MÊME condition que le `on conflict … where` du SQL —
 * « reprendre si échouée OU si le bail a expiré » — et il l'applique
 * SYNCHRONEMENT, sans `await` entre la lecture et l'écriture. C'est ce qui
 * permet à un test de course d'avoir un sens : si le code appelant faisait un
 * `SELECT` puis un `INSERT`, deux réclamations concurrentes passeraient ici
 * exactement comme elles passeraient en production.
 */
const rpc = vi.fn(async (nom: string, p: Record<string, unknown>) => {
  if (nom === 'reclamer_creneau_autopilote') {
    const cle = `${p.p_user_id}|${p.p_slot_key}`;
    const jeton = String(p.p_jeton ?? '');
    if (jeton.length < 16 || Number(p.p_bail_secondes) <= 0) {
      return { data: [{ issue: 'parametres_invalides' }], error: null };
    }
    const a = table.get(cle);
    const reprenable = !a || a.statut === 'echouee'
      || (a.statut === 'en_cours' && a.bailExpireLe < maintenant);
    if (reprenable) {
      table.set(cle, {
        statut: 'en_cours', jeton,
        bailExpireLe: maintenant + Number(p.p_bail_secondes) * 1000,
        renduId: a?.renduId ?? null,
      });
      return { data: [{ issue: 'reclame', jeton, rendu_id: null }], error: null };
    }
    return {
      data: [{
        issue: a.statut === 'terminee' ? 'deja_terminee' : 'deja_tenu',
        jeton: null, rendu_id: a.renduId,
      }],
      error: null,
    };
  }
  if (nom === 'conclure_creneau_autopilote') {
    const cle = `${p.p_user_id}|${p.p_slot_key}`;
    const a = table.get(cle);
    if (!a || a.jeton !== p.p_jeton) {
      return { data: [{ issue: 'jeton_perime' }], error: null };
    }
    table.set(cle, {
      ...a,
      statut: p.p_statut as Ligne['statut'],
      renduId: (p.p_rendu_id as string | null) ?? a.renduId,
    });
    return { data: [{ issue: 'conclu' }], error: null };
  }
  return { data: null, error: { code: 'PGRST202', message: 'not found' } };
});

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...(a as [string, Record<string, unknown>])) },
}));

const {
  reclamerCreneau, conclureCreneau, nouveauJeton,
  BAIL_CRENEAU_SECONDES, ISSUES_CRENEAU,
} = await import('@/lib/autopilot/automatique/creneau');

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { table.clear(); maintenant = 1_000_000; rpc.mockClear(); });
afterEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La réclamation est atomique', () => {
  it('1.1 deux réclamations simultanées : UNE seule gagne', async () => {
    /* ⚠️ LE TEST QUI JUSTIFIE TOUT LE LOT. `Promise.all` lance les deux sans
       aucun point d'attente entre elles : c'est exactement la fenêtre où
       l'ancien contrôle applicatif laissait passer les deux. */
    const [a, b] = await Promise.all([
      reclamerCreneau(U1, 'slot-A', nouveauJeton()),
      reclamerCreneau(U1, 'slot-A', nouveauJeton()),
    ]);
    const issues = [a.issue, b.issue].sort();
    expect(issues).toEqual(['deja_tenu', 'reclame']);
    expect([a.jeton, b.jeton].filter(Boolean)).toHaveLength(1);
  });

  it('1.2 cinq réclamations simultanées : toujours une seule', async () => {
    const r = await Promise.all(Array.from({ length: 5 },
      () => reclamerCreneau(U1, 'slot-A', nouveauJeton())));
    expect(r.filter((x) => x.issue === 'reclame')).toHaveLength(1);
    expect(r.filter((x) => x.issue === 'deja_tenu')).toHaveLength(4);
  });

  it('1.3 la décision se fait en UNE instruction SQL', () => {
    // ⚠️ NI `SELECT` PUIS `INSERT` : entre les deux, un autre worker passe.
    expect(MIGRATION).toContain('on conflict (user_id, slot_key) do update');
    expect(MIGRATION).toContain('where s.statut = \'echouee\'');
    expect(MIGRATION).toContain('s.bail_expire_le < now()');
    // Et l'unicité, qui EST le verrou.
    expect(MIGRATION).toContain('create unique index if not exists autopilot_generation_slots_unique');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Isolation', () => {
  it('2.1 deux utilisateurs différents travaillent en parallèle', async () => {
    const [a, b] = await Promise.all([
      reclamerCreneau(U1, 'slot-A', nouveauJeton()),
      reclamerCreneau(U2, 'slot-A', nouveauJeton()),
    ]);
    expect(a.issue).toBe('reclame');
    expect(b.issue).toBe('reclame');
  });

  it('2.2 deux créneaux du même utilisateur ne se bloquent pas', async () => {
    const a = await reclamerCreneau(U1, `${U1}|2026-09-08|09:00`, nouveauJeton());
    const b = await reclamerCreneau(U1, `${U1}|2026-09-08|18:00`, nouveauJeton());
    expect([a.issue, b.issue]).toEqual(['reclame', 'reclame']);
  });

  it('2.3 le verrou n’est jamais global', () => {
    // Un verrou d'application entier ferait attendre tous les comptes
    // derrière le plus lent.
    expect(MIGRATION).toContain('(user_id, slot_key)');
    expect(sansProse(MIGRATION)).not.toMatch(/pg_advisory_lock\(\s*\d+\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le bail borne les dégâts d’un processus mort', () => {
  it('3.1 un bail encore valide bloque le suivant', async () => {
    await reclamerCreneau(U1, 'slot-A', nouveauJeton());
    maintenant += 60_000;
    expect((await reclamerCreneau(U1, 'slot-A', nouveauJeton())).issue).toBe('deja_tenu');
  });

  it('3.2 un bail expiré rend le créneau reprenable', async () => {
    // Sans bail, un processus tué par un redéploiement — qui n'exécute aucun
    // `finally` — bloquerait ce créneau pour toujours.
    await reclamerCreneau(U1, 'slot-A', nouveauJeton());
    maintenant += (BAIL_CRENEAU_SECONDES + 1) * 1000;
    const repris = await reclamerCreneau(U1, 'slot-A', nouveauJeton());
    expect(repris.issue).toBe('reclame');
  });

  it('3.3 le bail est CALCULÉ à partir des budgets du moteur', () => {
    /* ⚠️ PAS UNE VALEUR CHOISIE. `maxDuration` est inerte sur notre
       hébergement : s'y fier donnerait un chiffre rassurant et faux, et un
       cycle plus long verrait son créneau repris pendant qu'il travaille. */
    expect(MODULE).toContain('BUDGET_EXTRACTION_MS');
    expect(MODULE).toContain('PEREMPTION_RENDU_MS');
    // ⚠️ CE QU'ON INTERDIT EST UNE DURÉE ÉCRITE EN DUR (`= 900_000`), pas un
    // facteur : `2 * (…)` est une marge assumée sur des budgets calculés.
    expect(MODULE).not.toMatch(/BAIL_CRENEAU_MS\s*=\s*[\d_]{4,}\s*;/);
    // Assez long pour couvrir un cycle complet, assez court pour ne pas
    // immobiliser un créneau une demi-journée.
    expect(BAIL_CRENEAU_SECONDES).toBeGreaterThan(600);
    expect(BAIL_CRENEAU_SECONDES).toBeLessThan(7200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le jeton donne seul le droit de conclure', () => {
  it('4.1 le porteur conclut', async () => {
    const j = nouveauJeton();
    await reclamerCreneau(U1, 'slot-A', j);
    expect(await conclureCreneau(U1, 'slot-A', j, 'terminee', { renduId: 'r1' })).toBe(true);
  });

  it('4.2 un jeton étranger ne conclut RIEN', async () => {
    /* ⚠️ LE CAS QUI PERDRAIT UNE VIDÉO : un worker dont le bail a expiré, et
       dont le créneau a été repris, ne doit pas pouvoir marquer « terminée »
       la génération d'un autre. */
    const perime = nouveauJeton();
    await reclamerCreneau(U1, 'slot-A', perime);
    maintenant += (BAIL_CRENEAU_SECONDES + 1) * 1000;
    await reclamerCreneau(U1, 'slot-A', nouveauJeton());
    expect(await conclureCreneau(U1, 'slot-A', perime, 'terminee')).toBe(false);
  });

  it('4.3 le jeton est imprévisible et assez long', () => {
    const jetons = new Set(Array.from({ length: 200 }, () => nouveauJeton()));
    expect(jetons.size).toBe(200);
    expect([...jetons][0].length).toBeGreaterThanOrEqual(16);
    // Ni l'horloge, ni `Math.random` : deux workers pourraient s'annuler.
    expect(MODULE).toContain('randomBytes');
    expect(sansProse(MODULE)).not.toContain('Math.random');
  });

  it('4.4 la base vérifie le jeton dans le `where`, pas dans un `if`', () => {
    expect(MIGRATION).toContain('and jeton = p_jeton');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Terminé reste terminé', () => {
  it('5.1 un créneau conclu n’est jamais repris', async () => {
    const j = nouveauJeton();
    await reclamerCreneau(U1, 'slot-A', j);
    await conclureCreneau(U1, 'slot-A', j, 'terminee', { renduId: 'r1' });
    maintenant += 10 * BAIL_CRENEAU_SECONDES * 1000;
    const apres = await reclamerCreneau(U1, 'slot-A', nouveauJeton());
    expect(apres.issue).toBe('deja_terminee');
    expect(apres.jeton).toBeNull();
  });

  it('5.2 un échec, lui, est reprenable tout de suite', async () => {
    const j = nouveauJeton();
    await reclamerCreneau(U1, 'slot-A', j);
    await conclureCreneau(U1, 'slot-A', j, 'echouee', { motifEchec: 'cycle_interrompu' });
    expect((await reclamerCreneau(U1, 'slot-A', nouveauJeton())).issue).toBe('reclame');
  });

  it('5.3 la trace n’est jamais supprimée', () => {
    // On garde la ligne : savoir qu'un créneau a échoué vaut mieux que de
    // découvrir un trou dans la production sans explication.
    expect(sansProse(MIGRATION)).not.toContain('delete from');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le verrou est pris AVANT la première dépense', () => {
  it('6.1 avant l’aiguillage des moteurs, donc avant analyse et rendu', () => {
    const claim = CRON.indexOf('await reclamerCreneau(userId, jeton, jetonCreneau)');
    const aiguillage = CRON.indexOf("moteurDepuisConfig(config.designStyle) === 'm3'");
    const rendu = CRON.indexOf('renderAndUpload({ userId, jobId, design })');
    const debit = CRON.indexOf("referenceOperation('autopilote', jobId)");
    expect(claim).toBeGreaterThan(-1);
    for (const [nom, i] of [['aiguillage', aiguillage], ['rendu', rendu], ['débit', debit]] as const) {
      expect(i, nom).toBeGreaterThan(claim);
    }
  });

  it('6.2 sans verrou disponible, on ne produit RIEN', () => {
    /* ⚠️ LE REPLI NE DOIT PAS ÊTRE « VAS-Y QUAND MÊME ». Tant que la
       migration n'est pas appliquée, produire réintroduirait le défaut que ce
       lot ferme — en silence, et le jour du déploiement. */
    const bloc = CRON.slice(CRON.indexOf("if (creneau.issue !== 'reclame')"));
    expect(bloc.slice(0, 900)).toContain('continue;');
    expect(MODULE).toContain("return { issue: 'socle_absent', jeton: null, renduId: null };");
  });

  it('6.3 le créneau est rendu quel que soit le chemin de sortie', () => {
    // Un `continue` du milieu — M3 qui ignore, un format inconnu, une
    // exception — laisserait sinon le créneau tenu jusqu'à l'expiration.
    expect(CRON).toContain('} finally {');
    expect(CRON).toContain('if (!creneauConclu) {');
  });

  it('6.4 un créneau déjà tenu n’est pas une erreur', () => {
    const bloc = CRON.slice(CRON.indexOf("if (creneau.issue !== 'reclame')"), 
      CRON.indexOf("if (creneau.issue !== 'reclame')") + 900);
    expect(bloc).toContain('doublons += 1;');
    expect(bloc).not.toContain('echecs += 1;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Ce que le verrou ne change pas', () => {
  it('7.1 A_0 et A_0b sont intacts', () => {
    expect(CRON).toContain('monterAvecM3');
    /* A_7d a elargi l'appel a plusieurs rushes ; le principal reste choisi par
       `choisirRushMontable`, que `choisirRushesMontables` appelle. L'invariant
       — le cron lit la banque canonique — n'a pas bouge. */
    expect(CRON).toContain('choisirRushesMontables');
    expect(lire('src/lib/autopilot/automatique/chaine-serveur.ts'))
      .toContain('executerAnalyseRush');
  });

  it('7.2 les correctifs qualité tiennent', () => {
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
    expect(lire('src/lib/autopilot/analyse/rendu.ts')).toContain('couperSilenceInitialMusique');
    expect(lire('src/components/creer/VideosPretes.tsx')).toContain('data-videos-apercu-rush');
  });

  it('7.3 le gabarit historique est toujours là', () => {
    expect(CRON).toContain('renderAndUpload');
    expect(CRON).toContain('buildAutopilotDesign');
  });

  it('7.4 mode review, aucune publication', () => {
    expect(CRON).toContain('toPostRow(');
    expect(sansProse(MODULE)).not.toContain('publish');
  });

  it('7.5 la migration ne touche à aucune table existante', () => {
    const code = sansProse(MIGRATION).toLowerCase();
    expect(code).not.toContain('alter table public.scheduled_posts');
    expect(code).not.toContain('alter table public.autopilot_config');
    expect(code).not.toContain('drop ');
    // Une seule table créée, et elle est neuve.
    expect((code.match(/create table/g) ?? []).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Le verrou reste invisible du navigateur', () => {
  it('8.1 aucun droit public sur la table ni sur les fonctions', () => {
    expect(MIGRATION).toContain('revoke all on table public.autopilot_generation_slots from public');
    expect(MIGRATION).toContain('revoke all on function\n  public.reclamer_creneau_autopilote');
    expect(MIGRATION).toContain('revoke all on function\n  public.conclure_creneau_autopilote');
    expect(sansProse(MIGRATION).toLowerCase()).not.toContain('grant');
  });

  it('8.2 aucun composant client ne lit ce module', () => {
    expect(MODULE).toContain("from '@/lib/db/supabase'");
    expect(MODULE).not.toContain("'use client'");
  });

  it('8.3 le vocabulaire des issues est fermé', () => {
    expect(ISSUES_CRENEAU).toEqual([
      'reclame', 'deja_tenu', 'deja_terminee', 'indisponible', 'socle_absent',
    ]);
  });
});
