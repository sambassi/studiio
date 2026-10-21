/**
 * Démo CALENDRIER — le post exporté par la démo Créer (`creer-post*.json`) est servi tel quel par le
 * banc (GET /api/posts), sa vidéo pointant vers le MP4 local converti. On ouvre l'aperçu (oeil) et on
 * relève ce que la page MONTRE : URL et durée du lecteur, CTA visible à la fin. Aucune publication.
 *
 *   DEMO_POST=/chemin/creer-post.json DEMO_MP4=/chemin/creer-sport.mp4 DEMO_SORTIE=/chemin \
 *     BANC_PORT=4000 npx playwright test -c e2e/banc/playwright.banc.config.ts e2e/banc/demo-calendrier.spec.ts --project ordinateur
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect, DOSSIER_RESULTATS, media } from './fixtures';

const SORTIE = process.env.DEMO_SORTIE || path.join(DOSSIER_RESULTATS, 'demos');
const POST = process.env.DEMO_POST || '';
const MP4 = process.env.DEMO_MP4 || '';

test('Calendrier : le post Créer exporté — vidéo, durée, CTA', async ({ page, banc }, info) => {
  test.skip(info.project.name !== 'ordinateur' || !POST || !MP4, 'démo : DEMO_POST et DEMO_MP4 requis');
  test.setTimeout(240_000);
  fs.mkdirSync(SORTIE, { recursive: true });
  const nom = `demo-calendrier-${path.basename(MP4)}`;
  fs.copyFileSync(MP4, path.join(__dirname, 'medias', nom));
  const post = JSON.parse(fs.readFileSync(POST, 'utf8')) as Record<string, any>;
  const url = media(nom);
  post.media_url = url;
  post.metadata = { ...post.metadata, renderedVideoUrl: url };
  post.scheduled_date = new Date().toISOString().slice(0, 10);
  banc.etat.posts.push(post);

  await page.goto('/dashboard/calendar');
  await expect(page.getByText('Sélectionnez une date')).toBeVisible({ timeout: 60_000 });
  // Le jour du post (cases du mois : leur numéro seul).
  const jour = String(Number(post.scheduled_date.slice(8, 10)));
  await page.locator('div,button').filter({ hasText: new RegExp(`^${jour}$`) }).last().click();
  await expect(page.getByText(post.title).first()).toBeVisible({ timeout: 60_000 });
  await page.getByTitle(/Aperçu|Preview|aperçu/i).first().click();
  await page.waitForTimeout(3000);
  await banc.capture(page, `demo-calendrier-1-apercu-${path.basename(MP4, '.mp4')}`, { fullPage: true });
  // Le lecteur VISIBLE de l'aperçu (sa source peut être une copie locale `blob:` du même fichier).
  const lecteur = page.locator('video:visible').first();
  await expect(lecteur).toBeVisible({ timeout: 30_000 });
  const texteModale = await page.locator('body').innerText();
  await expect.poll(() => lecteur.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThan(0);
  const mesure = await lecteur.evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, duree: v.duration, largeur: v.videoWidth, hauteur: v.videoHeight }));
  // Dernière image : le lecteur est amené à la fin, l'aperçu photographié (le CTA doit y être).
  await lecteur.evaluate(async (v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = Math.max(0, v.duration - 0.05);
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 3000); });
  });
  await page.waitForTimeout(500);
  await lecteur.screenshot({ path: path.join(SORTIE, `calendrier-derniere-image-${path.basename(MP4, '.mp4')}.png`) });
  const bilan = {
    ...mesure,
    dureeAnnoncee: /(\d+(?:[.,]\d+)?)\s*s\b/.exec(texteModale.split('séquences')[1] ?? '')?.[1] ?? null,
    dureePlan: post.metadata?.sequences?.total ?? null,
    ecartDureeS: Math.round((mesure.duree - (post.metadata?.sequences?.total ?? 0)) * 1000) / 1000,
    titreAffiche: texteModale.includes(post.title),
    ctaPrevu: post.metadata?.design?.ctaMainText ?? null,
    publicationsDemandees: banc.etat.posts.filter((p) => p.status === 'published').length,
  };
  fs.writeFileSync(path.join(SORTIE, `calendrier-bilan-${path.basename(MP4, '.mp4')}.json`), JSON.stringify(bilan, null, 2));
  test.info().annotations.push({ type: 'calendrier', description: JSON.stringify(bilan) });
  expect(mesure.duree).toBeGreaterThan(1);
  expect(Math.abs(bilan.ecartDureeS)).toBeLessThan(0.25);
});
