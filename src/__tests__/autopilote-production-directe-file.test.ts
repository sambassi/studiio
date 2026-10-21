/**
 * #613 — la ligne-verrou d'une production SANS avatar vit dans
 * `autopilot_jumeau_attente` (table existante, aucune migration). Ce fichier
 * verrouille qu'AUCUN lecteur de la file jumeau ne la voit : finaliseur (cron),
 * reprise des lignes abandonnées, créneaux du cron, garde avatar, suivi jumeau.
 * Le VRAI module `jumeau-async`, sur une base en mémoire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fausseBase as base } from './helpers/fausse-base';

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
const avancerStatutGeneration = vi.fn();
vi.mock('@/lib/avatar/statut', () => ({ avancerStatutGeneration: (...a: unknown[]) => avancerStatutGeneration(...a) }));
const produireUnMontage = vi.fn();
vi.mock('@/lib/autopilot/produire', async (orig) => ({ ...(await orig<object>()), produireUnMontage: (...a: unknown[]) => produireUnMontage(...a) }));

import { finaliserJumeauxPrets, creneauxJumeauEnAttente } from '@/lib/autopilot/jumeau-async';
import {
  reserverProductionDirecte, terminerProductionDirecte, jumeauEnPreparation, suiviProductionJumeau,
  lireProductionDirecte, estOrpheline, _reinitialiserDirect, DELAI_ORPHELINE_MS,
} from '@/lib/autopilot/suivi-jumeau-manuel';

const U = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const JOB = `autopilote-manuel-${U}-2026-10-20-1410`;

beforeEach(() => { base.vider(); _reinitialiserDirect(); avancerStatutGeneration.mockReset(); produireUnMontage.mockReset(); });

describe('Le cron et le finaliseur ignorent les lignes sans avatar', () => {
  it.each(['direct_en_cours', 'direct_rendu', 'direct_echec'])('ligne %s : rien n est examiné, repris, ni rendu', async (statut) => {
    expect(await reserverProductionDirecte(U, { jobId: JOB, date: '2026-10-20', time: '14:10' })).toEqual({ ok: true });
    const l = base.table('autopilot_jumeau_attente')[0];
    l.statut = statut;
    // Vieille : la reprise des lignes `en_cours` abandonnées ne doit pas la toucher non plus.
    l.updated_at = '2026-01-01T00:00:00.000Z';
    l.created_at = new Date().toISOString();
    const r = await finaliserJumeauxPrets({});
    expect(r.examines).toBe(0);
    expect(avancerStatutGeneration).not.toHaveBeenCalled();
    expect(produireUnMontage).not.toHaveBeenCalled();
    expect(base.table('autopilot_jumeau_attente')[0].statut).toBe(statut);
    expect((await creneauxJumeauEnAttente(U)).size).toBe(0);
    expect(await jumeauEnPreparation(U)).toBe(false);
    expect(await suiviProductionJumeau(U)).toBeNull();
  });
});

describe('Le verrou tranché par la base', () => {
  it('deux réservations concurrentes : une seule gagne', async () => {
    const [a, b] = await Promise.all([
      reserverProductionDirecte(U, { jobId: JOB, date: '2026-10-20', time: '14:10' }),
      reserverProductionDirecte(U, { jobId: `${JOB}x`, date: '2026-10-20', time: '14:15' }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(base.table('autopilot_jumeau_attente')).toHaveLength(1);
  });

  it('après la fin, la ligne est reprise (une seule ligne par compte, jamais d accumulation)', async () => {
    await reserverProductionDirecte(U, { jobId: JOB, date: '2026-10-20', time: '14:10' });
    expect(await terminerProductionDirecte(U, JOB, { ok: false, message: 'Production impossible. Rien n’a été débité.' })).toBe(true);
    expect(await lireProductionDirecte(U)).toMatchObject({ etat: 'echec', message: expect.stringContaining('Rien') });
    expect(await reserverProductionDirecte(U, { jobId: `${JOB}b`, date: '2026-10-20', time: '14:15' })).toEqual({ ok: true });
    expect(base.table('autopilot_jumeau_attente')).toHaveLength(1);
  });

  it('une fin écrite par un rendu PÉRIMÉ (autre jobId) n écrase pas la production suivante', async () => {
    await reserverProductionDirecte(U, { jobId: `${JOB}b`, date: '2026-10-20', time: '14:15' });
    await terminerProductionDirecte(U, JOB, { ok: true, postId: 'post-ancien' });
    expect(base.table('autopilot_jumeau_attente')[0]).toMatchObject({ statut: 'direct_en_cours', job_id: `${JOB}b` });
  });

  it('orpheline : silence > 30 min, ou autre instance silencieuse > 3 min ; jamais une ligne vivante', () => {
    const t0 = Date.parse('2026-10-20T12:00:00Z');
    const l = (min: number, instance: string) => ({ statut: 'direct_en_cours', updated_at: new Date(t0 - min * 60_000).toISOString(), snapshot: { instance } });
    expect(estOrpheline(l(1, 'autre'), t0, 'moi')).toBe(false);
    expect(estOrpheline(l(4, 'autre'), t0, 'moi')).toBe(true);
    expect(estOrpheline(l(29, 'moi'), t0, 'moi')).toBe(false);
    expect(estOrpheline(l(DELAI_ORPHELINE_MS / 60_000 + 1, 'moi'), t0, 'moi')).toBe(true);
    expect(estOrpheline({ ...l(60, 'autre'), statut: 'direct_rendu' }, t0, 'moi')).toBe(false);
  });
});

describe('Écritures du suivi : best-effort, jamais une promesse rejetée', () => {
  it('une exception du client de base pendant la fin → false, journalisée, sans rejet', async () => {
    expect(await reserverProductionDirecte(U, { jobId: JOB, date: '2026-10-20', time: '14:10' })).toEqual({ ok: true });
    const espion = vi.spyOn(base.supabaseAdmin, 'from').mockImplementationOnce(() => { throw new Error('client sans update'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(terminerProductionDirecte(U, JOB, { ok: true, postId: 'p1' })).resolves.toBe(false);
    expect(err).toHaveBeenCalledWith('[Autopilote/Manuel] état non écrit :', U, JOB, 'client sans update');
    espion.mockRestore(); err.mockRestore();
  });
});
