/**
 * LIMITE DE RENDUS — créneau revérifié après l'attente, et cron sans attente.
 *
 * Le bail n'empêche que les rendus SIMULTANÉS : un second passage qui attendait derrière le
 * premier obtient le bail dès sa libération, alors que le post existe. Ces tests prouvent que
 * le créneau est relu bail obtenu, et que le cron ne patiente jamais.
 * Ce que cela NE prouve PAS : l'absence de contrainte d'unicité en base sur `scheduled_posts`
 * (voir le rapport) ; la base ici est simulée en mémoire.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  avecLimiteRendus, verifierCreneauLibre, RenduOccupeError, RenduDoublonError, rendusLocauxActifs,
} from '@/lib/autopilot/limite-rendus';

// Mêmes règles que `rendu_bail_*` (cf. autopilote-limite-rendus.test.ts) : un bail par job, plafond global.
function rpcSimule() {
  const baux = new Map<string, string>();
  const rpc = async (fn: string, p: Record<string, unknown>) => {
    const job = String(p.p_job);
    if (fn === 'rendu_bail_prendre') {
      if (baux.has(job)) return { data: [{ pris: false, motif: 'doublon', actifs: baux.size }], error: null };
      if (baux.size >= Number(p.p_max)) return { data: [{ pris: false, motif: 'occupe', actifs: baux.size }], error: null };
      baux.set(job, String(p.p_user));
      return { data: [{ pris: true, motif: null, actifs: baux.size }], error: null };
    }
    if (fn === 'rendu_bail_liberer') { const ok = baux.get(job) === p.p_user; if (ok) baux.delete(job); return { data: [{ ok }], error: null }; }
    return { data: [{ ok: true }], error: null };
  };
  return { baux, rpc };
}
const env = (max: number) => ({ STUDIIO_RENDUS_MAX_SIMULTANES: String(max), STUDIIO_RENDUS_ATTENTE_MAX_S: '600' });
const vite = () => new Promise<void>((r) => { setTimeout(r, 1); });
const JOB = 'autopilote-u1-2026-10-27-0900';
const JETON = 'u1|2026-10-27|09:00';

describe('créneau revérifié après l’obtention du bail', () => {
  it('verifierCreneauLibre : créneau absent → rien ; présent → doublon « deja_produit »', async () => {
    await expect(verifierCreneauLibre(JOB, JETON, async () => new Set())).resolves.toBeUndefined();
    const err = await verifierCreneauLibre(JOB, JETON, async () => new Set([JETON])).catch((e) => e);
    expect(err).toBeInstanceOf(RenduDoublonError);
    expect(err.raison).toBe('deja_produit');
  });

  it('deux passages simultanés du MÊME créneau : un seul rendu, un seul post — le second attend puis constate', async () => {
    const bd = rpcSimule();
    const posts = new Set<string>();
    let rendus = 0;
    let liberer: (() => void) | undefined;
    const lecture = async () => new Set(posts);
    const passage = (premier: boolean) => avecLimiteRendus('u1', JOB, async () => {
      rendus += 1;
      if (premier) await new Promise<void>((r) => { liberer = r; });
      posts.add(JETON); // le post est inséré AVANT la libération du bail (dans le travail)
    }, { rpc: bd.rpc, env: env(2), dormir: vite, apresBail: () => verifierCreneauLibre(JOB, JETON, lecture) });

    const a = passage(true);
    await vi_waitFor(() => rendus === 1);
    // B arrive pendant le rendu de A : même job → « doublon » immédiat (bail tenu).
    await expect(passage(false)).rejects.toBeInstanceOf(RenduDoublonError);
    liberer!();
    await a;
    // B (nouveau passage) arrive APRÈS la fin de A : le bail est libre, mais le créneau est déjà produit.
    const b = await passage(false).catch((e) => e);
    expect(b).toBeInstanceOf(RenduDoublonError);
    expect((b as RenduDoublonError).raison).toBe('deja_produit');
    expect(rendus).toBe(1);
    expect(posts.size).toBe(1);
    expect(bd.baux.size).toBe(0); // bail libéré malgré le refus
  });

  it('reprise après attente : un passage qui attendait derrière un AUTRE créneau puis trouve le sien déjà produit ne rend rien', async () => {
    const bd = rpcSimule();
    const posts = new Set<string>();
    let liberer: (() => void) | undefined;
    let rendus = 0;
    // Un rendu d'un autre compte tient l'unique place.
    const autre = avecLimiteRendus('u2', 'job-autre', () => new Promise<void>((r) => { liberer = r; }), { rpc: bd.rpc, env: env(1), dormir: vite });
    await vi_waitFor(() => bd.baux.size === 1 && typeof liberer === 'function');
    const attendu = avecLimiteRendus('u1', JOB, async () => { rendus += 1; }, {
      rpc: bd.rpc, env: env(1), dormir: vite, apresBail: () => verifierCreneauLibre(JOB, JETON, async () => new Set(posts)),
    });
    posts.add(JETON); // un autre passage produit le créneau pendant l'attente
    liberer!();
    await autre;
    await expect(attendu).rejects.toBeInstanceOf(RenduDoublonError);
    expect(rendus).toBe(0);
    expect(bd.baux.size).toBe(0);
  });

  it('un échec de la relecture libère le bail et le travail n’a pas lieu', async () => {
    const bd = rpcSimule();
    let rendus = 0;
    await expect(avecLimiteRendus('u1', JOB, async () => { rendus += 1; }, {
      rpc: bd.rpc, env: env(1), dormir: vite, apresBail: async () => { throw new RenduOccupeError(); },
    })).rejects.toBeInstanceOf(RenduOccupeError);
    expect(rendus).toBe(0);
    expect(bd.baux.size).toBe(0);
    expect(rendusLocauxActifs()).toBe(0);
  });
});

describe('cron : aucune attente', () => {
  it('serveur occupé + attenteMaxMs 0 : refus IMMÉDIAT (aucun sommeil, aucun travail), malgré l’attente de 600 s configurée', async () => {
    const bd = rpcSimule();
    let liberer: (() => void) | undefined;
    const tenu = avecLimiteRendus('u2', 'job-manuel', () => new Promise<void>((r) => { liberer = r; }), { rpc: bd.rpc, env: env(1), dormir: vite });
    await vi_waitFor(() => bd.baux.size === 1 && typeof liberer === 'function');
    let dormis = 0;
    let rendus = 0;
    await expect(avecLimiteRendus('u1', JOB, async () => { rendus += 1; }, {
      rpc: bd.rpc, env: env(1), attenteMaxMs: 0, dormir: async () => { dormis += 1; },
    })).rejects.toBeInstanceOf(RenduOccupeError);
    expect(dormis).toBe(0);
    expect(rendus).toBe(0);
    liberer!();
    await tenu;
    // Libre : le même créneau passe au passage suivant du cron.
    expect(await avecLimiteRendus('u1', JOB, async () => 'rendu', { rpc: bd.rpc, env: env(1), attenteMaxMs: 0 })).toBe('rendu');
  });

  it('sans attenteMaxMs imposé, la production manuelle garde l’attente de la variable', async () => {
    const bd = rpcSimule();
    let liberer: (() => void) | undefined;
    const tenu = avecLimiteRendus('u2', 'job-x', () => new Promise<void>((r) => { liberer = r; }), { rpc: bd.rpc, env: env(1), dormir: vite });
    await vi_waitFor(() => bd.baux.size === 1 && typeof liberer === 'function');
    const manuel = avecLimiteRendus('u1', JOB, async () => 'ok', { rpc: bd.rpc, env: env(1), dormir: vite });
    liberer!();
    await tenu;
    expect(await manuel).toBe('ok');
  });
});

describe('câblage', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('le wrapper relit les créneaux APRÈS le bail et accepte « sansAttente »', () => {
    const p = src('src/lib/autopilot/produire.ts');
    expect(p).toContain('apresBail: () => verifierCreneauLibre(input.jobId, jeton, () => creneauxExistants(input.userId))');
    expect(p).toContain('...(options.sansAttente ? { attenteMaxMs: 0 } : null)');
    expect(p).toContain('input.slotKey ?? slotKey(input.userId, input.post.scheduledDate, input.post.scheduledTime)');
  });
  it('le cron rend sans attente ; le finaliseur aussi (sauf production manuelle, détachée)', () => {
    expect(src('src/app/api/cron/autopilot/route.ts')).toContain('}, { sansAttente: true });');
    const j = src('src/lib/autopilot/jumeau-async.ts');
    expect(j).toContain('{ sansAttente: !manuel }');
    expect(j).toContain("{ sansAttente: !ligne.job_id.startsWith('autopilote-manuel-') }");
  });
  it('la production manuelle n’impose aucune limite d’attente', () => {
    expect(src('src/app/api/autopilot/produire-maintenant/route.ts')).not.toContain('sansAttente');
  });
});

async function vi_waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i += 1) { if (cond()) return; await vite(); }
  throw new Error('condition jamais atteinte');
}
