/**
 * Autopilote — sujet « Motivation » → sources (avatar + médias suggérés) →
 * aperçu → Produire maintenant (simulé) → Calendrier → retour.
 */
import type { Page } from 'playwright/test';
import { test, expect, attenduAvantCorrection, choisirParcours } from './fixtures';
import { mentionsFournisseurVisibles } from './parcours';

async function ouvrirSources(page: Page): Promise<void> {
  await choisirParcours(page, 'autopilote');
  await page.goto('/dashboard/creer');
  await page.getByRole('button', { name: 'Motivation', exact: true }).click();
  await page.getByRole('button', { name: /Continuer vers Rushes/ }).click();
  await page.getByRole('checkbox', { name: /Mon avatar/ }).check();
  await page.getByRole('checkbox', { name: /Médias suggérés/ }).check();
  await expect(page.getByText('Vidéo suggérée').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/** Retient chaque proposition (« Conserver ») encore en attente. */
async function conserverPropositions(page: Page): Promise<number> {
  let n = 0;
  for (let i = 0; i < 6; i++) {
    const b = page.locator('[data-autopilot-stock-conserver]').first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
    await expect(b).toBeHidden({ timeout: 10_000 }).catch(() => {});
    n += 1;
    await page.waitForTimeout(500);
  }
  test.info().annotations.push({ type: 'propositions-conservees', description: String(n) });
  return n;
}

const frise = (page: Page) => page.locator('[data-chronologie]').first();
const cadre = (page: Page) => page.locator('[data-apercu-montage]').first();

test.describe('Autopilote', () => {
  test('sources et aperçu : captures (frise, cadre, médias)', async ({ page, banc }) => {
    await ouvrirSources(page);
    await banc.capture(page, 'autopilote-1-sources', { fullPage: true });
    await conserverPropositions(page);
    await page.waitForTimeout(1000);
    await banc.capture(page, 'autopilote-2-sources-conservees', { fullPage: true });
    await expect(frise(page)).toBeVisible();
    await banc.capture(page, 'autopilote-3-frise-pastilles', { locator: frise(page) });
    await banc.capture(page, 'autopilote-4-cadre-apercu', { locator: cadre(page) });
    const medias = page.getByText(/MÉDIAS PRÉVUS|Médias prévus/).first().locator('xpath=ancestor::div[1]');
    if (await medias.isVisible().catch(() => false)) await banc.capture(page, 'autopilote-5-medias-prevus', { locator: medias });
    const plan = page.getByText(/PLAN AVANT GÉNÉRATION|Plan avant génération/).first().locator('xpath=ancestor::div[1]');
    if (await plan.isVisible().catch(() => false)) await banc.capture(page, 'autopilote-6-plan', { locator: plan });
    test.info().annotations.push({ type: 'pastilles', description: (await frise(page).innerText()).replace(/\s+/g, ' ') });
    test.info().annotations.push({ type: 'medias-suggeres', description: ((await page.getByText(/Médias suggérés\s*:\s*\d+/).first().innerText().catch(() => 'absent'))) });
  });

  test('aperçu : la vraie vidéo de l’avatar (rendu récent) est montrée dans le cadre', async ({ page, banc }) => {
    attenduAvantCorrection('cadre noir « Votre avatar parlera ici » alors que GET /api/avatar/apercu renvoie un rendu récent (synthèse M)');
    await ouvrirSources(page);
    await banc.capture(page, 'autopilote-avatar-cadre', { locator: cadre(page) });
    const sources = await cadre(page).locator('video, img').evaluateAll((els) => els.map((e) => (e as HTMLVideoElement).currentSrc || (e as HTMLImageElement).src || e.getAttribute('src') || ''));
    test.info().annotations.push({ type: 'cadre-sources', description: sources.join(' | ') || 'aucune' });
    // Le RENDU RÉCENT déjà payé (GET /api/avatar/apercu → renduRecent.url = /banc-medias/avatar.mp4),
    // pas la source d'entraînement (/api/avatars/versions/<id>/source) ni un cadre noir.
    expect(sources.some((s) => /avatar\.mp4/.test(s)), 'le cadre montre le rendu récent de l’avatar').toBe(true);
  });

  test('frise : les vidéos suggérées retenues apparaissent comme pastilles', async ({ page, banc }) => {
    // Pas d'échec attendu : rejoué sur 0f098b7 avec « Conserver » réellement cliqué, le média
    // conservé apparaissait déjà (« Rush : stock-1.mp4 4–8 s »). Le premier constat « avant »
    // venait d'un geste du banc qui ne cliquait pas le bon bouton.
    await ouvrirSources(page);
    await conserverPropositions(page);
    await page.waitForTimeout(1500);
    await banc.capture(page, 'autopilote-frise-apres-conserver', { locator: frise(page) });
    const texte = (await frise(page).innerText()).replace(/\s+/g, ' ');
    test.info().annotations.push({ type: 'pastilles', description: texte });
    // Avant : « Vidéo suggérée … » attendu en pastille. Après intégration, un média
    // conservé entre dans la banque et la chronologie le nomme « Rush : <fichier> » :
    // l'intention reste « le média suggéré retenu est dans la frise ».
    expect(texte).toMatch(/Vidéo suggérée|Rush : (stock|rush)-\d\.mp4/i);
  });

  test('aucun nom de fournisseur affiché en clair', async ({ page, banc }) => {
    attenduAvantCorrection('« Photos et vidéos fournies par Pexels et Unsplash » sous la recherche de médias (synthèse F)');
    await ouvrirSources(page);
    const mentions = await mentionsFournisseurVisibles(page);
    test.info().annotations.push({ type: 'mentions-fournisseur', description: mentions.join(' | ') || 'aucune' });
    const credit = page.locator('[data-credit-media]').filter({ hasText: /Pexels|Unsplash/ }).first();
    if (await credit.isVisible().catch(() => false)) {
      await credit.scrollIntoViewIfNeeded();
      await banc.capture(page, 'autopilote-fournisseur-visible');
    }
    expect(mentions).toEqual([]);
  });

  test('Produire maintenant : aucune redirection, état visible dans le Calendrier et retrouvé au retour', async ({ page, banc }) => {
    attenduAvantCorrection('le Calendrier n’affiche aucun état « Génération en cours » pendant une production Autopilote (synthèse G)');
    test.setTimeout(180_000);
    // Progression simulée : analyse → préparation → composition → envoi (reste en cours).
    const etapes = [
      { pourcent: 5, etape: 'analyse', libelle: 'Analyse des rushes…' },
      { pourcent: 20, etape: 'preparation', libelle: 'Préparation du montage…' },
      { pourcent: 40, etape: 'composition', libelle: 'Composition de la vidéo…', avancement: 0.25 },
      { pourcent: 70, etape: 'composition', libelle: 'Composition de la vidéo…', avancement: 0.75 },
      { pourcent: 90, etape: 'envoi', libelle: 'Envoi de la vidéo…' },
    ];
    let lectures = 0;
    banc.surcharger('GET /api/autopilot/produire-maintenant/progression', ({ etat }) => {
      if (!etat.production.progression) return { json: { success: true, progression: null, resultat: null, jumeau: null } };
      const e = etapes[Math.min(etapes.length - 1, Math.floor(lectures++ / 2))];
      return { json: { success: true, progression: { ...e, majA: Date.now(), avancement: e.avancement ?? null }, resultat: null, jumeau: null } };
    });

    await ouvrirSources(page);
    await page.getByRole('button', { name: /Continuer vers Style/ }).click();
    await page.getByRole('button', { name: /Continuer vers Publication/ }).click();
    await banc.capture(page, 'autopilote-7-publication', { fullPage: true });
    const urlAvant = page.url();
    const navigations: string[] = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
    await page.getByRole('button', { name: /Produire un brouillon maintenant/ }).click();
    // L'écran annonce le coût (10 crédits) puis demande « Lancer le rendu ».
    await banc.capture(page, 'autopilote-7b-confirmation-cout');
    await page.getByRole('button', { name: /^Lancer le rendu$/ }).click();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(2500);
      await banc.capture(page, `autopilote-8-progression-${i + 1}`);
    }
    expect(page.url(), 'aucune redirection automatique pendant la production').toBe(urlAvant);
    expect(navigations.filter((u) => !u.includes('/dashboard/creer')), 'navigations non demandées').toEqual([]);
    await expect(page.getByText(/Composition de la vidéo|Envoi de la vidéo|Préparation du montage|Analyse des rushes/).first()).toBeVisible();

    // L'utilisateur part au Calendrier pendant la production, puis recharge.
    await page.goto('/dashboard/calendar');
    await page.waitForTimeout(2500);
    await page.reload();
    await page.waitForTimeout(3000);
    await banc.capture(page, 'autopilote-9-calendrier-pendant-production', { fullPage: true });
    const calendrierMontreEnCours = await page.getByText(/G[ée]n[ée]ration en cours|Production en cours|en cours de (g[ée]n[ée]ration|production)/i).first().isVisible().catch(() => false);
    test.info().annotations.push({ type: 'calendrier-etat-en-cours', description: String(calendrierMontreEnCours) });

    // Retour à l'Autopilote : la production en cours est retrouvée (barre, bouton bloqué).
    await page.goto('/dashboard/creer');
    await page.waitForTimeout(3000);
    let retrouve = await page.getByText(/Composition de la vidéo|Envoi de la vidéo|Production en cours/).first().isVisible().catch(() => false);
    if (!retrouve) {
      // L'état peut n'être rendu qu'à l'étape Publication : on y retourne par le fil d'étapes.
      const etapePub = page.getByRole('button', { name: /Publication/ }).first();
      if (await etapePub.isVisible().catch(() => false)) { await etapePub.click(); await page.waitForTimeout(2000); }
      retrouve = await page.getByText(/Composition de la vidéo|Envoi de la vidéo|Production en cours/).first().isVisible().catch(() => false);
    }
    await banc.capture(page, 'autopilote-10-retour', { fullPage: true });
    test.info().annotations.push({ type: 'etat-retrouve-au-retour', description: String(retrouve) });
    expect(retrouve, 'production en cours retrouvée au retour').toBe(true);
    expect(calendrierMontreEnCours, 'le Calendrier montre « Génération en cours »').toBe(true);
  });

  test('VideosPretes : « Planifier / Ajouter en brouillon au Calendrier » sans navigation automatique', async ({ page, banc }) => {
    attenduAvantCorrection('VideosPretes.tsx:237 `window.location.href = /dashboard/calendar` après le clic (synthèse G)');
    banc.etat.sessionTournage = true;
    await choisirParcours(page, 'autopilote');
    await page.goto('/dashboard/creer');
    await page.getByRole('button', { name: 'Motivation', exact: true }).click();
    await page.getByRole('button', { name: /Continuer vers Rushes/ }).click();
    await page.locator('[data-autopilot-sessions] > summary').click();
    await page.locator('[data-tournage-session="sess-banc"]').click();
    const bouton = page.getByRole('button', { name: /Planifier la publication|Ajouter en brouillon au Calendrier/ });
    await expect(bouton).toBeVisible({ timeout: 20_000 });
    await banc.capture(page, 'autopilote-videospretes-1-avant-clic', { fullPage: true });
    const navigations: string[] = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
    await bouton.click();
    await expect.poll(() => banc.etat.posts.length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(4000);
    await banc.capture(page, 'autopilote-videospretes-2-apres-clic', { fullPage: true });
    test.info().annotations.push({ type: 'navigations', description: navigations.join(' | ') || 'aucune' });
    expect(navigations, 'aucune navigation automatique après le clic').toEqual([]);
    expect(page.url()).toContain('/dashboard/creer');
  });
  test('chronologie : lisible à chaque largeur (défilement horizontal au téléphone, pas de page qui déborde)', async ({ page, banc }) => {
    attenduAvantCorrection('pastilles de texte seulement : aucune chronologie à segments défilante (ChronologieMontage absente)');
    await ouvrirSources(page);
    await conserverPropositions(page);
    await page.waitForTimeout(1000);
    const chrono = frise(page);
    await chrono.scrollIntoViewIfNeeded();
    await banc.capture(page, 'autopilote-chronologie-largeur', { locator: chrono });
    const mesure = await chrono.evaluate((el) => {
      const s = getComputedStyle(el);
      const segs = Array.from(el.querySelectorAll('[data-segment]')).map((x) => (x as HTMLElement).getBoundingClientRect());
      return {
        overflowX: s.overflowX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
        segments: segs.length, largeurMin: segs.length ? Math.min(...segs.map((r) => r.width)) : 0,
        pageDeborde: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    test.info().annotations.push({ type: 'chronologie', description: JSON.stringify(mesure) });
    expect(mesure.segments, 'segments dans la chronologie').toBeGreaterThan(1);
    expect(mesure.pageDeborde, 'la page ne défile pas horizontalement').toBe(false);
    if (mesure.scrollWidth > mesure.clientWidth + 1) expect(['auto', 'scroll']).toContain(mesure.overflowX);
    expect(mesure.largeurMin, 'chaque segment garde une largeur lisible').toBeGreaterThanOrEqual(40);
  });
});
