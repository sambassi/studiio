/**
 * CINEMA IA — UN REMBOURSEMENT NE PEUT PAS ÊTRE ÉCRIT DEUX FOIS, sur un VRAI PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN VRAI MOTEUR
 * ─────────────────────────────────────────────────────────────────────────
 * `rembourserUneFois` (`lib/cinema/generation/credits.ts`) ne se fie PAS à une lecture
 * préalable pour savoir si un remboursement a déjà eu lieu : une lecture peut arriver trop
 * tard, et deux requêtes simultanées la passeraient toutes les deux. Elle écrit la ligne de
 * remboursement avec sa propre référence (`<débit>:remboursement`) et laisse l'index unique
 * partiel `credit_transactions_reference_unique (user_id, reference_id)` refuser le double.
 *
 * C'est donc l'INDEX qui tient la garantie. Un client simulé rejouerait ce qu'on lui
 * programme : seul le moteur peut le prouver. Les courses ci-dessous partent de connexions
 * distinctes, relâchées par une barrière.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';
import { connecter, preparerBase, creerUtilisateur, enConcurrence, urlBase } from './harness';
import { referenceRemboursement, PREFIXE_REFERENCE } from '@/lib/cinema/generation/credits';

let client: Client;
const REF_DEBIT = `${PREFIXE_REFERENCE}:00000000-0000-4000-8000-000000000abc`;

/** Écrit une ligne de remboursement, comme le fait `rembourserUneFois`. */
async function ecrireRemboursement(c: Client, userId: string, montant: number): Promise<'ok' | string> {
  try {
    await c.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id, description)
       values ($1, $2, 'refund', $3, 'Cinema IA — test')`,
      [userId, montant, referenceRemboursement(REF_DEBIT)],
    );
    return 'ok';
  } catch (e) {
    return String((e as { code?: unknown }).code ?? 'erreur');
  }
}
const nbRemboursements = async (userId: string) => Number((await client.query(
  'select count(*) from public.credit_transactions where user_id = $1 and reference_id = $2',
  [userId, referenceRemboursement(REF_DEBIT)],
)).rows[0].count);

beforeAll(async () => { urlBase(); client = await connecter(); });
beforeEach(async () => { await preparerBase(client); });
afterAll(async () => { if (client) await client.end(); });

describe('la référence de remboursement est dérivée du débit, et unique', () => {
  it('elle ne se confond jamais avec celle du débit', () => {
    expect(referenceRemboursement(REF_DEBIT)).toBe(`${REF_DEBIT}:remboursement`);
    expect(referenceRemboursement(REF_DEBIT)).not.toBe(REF_DEBIT);
  });

  it('un débit et son remboursement coexistent : deux lignes, deux références', async () => {
    const u = await creerUtilisateur(client, 100);
    await client.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, 15, 'render', $2)`,
      [u, REF_DEBIT],
    );
    expect(await ecrireRemboursement(client, u, 15)).toBe('ok');
    const lignes = (await client.query(
      'select type, reference_id from public.credit_transactions where user_id = $1 order by reference_id',
      [u],
    )).rows;
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l.type)).toEqual(['render', 'refund']);
  });

  it('un SECOND remboursement est refusé par la base (23505), pas par une lecture', async () => {
    const u = await creerUtilisateur(client, 100);
    expect(await ecrireRemboursement(client, u, 15)).toBe('ok');
    expect(await ecrireRemboursement(client, u, 15)).toBe('23505');
    expect(await nbRemboursements(u)).toBe(1);
  });

  it('DIX remboursements SIMULTANÉS : un seul passe, les neuf autres sont refusés', async () => {
    const u = await creerUtilisateur(client, 100);
    const issues = await enConcurrence(10, async (c) => ecrireRemboursement(c, u, 15));
    const valeurs = issues.map((i) => (i.ok ? i.valeur : 'course'));
    expect(valeurs.filter((v) => v === 'ok')).toHaveLength(1);
    expect(valeurs.filter((v) => v === '23505')).toHaveLength(9);
    expect(await nbRemboursements(u)).toBe(1);
  });

  it('deux comptes différents remboursent chacun le leur : l’index porte le compte', async () => {
    const a = await creerUtilisateur(client, 100);
    const b = await creerUtilisateur(client, 100);
    expect(await ecrireRemboursement(client, a, 15)).toBe('ok');
    expect(await ecrireRemboursement(client, b, 15)).toBe('ok');
    expect(await nbRemboursements(a)).toBe(1);
    expect(await nbRemboursements(b)).toBe(1);
  });

  it('une autre tentative de génération a sa propre référence : son remboursement passe', async () => {
    const u = await creerUtilisateur(client, 100);
    expect(await ecrireRemboursement(client, u, 15)).toBe('ok');
    const autre = `${PREFIXE_REFERENCE}:00000000-0000-4000-8000-000000000def`;
    await client.query(
      `insert into public.credit_transactions (user_id, amount, type, reference_id)
       values ($1, 5, 'refund', $2)`,
      [u, referenceRemboursement(autre)],
    );
    expect(Number((await client.query(
      "select count(*) from public.credit_transactions where user_id = $1 and type = 'refund'", [u],
    )).rows[0].count)).toBe(2);
  });
});
