/**
 * Autopilote SANS avatar — production interrompue (redémarrage serveur) et
 * double lancement. Réponses simulées EXACTES, reprises du code réel :
 *
 *  - POST /api/autopilot/produire-maintenant (route.ts) : 202
 *    `{ success, enCours, jobId: 'autopilote-manuel-<user>-<date>-<HHMM>', scheduledDate, scheduledTime, timezone, title }`,
 *    puis 409 `{ success:false, error:'Une production est déjà en cours. Patientez.', code:'en-cours', scheduledDate, scheduledTime }`
 *    (verrou persistant `productionDirecteEnCours`).
 *  - GET …/progression (progression/route.ts) :
 *    · « en cours » relu de la base (`lireProductionDirecte` → `en_cours`) :
 *      `{ success, progression:{pourcent, etape, libelle, majA, avancement}, resultat:null, jumeau:null, manuel:null, production:{date,time} }` ;
 *    · « interrompue » (ligne orpheline close, `cloreOrpheline`) pour le créneau SUIVI (`?date=&time=`) :
 *      `resultat: { success:false, error: MESSAGE_DIRECTE_INTERROMPUE, code:'interrompue' }` ;
 *      sans créneau suivi ou autre créneau : rien (`progression/resultat/jumeau/manuel` à null).
 *
 * Ce scénario DOIT PASSER sur le code actuel (aucun `attenduAvantCorrection`).
 */
import type { Page } from 'playwright/test';
import { test, expect, choisirParcours, USER_ID } from './fixtures';

/** `MESSAGE_DIRECTE_INTERROMPUE` (src/lib/autopilot/suivi-jumeau-manuel.ts), à l'identique. */
const MESSAGE_DIRECTE_INTERROMPUE =
  'Production interrompue : le serveur a redémarré pendant le rendu. Aucun crédit n’est débité tant qu’aucun brouillon n’est déposé dans le Calendrier. Relancez la production.';
const MESSAGE_EN_COURS = 'Une production est déjà en cours. Patientez.';
const CLE_SUIVI = 'studiio:autopilote:production-suivie';

const DATE = new Date().toISOString().slice(0, 10);
const HEURE = '18:00';
const JOB = `autopilote-manuel-${USER_ID}-${DATE}-${HEURE.replace(':', '')}`;

type Phase = 'repos' | 'en-cours' | 'interrompue';

