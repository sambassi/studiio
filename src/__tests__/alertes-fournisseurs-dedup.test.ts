/**
 * UNE alerte par fournisseur + type — prod 2026-10-13 : le cron
 * providers-health (toutes les 15 min) recréait « HeyGen : solde fournisseur
 * faible » dès que l'admin l'avait masquée, puis chaque heure (13 alertes en
 * 1 h 30), et aucune ne se fermait quand le solde remontait.
 *
 * Le VRAI module santé et le VRAI stockage des alertes, sur une base en
 * mémoire ; seul le solde (fetch) et l'email sont des doublures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fausseBase } from './helpers/fausse-base';

const emails: string[] = [];
vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/email/resend', () => ({ sendEmailSilent: (m: { subject: string }) => { emails.push(m.subject); } }));

import { majEtatDepuisSolde } from '@/lib/fournisseurs/sante';
import { getAllAlerts, getActiveAlerts, dismissServiceAlert } from '@/lib/service-alerts';

const env = { HEYGEN_API_KEY: 'h' } as unknown as NodeJS.ProcessEnv;
let solde = 14.3;
let auto = true;
const fetchSolde = (async () => new Response(JSON.stringify({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: solde, auto_reload: { enabled: auto, threshold_usd: 10, amount_usd: 15 } } } }), { status: 200 })) as unknown as typeof fetch;
let horloge = Date.parse('2026-10-13T09:00:00Z');
/** Un passage du cron providers-health, 15 minutes après le précédent. */
const passage = async () => { horloge += 15 * 60_000; await majEtatDepuisSolde('heygen', { env, fetch: fetchSolde, now: () => horloge }); };
const heygen = async () => (await getAllAlerts()).filter((a) => a.service === 'heygen' && a.cle === 'solde_faible');
/** Ce que montre le bandeau admin : les alertes actives warning/critical (les INFO n'y figurent pas). */
const bandeau = async () => (await getActiveAlerts()).filter((a) => a.severity !== 'info');

beforeEach(() => { fausseBase.vider(); emails.length = 0; solde = 14.3; auto = true; horloge = Date.parse('2026-10-13T09:00:00Z'); });

describe('solde faible : une seule alerte, quel que soit le nombre de passages', () => {
  it('4 passages → 1 alerte, mise à jour (occurrences, dernier constat), jamais dupliquée', async () => {
    for (let i = 0; i < 4; i += 1) await passage();
    const a = await heygen();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ severity: 'warning', message: 'HeyGen : solde fournisseur faible.', occurrences: 4, dismissed: false });
    expect(Date.parse(a[0].lastSeenAt!)).toBeGreaterThanOrEqual(Date.parse(a[0].timestamp));
    expect((await bandeau()).length).toBe(1);
  });

  it('masquée par l’admin : le masquage est respecté tant que le problème dure — pas de nouvelle alerte', async () => {
    await passage();
    await dismissServiceAlert((await heygen())[0].id);
    for (let i = 0; i < 3; i += 1) await passage();
    expect(await heygen()).toHaveLength(1);
    expect(await bandeau()).toHaveLength(0);
  });

  it('le solde remonte → résolue (quitte le bandeau) ; il retombe → la MÊME alerte est réouverte', async () => {
    await passage();
    solde = 40; // au-dessus du seuil bas par défaut (30 $)
    await passage();
    expect((await heygen())[0].resolvedAt).toBeTruthy();
    expect(await bandeau()).toHaveLength(0);
    solde = 12;
    await passage();
    const a = await heygen();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ dismissed: false, occurrences: 1 });
    expect(a[0].resolvedAt).toBeUndefined();
    expect(await bandeau()).toHaveLength(1);
  });

  it('les doublons historiques (sans type, même message) sont clos au premier passage', async () => {
    fausseBase.table('app_settings').push({ key: 'service_alerts', value: JSON.stringify([
      { id: 'old-1', service: 'heygen', severity: 'warning', message: 'HeyGen : solde fournisseur faible.', timestamp: '2026-10-13T08:00:00Z', dismissed: false },
      { id: 'old-2', service: 'heygen', severity: 'warning', message: 'HeyGen : solde fournisseur faible.', timestamp: '2026-10-13T07:00:00Z', dismissed: false },
    ]) });
    await passage();
    expect((await bandeau()).map((a) => a.id)).toEqual([(await heygen())[0].id]);
  });
});

describe('critique : email à l’OUVERTURE seulement', () => {
  it('auto-reload coupé, 4 passages → 1 alerte critique, 1 seul email', async () => {
    auto = false;
    solde = 3;
    for (let i = 0; i < 4; i += 1) await passage();
    const critiques = (await getAllAlerts()).filter((a) => a.cle === 'recharge_impossible');
    expect(critiques).toHaveLength(1);
    expect(emails.filter((e) => e.includes('recharge automatique impossible'))).toHaveLength(1);
  });
});
