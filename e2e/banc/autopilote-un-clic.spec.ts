/**
 * Autopilote — UN CLIC = UNE GÉNÉRATION, et UNE progression honnête.
 *
 * Réponses simulées reprises du code réel :
 *  - GET  /api/autopilot/produire-maintenant : devis, et pour un compte
 *    « frais partenaires » le devis HeyGen d'UNE vidéo (`fournisseur.devisParVideo`).
 *  - POST /api/autopilot/produire-maintenant : garde `exigerConfirmationCout`
 *    (confirmation + même moteur, sinon 428 + devis) ; avec avatar →
 *    `{ jumeau: 'en_preparation' }` ; sans avatar → 202.
 *  - GET  …/progression : file avatar (`jumeau`) + `progression` mesurée du
 *    montage final, puis dépôt PROUVÉ (`jumeau.etat = 'depose'` / `resultat`).
 */
import type { Page } from 'playwright/test';
import { test, expect, choisirParcours, USER_ID } from './fixtures';

const DATE = new Date().toISOString().slice(0, 10);
const HEURE = '12:00';
const JOB = `autopilote-manuel-${USER_ID}-${DATE}-${HEURE.replace(':', '')}`;
const DEVIS_HEYGEN = {
  fournisseur: 'heygen', operation: 'video_avatar', libelleOperation: 'Vidéo avatar', moteur: 'avatar_iii', moteurImplicite: false,
  typeAvatar: 'twin', dureeSecondes: { min: 28, max: 32 }, origineDuree: 'texte', tarifUsdParSeconde: 0.01,
  coutUsd: { min: 0.28, max: 0.32 }, creditsStudiio: 0, prixConnu: true,
};