/** Ouvre l'Autopilote (Motivation), sources = médias suggérés SEULS (sans avatar), jusqu'à Publication. */
async function jusquaPublication(page: Page): Promise<void> {
  await page.goto('/dashboard/creer');
  await page.getByRole('button', { name: 'Motivation', exact: true }).click();
  await page.getByRole('button', { name: /Continuer vers Rushes/ }).click();
  await expect(page.getByRole('checkbox', { name: /Mon avatar/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /Médias suggérés/ }).check();
  await expect(page.getByText('Vidéo suggérée').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  // Une source visuelle RETENUE (« Conserver » une vidéo suggérée) : sans elle, « Continuer » reste bloqué.
  const suite = page.getByRole('button', { name: /Continuer vers Style/ });
  for (let i = 0; i < 3 && !(await suite.isEnabled().catch(() => false)); i++) {
    const conserver = page.getByRole('button', { name: /Conserver/ }).first();
    if (await conserver.isVisible().catch(() => false)) await conserver.click();
    await page.waitForTimeout(1200);
  }
  await suite.click();
  await page.getByRole('button', { name: /Continuer vers Publication/ }).click();
}

/** Après rechargement : revient à l'étape Publication si l'assistant est reparti au début. */
async function revenirAPublication(page: Page): Promise<void> {
  const produire = page.getByText(/Production de la vidéo|Production interrompue|Produire un brouillon maintenant|Relancer la production/).first();
  if (await produire.isVisible().catch(() => false)) return;
  const etape = page.getByRole('button', { name: /Publication/ }).first();
  if (await etape.isVisible().catch(() => false)) { await etape.click(); await page.waitForTimeout(800); }
  if (await produire.isVisible().catch(() => false)) return;
  // Le brouillon n'a pas restauré l'étape : on refait le chemin (sans relancer quoi que ce soit).
  for (const cible of ['Rushes', 'Style', 'Publication']) {
    const b = page.getByRole('button', { name: new RegExp(`Continuer vers ${cible}`) });
    if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(600); }
  }
}

const enCours = (page: Page) => page.getByText('Production de la vidéo').first();

test.describe('Autopilote sans avatar — interruption et double lancement', () => {
  test('production interrompue (redémarrage) → message de reprise et « Relancer la production » ; double clic → un seul POST accepté, 409 suivi ; Calendrier « Génération en cours »', async ({ page, context, banc }) => {
    test.setTimeout(240_000);
    let phase: Phase = 'repos';
    const posts: Array<{ status: number; page: string }> = [];
    const lecturesSuivi: string[] = [];

    banc.surcharger('GET /api/autopilot/produire-maintenant/progression', ({ url }) => {
      const date = url.searchParams.get('date');
      const time = url.searchParams.get('time');
      lecturesSuivi.push(`${phase} ${date ?? '-'} ${time ?? '-'}`);
      if (phase === 'en-cours') {
        return { json: {
          success: true,
          progression: { pourcent: 40, etape: 'composition', libelle: 'Composition de la vidéo…', majA: Date.now(), avancement: 0.4 },
          resultat: null, jumeau: null, manuel: null, production: { date: DATE, time: HEURE },
        } };
      }
      if (phase === 'interrompue' && date === DATE && time === HEURE) {
        return { json: { success: true, progression: null, resultat: { success: false, error: MESSAGE_DIRECTE_INTERROMPUE, code: 'interrompue' }, jumeau: null, manuel: null } };
      }
      return { json: { success: true, progression: null, resultat: null, jumeau: null, manuel: null } };
    });
    banc.surcharger('GET /api/autopilot/produire-maintenant', () => ({ json: {
      success: true, politique: 'standard', cout: 10, detail: { rendu: 10, avatar: 0, affiche: 0 }, solde: 480, enCours: phase === 'en-cours',
    } }));
    banc.surcharger('POST /api/autopilot/produire-maintenant', ({ req }) => {
      const origine = req.frame()?.page() === page ? 'onglet-1' : 'onglet-2';
      if (phase === 'en-cours') {
        posts.push({ status: 409, page: origine });
        return { status: 409, json: { success: false, error: MESSAGE_EN_COURS, code: 'en-cours', scheduledDate: DATE, scheduledTime: HEURE } };
      }
      phase = 'en-cours';
      posts.push({ status: 202, page: origine });
      return { status: 202, json: { success: true, enCours: true, jobId: JOB, scheduledDate: DATE, scheduledTime: HEURE, timezone: 'Europe/Paris', title: 'Motivation' } };
    });

    await choisirParcours(page, 'autopilote');
    const navigations: string[] = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    // ── 1. Lancement : 202, état « en cours », créneau suivi gardé ──────────
    await jusquaPublication(page);
    await page.getByRole('button', { name: /Produire un brouillon maintenant/ }).click();
    await page.getByRole('button', { name: /^Lancer le rendu$/ }).click();
    await expect(enCours(page)).toBeVisible({ timeout: 15_000 });
    await enCours(page).scrollIntoViewIfNeeded();
    await banc.capture(page, 'interruption-1-en-cours');
    expect(await page.evaluate((k) => localStorage.getItem(k), CLE_SUIVI), 'créneau suivi mémorisé').toContain(DATE);

    // ── 2. Rechargement pendant la production : l'état PERSISTANT est retrouvé ─
    await page.reload();
    await page.waitForTimeout(2500);
    await revenirAPublication(page);
    await expect(enCours(page), 'production en cours retrouvée après rechargement').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Produire un brouillon maintenant|Relancer la production/ })).toHaveCount(0);
    await enCours(page).scrollIntoViewIfNeeded();
    await banc.capture(page, 'interruption-2-en-cours-apres-rechargement');

    // ── 3. Le serveur redémarre : la production devient « interrompue » ──────
    // Page quittée avant la bascule (aucune lecture en vol), puis rechargée.
    await page.goto('about:blank');
    phase = 'interrompue';
    await page.goto('/dashboard/creer');
    await page.waitForTimeout(2500);
    await revenirAPublication(page);
    const erreur = page.getByText(/Production interrompue/).first();
    await expect(erreur, 'message de reprise après interruption').toBeVisible({ timeout: 15_000 });
    await expect(erreur).toContainText('Aucun crédit n’est débité');
    const relancer = page.getByRole('button', { name: 'Relancer la production' });
    await expect(relancer).toBeVisible();
    await erreur.scrollIntoViewIfNeeded();
    await banc.capture(page, 'interruption-3-interrompue-relancer');
    expect(lecturesSuivi.some((l) => l.startsWith(`interrompue ${DATE} ${HEURE}`)), 'le créneau suivi est envoyé à /progression').toBe(true);
    // L'issue lue, le créneau est oublié (pas de faux « interrompue » à la visite suivante).
    expect(await page.evaluate((k) => localStorage.getItem(k), CLE_SUIVI)).toBeNull();

    // ── 4. Second onglet ouvert AVANT la relance, à la confirmation ─────────
    const page2 = await context.newPage();
    await jusquaPublication(page2);
    await page2.getByRole('button', { name: /Produire un brouillon maintenant/ }).click();
    await expect(page2.getByRole('button', { name: /^Lancer le rendu$/ })).toBeVisible();

    // ── 5. Relance par DOUBLE CLIC dans l'onglet 1 : un seul POST accepté ────
    phase = 'repos';
    const debutRelance = posts.length;
    await relancer.click();
    const lancer = page.getByRole('button', { name: /^Lancer le rendu$/ });
    await expect(lancer).toBeVisible();
    await lancer.dblclick();
    await expect(enCours(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const postsOnglet1 = posts.slice(debutRelance).filter((p) => p.page === 'onglet-1');
    test.info().annotations.push({ type: 'posts-onglet-1-double-clic', description: JSON.stringify(postsOnglet1) });
    expect(postsOnglet1.filter((p) => p.status === 202), 'un seul POST accepté (202) au double clic').toHaveLength(1);
    expect(postsOnglet1.every((p) => p.status === 202 || p.status === 409), 'tout POST en trop reçoit 409').toBe(true);
    await expect(page.getByText(/Production interrompue|Opération annulée|déjà en cours/).first()).toBeHidden();
    await enCours(page).scrollIntoViewIfNeeded();
    await banc.capture(page, 'interruption-4-double-clic-un-seul-post');

    // ── 6. L'onglet 2 lance aussi : 409 « en-cours », il SUIT la production ──
    await page2.getByRole('button', { name: /^Lancer le rendu$/ }).click();
    await expect(enCours(page2), 'l’onglet 2 suit la production existante').toBeVisible({ timeout: 15_000 });
    await expect(page2.getByText(MESSAGE_EN_COURS)).toHaveCount(0);
    const postsOnglet2 = posts.slice(debutRelance).filter((p) => p.page === 'onglet-2');
    test.info().annotations.push({ type: 'posts-onglet-2', description: JSON.stringify(postsOnglet2) });
    expect(postsOnglet2.map((p) => p.status)).toEqual([409]);
    expect(posts.slice(debutRelance).filter((p) => p.status === 202), 'un seul POST accepté pour la relance (double clic + 2e onglet)').toHaveLength(1);
    expect(await page2.evaluate((k) => localStorage.getItem(k), CLE_SUIVI), 'le 409 donne le créneau suivi').toContain(DATE);
    await enCours(page2).scrollIntoViewIfNeeded();
    await banc.capture(page2, 'interruption-5-onglet2-409-suit');
    await page2.close();

    // ── 7. Aucune redirection ; Calendrier « Génération en cours » ──────────
    expect(navigations.filter((u) => !/\/dashboard\/creer|about:blank/.test(u)), 'aucune redirection automatique').toEqual([]);
    await page.goto('/dashboard/calendar');
    const bandeau = page.getByText('Génération en cours').first();
    await expect(bandeau, 'bandeau Calendrier « Génération en cours »').toBeVisible({ timeout: 20_000 });
    await bandeau.scrollIntoViewIfNeeded();
    await banc.capture(page, 'interruption-6-calendrier-generation-en-cours');
    test.info().annotations.push({ type: 'posts', description: JSON.stringify(posts) });
  });
});
