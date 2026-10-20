/**
 * Créer — Sujet → Style → Audio → Contenu → Envoi, en isolation complète.
 *
 * Phase `avant` : les assertions du comportement CIBLE qui échouent sur main
 * sont marquées `attenduAvantCorrection` (rouge attendu). Phase `apres` : les
 * MÊMES scénarios doivent passer.
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect, attenduAvantCorrection, DOSSIER_RESULTATS, PHASE } from './fixtures';
import { ouvrirCreer, allerA, choisirFormat, poserCurseur, mentionsFournisseurVisibles, sonder, FORMATS, slugFormat } from './parcours';

const panneauVoix = (page: import('playwright/test').Page) => page.locator('[data-sequence-voices-panel]').first();

test.describe('Créer — parcours guidé', () => {
  test('parcours complet 9:16 : captures de chaque étape', async ({ page, banc }) => {
    await ouvrirCreer(page);
    await banc.capture(page, 'creer-1-sujet', { fullPage: true });
    await allerA(page, 'Style');
    await choisirFormat(page, '9:16');
    await banc.capture(page, 'creer-2-style', { fullPage: true });
    await allerA(page, 'Audio');
    await banc.capture(page, 'creer-3-audio', { fullPage: true });
    await allerA(page, 'Contenu');
    await expect(page.getByText('Voix-off par séquence', { exact: true })).toBeVisible();
    await banc.capture(page, 'creer-4-contenu', { fullPage: true });
    await allerA(page, 'Envoi');
    await expect(page.getByRole('button', { name: /Composer et envoyer/ })).toBeVisible();
    await banc.capture(page, 'creer-5-envoi', { fullPage: true });
  });

  test('cartes : aucune valeur ne répète un mot du titre de la carte', async ({ page, banc }) => {
    attenduAvantCorrection('valeurs de cartes = mot du titre (smart-content DOPA/PROC/ANCRÉ…, synthèse T)');
    await ouvrirCreer(page);
    await allerA(page, 'Style');
    await allerA(page, 'Audio');
    await allerA(page, 'Contenu');
    // Les cartes de l'aperçu : titre + valeur ([data-card-value]), sur 4 générations (« Relancer »).
    const lire = () => page.locator('[data-card-id]').evaluateAll((els) => els.map((e) => {
      const valeur = (e.querySelector('[data-card-value]')?.textContent || '').trim();
      const copie = e.cloneNode(true) as HTMLElement;
      copie.querySelectorAll('[data-card-value]').forEach((n) => n.remove());
      return { titre: (copie.textContent || '').replace(/\s+/g, ' ').trim(), valeur };
    }));
    const cartes: Array<{ titre: string; valeur: string }> = [];
    for (let i = 0; i < 4; i++) {
      if (i > 0) { await page.getByRole('button', { name: /^Relancer$/ }).click(); await page.waitForTimeout(1200); }
      cartes.push(...(await lire()));
      await banc.capture(page, `creer-cartes-valeurs-${i + 1}`);
    }
    test.info().annotations.push({ type: 'cartes', description: JSON.stringify(cartes) });
    expect(cartes.length, 'cartes visibles dans l’aperçu').toBeGreaterThan(0);
    const norm = (x: string) => x.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').trim();
    const repetitions = cartes.filter(({ titre, valeur }) => {
      const v = norm(valeur);
      if (v.length < 3 || /\d/.test(v)) return false;
      return norm(titre).split(/\s+/).some((m) => m === v || m.startsWith(v));
    }).map((c) => `${c.titre} → ${c.valeur}`);
    test.info().annotations.push({ type: 'cartes-repetees', description: repetitions.join(' | ') || 'aucune' });
    expect(repetitions, 'valeurs de cartes qui répètent le titre').toEqual([]);
  });

  test('Style : aucun nom de fournisseur affiché en clair', async ({ page, banc }) => {
    attenduAvantCorrection('« Photos et vidéos fournies par Pexels et Unsplash » / « X sur Pexels » toujours visibles (synthèse F)');
    await ouvrirCreer(page);
    await allerA(page, 'Style');
    await page.getByRole('button', { name: /Photo d.affiche/ }).click();
    // Les propositions d'affiche viennent d'une recherche (simulée, médias locaux).
    const rechercher = page.getByRole('button', { name: /^Rechercher$/ }).first();
    if (await rechercher.isVisible().catch(() => false)) await rechercher.click();
    await page.waitForTimeout(1500);
    // Retenir la première photo proposée, si la grille en montre une.
    const vignette = page.locator('button img[src*="banc-medias"]').first();
    if (await vignette.isVisible().catch(() => false)) await vignette.click();
    await page.waitForTimeout(800);
    await banc.capture(page, 'creer-fournisseur-style', { fullPage: true });
    const mentions = await mentionsFournisseurVisibles(page);
    test.info().annotations.push({ type: 'mentions-fournisseur', description: mentions.join(' | ') || 'aucune' });
    expect(mentions).toEqual([]);
  });

  test('voix-off : réglages lisibles et aucun faux « Audio périmé »', async ({ page, banc }) => {
    attenduAvantCorrection('faux « périmé » sur le dynamisme d’une voix où il est sans effet + aucun repère ×1,00 = naturel (synthèse A)');
    await ouvrirCreer(page);
    await allerA(page, 'Style');
    await allerA(page, 'Audio');
    await allerA(page, 'Contenu');
    const panneau = panneauVoix(page);
    await panneau.scrollIntoViewIfNeeded();
    await banc.capture(page, 'creer-voix-1-initial', { locator: panneau });
    await page.getByRole('button', { name: /Générer toutes les voix TTS/ }).click();
    await expect(page.getByRole('button', { name: /Générer toutes les voix TTS/ })).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await banc.capture(page, 'creer-voix-2-generees', { locator: panneau });

    // 1) Changement LÉGITIME : la vitesse du Titre → bandeau « périmé » + Régénérer.
    await poserCurseur(page.getByRole('slider', { name: 'Vitesse de la voix — Titre' }), 110);
    await page.waitForTimeout(500);
    const bandeau = page.locator('[data-voice-stale-motif]').first();
    await expect(bandeau).toBeVisible();
    await banc.capture(page, 'creer-voix-3-perime-vitesse', { locator: panneau });
    const tronque = await bandeau.evaluate((el) => {
      const t = el.querySelector('.truncate') ?? el;
      return (t as HTMLElement).scrollWidth > (t as HTMLElement).clientWidth + 1;
    });
    test.info().annotations.push({ type: 'bandeau-tronque', description: String(tronque) });
    await expect(page.getByRole('button', { name: /^Régénérer$/ }).first()).toBeVisible();

    // 2) Changement SANS EFFET : le dynamisme sur la voix Edge par défaut.
    //    (curseur désactivé pour Edge : on passe par une voix ElevenLabs puis on revient.)
    const selecteur = page.getByTestId('seq-tts-voice-select');
    const voixInitiale = await selecteur.inputValue();
    const optionEleven = await selecteur.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => /eleven/i.test(v)) ?? null);
    test.info().annotations.push({ type: 'voix', description: `initiale=${voixInitiale} eleven=${optionEleven}` });
    if (optionEleven) {
      await selecteur.selectOption(optionEleven);
      const dynCartes = page.getByRole('slider', { name: /Dynamisme de la voix — Cartes/ });
      await poserCurseur(dynCartes, Number(await dynCartes.getAttribute('max')) / 2);
      await selecteur.selectOption(voixInitiale);
      await page.waitForTimeout(500);
    }
    await banc.capture(page, 'creer-voix-4-dynamisme-sans-effet', { locator: panneau });
    const motifs = await page.locator('[data-voice-stale-motif]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-voice-stale-motif')}: ${(e.textContent || '').trim()}`));
    test.info().annotations.push({ type: 'bandeaux-perimes', description: motifs.join(' | ') });

    // Cible : seul le Titre (vitesse réellement changée) est périmé ; et un repère « naturel » existe.
    // Un seul bandeau « réglages » : celui du Titre, dont la vitesse a vraiment changé.
    expect(motifs.filter((m) => m.startsWith('reglages')).length, 'bandeaux « réglages modifiés »').toBe(1);
    await expect(panneau.getByText(/naturel/i).first()).toBeVisible({ timeout: 2_000 });
  });
});

test.describe('Créer — composition réelle (compositeur navigateur)', () => {
  for (const format of FORMATS) {
    test(`composition ${format} en brouillon → fichier webm sur disque`, async ({ page, banc }, info) => {
      test.skip(info.project.name !== 'ordinateur', 'composition lancée une fois par format (ordinateur)');
      test.setTimeout(420_000);
      const fichier = path.join(DOSSIER_RESULTATS, `creer-${slugFormat(format)}-${PHASE}.webm`);
      fs.rmSync(fichier, { force: true });
      banc.etat.fichierRendu = fichier;
      await ouvrirCreer(page);
      await allerA(page, 'Style');
      await choisirFormat(page, format);
      await allerA(page, 'Audio');
      await allerA(page, 'Contenu');
      await page.getByRole('button', { name: /Générer toutes les voix TTS/ }).click();
      await expect(page.getByRole('button', { name: /Générer toutes les voix TTS/ })).toBeEnabled({ timeout: 60_000 });
      await allerA(page, 'Envoi');
      await page.getByRole('button', { name: /Garder en brouillon/ }).click();
      await banc.capture(page, `creer-envoi-${slugFormat(format)}`, { fullPage: true });
      await page.getByRole('button', { name: /Composer et envoyer/ }).click();
      await page.waitForTimeout(4000);
      await banc.capture(page, `creer-composition-${slugFormat(format)}`);
      await expect.poll(() => banc.etat.rendus.length + banc.etat.posts.length, { timeout: 360_000, intervals: [2000] }).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(2500);
      await banc.capture(page, `creer-fin-${slugFormat(format)}`, { fullPage: true });
      expect(fs.existsSync(fichier)).toBe(true);
      const mesure = sonder(fichier);
      const post = banc.etat.posts[0] as Record<string, unknown>;
      test.info().annotations.push({ type: 'webm', description: `${fichier} ${JSON.stringify(mesure)}` });
      test.info().annotations.push({ type: 'post', description: JSON.stringify({ status: post.status, format: post.format, title: post.title }) });
      expect(post.status).toBe('draft');
      expect(mesure.images ?? 0, 'le montage contient des images').toBeGreaterThan(10);
    });
  }
});