async function jusquaPublication(page: Page, avecAvatar: boolean): Promise<void> {
  await page.goto('/dashboard/creer');
  await page.getByRole('button', { name: 'Motivation', exact: true }).click();
  await page.getByRole('button', { name: /Continuer vers Rushes/ }).click();
  if (avecAvatar) await page.getByRole('checkbox', { name: /Mon avatar/ }).check();
  await page.getByRole('checkbox', { name: /Médias suggérés/ }).check();
  await expect(page.getByText('Vidéo suggérée').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  const suite = page.getByRole('button', { name: /Continuer vers Style/ });
  for (let i = 0; i < 3 && !(await suite.isEnabled().catch(() => false)); i++) {
    const conserver = page.getByRole('button', { name: /Conserver/ }).first();
    if (await conserver.isVisible().catch(() => false)) await conserver.click();
    await page.waitForTimeout(1200);
  }
  await suite.click();
  await page.getByRole('button', { name: /Continuer vers Publication/ }).click();
}

/** Un seul pourcentage visible dans la zone de production. */
async function pourcentagesAffiches(page: Page, zone: string): Promise<string[]> {
  return page.locator(`${zone} [data-progress-pourcentage]`).allInnerTexts();
}

test.describe('Autopilote — un clic, une progression honnête', () => {
  test('AVEC avatar : coût HeyGen visible, UN clic → UN POST confirmé, suivi avatar avec avancement réel du montage, jamais deux %', async ({ page, banc }) => {
    test.setTimeout(240_000);
    const posts: Array<Record<string, unknown>> = [];
    let phase: 'repos' | 'file' | 'montage' | 'depose' = 'repos';
    banc.surcharger('GET /api/autopilot/produire-maintenant', () => ({ json: {
      success: true, politique: 'partner_cost_only', cout: 0, detail: { rendu: 0, avatar: 0, affiche: 0 }, solde: null, enCours: phase !== 'repos',
      fournisseur: { devisParVideo: DEVIS_HEYGEN },
    } }));
    banc.surcharger('POST /api/autopilot/produire-maintenant', ({ req }) => {
      const corps = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      posts.push(corps);
      if (corps.confirmationCoutFournisseur !== true || corps.moteurConfirme !== 'avatar_iii') {
        return { status: 428, json: { success: false, code: 'confirmation_cout_fournisseur', devis: DEVIS_HEYGEN } };
      }
      phase = 'file';
      return { json: { success: true, jumeau: 'en_preparation', jobId: JOB, scheduledDate: DATE, scheduledTime: HEURE, timezone: 'Europe/Paris', status: 'draft', platforms: [] } };
    });
    banc.surcharger('GET /api/autopilot/produire-maintenant/progression', () => {
      if (phase === 'file') return { json: { success: true, progression: null, resultat: null, jumeau: { etat: 'en_preparation', jobId: JOB, statut: 'en_attente', depuis: new Date().toISOString() } } };
      if (phase === 'montage') return { json: {
        success: true,
        progression: { pourcent: 49, etape: 'composition', libelle: 'Composition de la vidéo…', majA: Date.now(), avancement: 0.4 },
        resultat: null, jumeau: { etat: 'en_preparation', jobId: JOB, statut: 'en_cours', depuis: new Date().toISOString() },
      } };
      if (phase === 'depose') return { json: { success: true, progression: null, resultat: null, jumeau: { etat: 'depose', jobId: JOB, post: { postId: 'p-1', scheduledDate: DATE, scheduledTime: HEURE } } } };
      return { json: { success: true, progression: null, resultat: null, jumeau: null } };
    });

    await choisirParcours(page, 'autopilote');
    await jusquaPublication(page, true);
    await page.getByRole('button', { name: /Produire un brouillon maintenant/ }).click();
    const cout = page.locator('[data-autopilot-produire-cout-fournisseur]');
    await expect(cout, 'coût HeyGen visible au moment du clic').toContainText('HeyGen');
    await banc.capture(page, 'un-clic-1-confirmation-avec-cout');

    await page.getByRole('button', { name: /^Lancer le rendu$/ }).click();
    const suivi = page.locator('[data-autopilot-produire-jumeau]');
    await expect(suivi).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Coût fournisseur estimé', { exact: false }).locator('xpath=ancestor::*[@role="dialog"]')).toHaveCount(0);
    expect(posts, 'un seul POST').toHaveLength(1);
    expect(posts[0].confirmationCoutFournisseur).toBe(true);
    await banc.capture(page, 'un-clic-2-avatar-en-file');

    phase = 'montage';
    await expect(suivi.locator('[data-progress-pourcentage]')).toHaveText('40 %', { timeout: 10_000 });
    expect(await pourcentagesAffiches(page, '[data-autopilot-produire-jumeau]')).toEqual(['40 %']);
    await expect(suivi.locator('[data-progress-workflow]')).toHaveCount(0);
    await banc.capture(page, 'un-clic-3-montage-avancement-reel');

    phase = 'depose';
    await expect(page.locator('[data-autopilot-produire-resultat]')).toBeVisible({ timeout: 10_000 });
    expect(posts, 'toujours un seul POST à la fin').toHaveLength(1);
    await banc.capture(page, 'un-clic-4-depose');
  });

  test('SANS avatar : UN clic → UN POST, pourcentage réel seul, plafonné à 99 % avant livraison', async ({ page, banc }) => {
    test.setTimeout(240_000);
    const posts: unknown[] = [];
    let phase: 'repos' | 'montage' | 'fin-composition' | 'livre' = 'repos';
    banc.surcharger('GET /api/autopilot/produire-maintenant', () => ({ json: {
      success: true, politique: 'standard', cout: 10, detail: { rendu: 10, avatar: 0, affiche: 0 }, solde: 480, enCours: phase !== 'repos',
    } }));
    banc.surcharger('POST /api/autopilot/produire-maintenant', ({ req }) => {
      posts.push(JSON.parse(req.postData() ?? '{}'));
      phase = 'montage';
      return { status: 202, json: { success: true, enCours: true, jobId: JOB, scheduledDate: DATE, scheduledTime: HEURE, timezone: 'Europe/Paris', title: 'Motivation' } };
    });
    banc.surcharger('GET /api/autopilot/produire-maintenant/progression', () => {
      const prog = (avancement: number) => ({ pourcent: 25 + Math.round(60 * avancement), etape: 'composition', libelle: 'Composition de la vidéo…', majA: Date.now(), avancement });
      if (phase === 'montage') return { json: { success: true, progression: prog(0.4), resultat: null, jumeau: null, manuel: null, production: { date: DATE, time: HEURE } } };
      if (phase === 'fin-composition') return { json: { success: true, progression: prog(1), resultat: null, jumeau: null, manuel: null, production: { date: DATE, time: HEURE } } };
      if (phase === 'livre') return { json: { success: true, progression: null, resultat: { success: true, postId: 'p-2', scheduledDate: DATE, scheduledTime: HEURE, status: 'draft', platforms: [] }, jumeau: null, manuel: null } };
      return { json: { success: true, progression: null, resultat: null, jumeau: null, manuel: null } };
    });

    await choisirParcours(page, 'autopilote');
    await jusquaPublication(page, false);
    await page.getByRole('button', { name: /Produire un brouillon maintenant/ }).click();
    await expect(page.locator('[data-autopilot-produire-cout-fournisseur]')).toHaveCount(0);
    await page.getByRole('button', { name: /^Lancer le rendu$/ }).click();
    const zone = page.locator('[data-autopilot-produire-en-cours]');
    await expect(zone.locator('[data-progress-pourcentage]')).toHaveText('40 %', { timeout: 15_000 });
    expect(await pourcentagesAffiches(page, '[data-autopilot-produire-en-cours]')).toEqual(['40 %']);
    await expect(zone.locator('[data-progress-workflow]')).toHaveCount(0);
    await banc.capture(page, 'un-clic-5-sans-avatar-40');

    phase = 'fin-composition';
    await expect(zone.locator('[data-progress-pourcentage]')).toHaveText('99 %', { timeout: 10_000 });
    await banc.capture(page, 'un-clic-6-sans-avatar-99-avant-livraison');

    phase = 'livre';
    await expect(page.locator('[data-autopilot-produire-resultat]')).toBeVisible({ timeout: 10_000 });
    expect(posts, 'un seul POST').toHaveLength(1);
  });
});
