/**
 * UX premium (docs/UX-PREMIUM.md) — Autopilote étapes 1 (Sujets) et 2 (Rushes).
 *
 * Deux sortes de tests :
 *  1. MESURES + CAPTURES (passent toujours) : par zone, texte visible
 *     (innerText), nombre d'encadrés, hauteur, débordement horizontal ;
 *     captures pleine page + zoom de chaque zone, NOMS STABLES (identiques en
 *     phase avant / après). Mesures écrites dans
 *     `resultats/ux/<phase>/mesures-<projet>.json`.
 *  2. CIBLE UX : assertions de la règle UX premium. Elles échouent sur le code
 *     actuel → `attenduAvantCorrection` (test.fail en BANC_PHASE=avant), et
 *     doivent réussir telles quelles en BANC_PHASE=apres.
 *
 * Sélecteurs par TEXTE et par RÔLE uniquement (les data-attributs changeront
 * peut-être avec la refonte UX). Une zone absente est mesurée `present:false`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, attenduAvantCorrection, choisirParcours, PHASE, DOSSIER_RESULTATS } from './fixtures';

const DOSSIER_MESURES = path.join(DOSSIER_RESULTATS, 'ux', PHASE);

/** Brief récurrent comparable à la capture utilisateur (cap_1.png). */
const BRIEF = {
  objectif: 'motiver', message: 'Chaque petit pas compte', public: 'Personnes qui veulent se lancer',
  cta: 'Commence aujourd’hui', duree: 30, rythme: 'dynamique',
};

/**
 * Une zone = un texte d'ancrage (regex, source + drapeaux) et la façon de
 * remonter au conteneur : `encadre` (premier ancêtre bordé), `paragraphe`
 * (premier <p>/<li>/<div> bloc), `fixe` (ancêtre position:fixed), ou `commun`
 * (plus petit ancêtre commun à toutes les ancres), `titre-parent` (l'ancre est
 * un titre h1–h4, la zone est son conteneur direct).
 */
type Remontee = 'encadre' | 'paragraphe' | 'fixe' | 'commun' | 'titre-parent';
interface DefZone { nom: string; ancres: string[]; remontee: Remontee }

/** Titre de la colonne d'aperçu : « Exemple de style » (banc) ou « Aperçu du style — exemple » (prod). */
const TITRE_COLONNE = '^(Exemple de style|Aperçu du style)';
/** Zones structurelles : leur absence est un défaut du banc, pas un effet de l'épuration. */
const ZONES_STRUCTURELLES = ['colonne-apercu', 'brief-recap', 'montage-prevu'];

const ZONES_ETAPE_1: DefZone[] = [
  { nom: 'colonne-apercu', ancres: [TITRE_COLONNE], remontee: 'titre-parent' },
  { nom: 'mention-style', ancres: ['textes et affiche d.exemple'], remontee: 'paragraphe' },
  // `paragraphe` (et non `encadre`) : depuis l'épuration, l'indice est une ligne SANS encadré ; remonter
  // au premier ancêtre bordé mesurerait toute la carte d'aperçu. Avant, la phrase était déjà dans un <p>.
  { nom: 'aide-double-clic', ancres: ['Double-cliquez un élément'], remontee: 'paragraphe' },
  { nom: 'brief-recap', ancres: ['^Ce que dira chaque vidéo$'], remontee: 'encadre' },
];
const ZONES_ETAPE_2: DefZone[] = [
  { nom: 'colonne-apercu', ancres: [TITRE_COLONNE], remontee: 'titre-parent' },
  { nom: 'mention-style', ancres: ['textes et affiche d.exemple'], remontee: 'paragraphe' },
  { nom: 'duree-estimee-sources', ancres: ['^Durée estimée : la voix'], remontee: 'paragraphe' },
  { nom: 'duree-estimee-apercu', ancres: ['^Durée estimée — séquence'], remontee: 'paragraphe' },
  { nom: 'medias-reels', ancres: ['Médias réels du plan'], remontee: 'paragraphe' },
  // `paragraphe` (et non `encadre`) : depuis l'épuration, l'indice est une ligne SANS encadré ; remonter
  // au premier ancêtre bordé mesurerait toute la carte d'aperçu. Avant, la phrase était déjà dans un <p>.
  { nom: 'aide-double-clic', ancres: ['Double-cliquez un élément'], remontee: 'paragraphe' },
  { nom: 'montage-prevu', ancres: ['^Aperçu (du|de mon) montage'], remontee: 'encadre' },
];

interface MesureZone {
  nom: string; present: boolean; caracteres: number; encadres: number; hauteur: number; largeur: number;
  debordeZone: boolean; conteneursDebordants: string[]; horsEcran: number; iconesSansAction: number;
  boutonsInfo: Array<{ label: string; expanded: string | null; controls: string | null }>; emojis: string[];
}

/** Repère les zones dans la page (attribut `data-banc-zone`) et les mesure. */
async function mesurerZones(page: Page, zones: DefZone[]): Promise<{ page: { scrollWidth: number; clientWidth: number; deborde: boolean }; zones: MesureZone[] }> {
  return page.evaluate((defs) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
    };
    const borde = (el: Element) => {
      const s = getComputedStyle(el);
      const largeurs = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map((v) => parseFloat(v) || 0);
      const nb = largeurs.filter((w) => w >= 1).length;
      const couleurVisible = !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(s.borderTopColor + s.borderLeftColor);
      const r = el.getBoundingClientRect();
      // Tailwind `ring-1` = box-shadow « 0 0 0 1px » : un encadré aussi.
      const anneau = (s.boxShadow || '').split(/,(?![^(]*\))/).some((seg) => /0px 0px 0px [1-9]/.test(seg) && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(seg));
      return ((nb >= 3 && couleurVisible) || anneau) && r.width > 40 && r.height > 20;
    };
    /** Élément le plus profond, visible, dont le texte correspond. */
    const ancre = (motif: string, selecteur = 'body *'): HTMLElement | null => {
      const re = new RegExp(motif, 'i');
      let meilleur: HTMLElement | null = null;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selecteur))) {
        if (!visible(el) || el.closest('[data-banc-ignorer]')) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || !re.test(t)) continue;
        if (!meilleur || meilleur.contains(el)) meilleur = el;
      }
      return meilleur;
    };
    document.querySelectorAll('[data-banc-zone]').forEach((e) => e.removeAttribute('data-banc-zone'));
    const resultat: MesureZone[] = [];
    for (const d of defs) {
      const ancres = d.ancres.map((a) => ancre(a, d.remontee === 'titre-parent' ? 'h1, h2, h3, h4' : 'body *')).filter((x): x is HTMLElement => !!x);
      let zone: HTMLElement | null = null;
      if (ancres.length === d.ancres.length) {
        if (d.remontee === 'titre-parent') {
          zone = ancres[0].parentElement;
        } else if (d.remontee === 'commun') {
          zone = ancres[0];
          while (zone && !ancres.every((a) => zone!.contains(a))) zone = zone.parentElement;
        } else if (d.remontee === 'paragraphe') {
          zone = ancres[0].closest('p, li') as HTMLElement | null ?? ancres[0];
        } else if (d.remontee === 'fixe') {
          let e: HTMLElement | null = ancres[0];
          while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement;
          zone = e;
        } else {
          let e: HTMLElement | null = ancres[0];
          while (e && !borde(e)) e = e.parentElement;
          zone = e;
        }
      }
      if (!zone || zone === document.body) {
        resultat.push({ nom: d.nom, present: false, caracteres: 0, encadres: 0, hauteur: 0, largeur: 0, debordeZone: false, conteneursDebordants: [], horsEcran: 0, iconesSansAction: 0, boutonsInfo: [], emojis: [] });
        continue;
      }
      zone.setAttribute('data-banc-zone', d.nom);
      const r = zone.getBoundingClientRect();
      const tous = [zone, ...Array.from(zone.querySelectorAll<HTMLElement>('*'))].filter(visible);
      const debordants: string[] = [];
      let horsEcran = 0;
      for (const el of tous) {
        const s = getComputedStyle(el);
        const defile = /auto|scroll/.test(s.overflowX);
        if (!defile && el.scrollWidth > el.clientWidth + 1 && s.overflowX === 'visible' && el.clientWidth > 0) {
          debordants.push(`${el.tagName.toLowerCase()}.${(el.className && typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 3).join('.')} (${el.scrollWidth}>${el.clientWidth})`);
        }
        const rr = el.getBoundingClientRect();
        const dansDefilant = el.parentElement?.closest('*') && (() => { let p: HTMLElement | null = el.parentElement; while (p && p !== zone) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true; p = p.parentElement; } return false; })();
        if (!dansDefilant && (rr.right > window.innerWidth + 1 || rr.left < -1)) horsEcran += 1;
      }
      const icones = Array.from(zone.querySelectorAll('svg')).filter(visible);
      const iconesSansAction = icones.filter((svg) => {
        if (svg.closest('[data-banc-zone] video, canvas')) return false;
        const action = svg.closest('button, a, [role="button"], summary, label, input');
        // Une icône accompagnant le libellé d'un bouton est une action ; seule, hors action = décorative.
        return !action;
      }).length;
      const boutonsInfo = Array.from(zone.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter(visible)
        .filter((b) => /info|aide|détail|detail|en savoir|explication|comment/i.test(b.getAttribute('aria-label') || ''))
        .map((b) => ({ label: b.getAttribute('aria-label') || '', expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls') }));
      const texte = (zone.innerText || '').replace(/\s+/g, ' ').trim();
      const emojis = Array.from(new Set(texte.match(/\p{Extended_Pictographic}/gu) ?? []));
      resultat.push({
        nom: d.nom, present: true, caracteres: texte.length,
        encadres: tous.filter(borde).length, hauteur: Math.round(r.height), largeur: Math.round(r.width),
        debordeZone: zone.scrollWidth > zone.clientWidth + 1 && !/auto|scroll/.test(getComputedStyle(zone).overflowX),
        conteneursDebordants: debordants.slice(0, 10), horsEcran, iconesSansAction, boutonsInfo, emojis,
      });
    }
    const de = document.documentElement;
    return { page: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, deborde: de.scrollWidth > de.clientWidth + 1 }, zones: resultat };
  }, zones);
}

/** Capture pleine page + zoom de chaque zone présente (noms stables). */
async function capturerZones(page: Page, banc: { capture: (p: Page, n: string, o?: { fullPage?: boolean; locator?: import('playwright/test').Locator }) => Promise<string> }, etape: string, mesures: MesureZone[]) {
  await banc.capture(page, `ux-${etape}-page`, { fullPage: true });
  for (const z of mesures) {
    if (!z.present) continue;
    const loc = page.locator(`[data-banc-zone="${z.nom}"]`).first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await banc.capture(page, `ux-${etape}-zone-${z.nom}`, { locator: loc }).catch(() => {});
  }
}

function ecrireMesures(projet: string, cle: string, valeur: unknown) {
  fs.mkdirSync(DOSSIER_MESURES, { recursive: true });
  const f = path.join(DOSSIER_MESURES, `mesures-${projet}.json`);
  let o: Record<string, unknown> = {};
  try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { o = {}; }
  o[cle] = valeur;
  o.phase = PHASE;
  o.projet = projet;
  fs.writeFileSync(f, JSON.stringify(o, null, 2));
}

async function ouvrirEtape1(page: Page, banc: { etat: { autopilotConfig: Record<string, unknown> | null } }): Promise<void> {
  banc.etat.autopilotConfig = { ...(banc.etat.autopilotConfig ?? {}), brief: BRIEF };
  await choisirParcours(page, 'autopilote');
  await page.goto('/dashboard/creer');
  await page.getByRole('button', { name: 'Motivation', exact: true }).click();
  await expect(page.getByText('Ce que dira chaque vidéo').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

async function ouvrirEtape2(page: Page, banc: { etat: { autopilotConfig: Record<string, unknown> | null } }): Promise<void> {
  await ouvrirEtape1(page, banc);
  await page.getByRole('button', { name: /Continuer vers Rushes/ }).click();
  await page.getByRole('checkbox', { name: /Mon avatar/ }).check();
  await page.getByRole('checkbox', { name: /Médias suggérés/ }).check();
  await expect(page.getByText('Vidéo suggérée').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
}

/** Simule `beforeinstallprompt` (Chromium headless ne l'émet pas) ; la bannière apparaît 1 s après. */
async function provoquerInvitationInstallation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(1600);
}

const banniere = (page: Page) => page.getByText('Installer Studiio', { exact: true });

const ZONE_BANNIERE: DefZone = { nom: 'banniere-installation', ancres: ['^Installer Studiio$'], remontee: 'fixe' };

test.describe('UX Autopilote — mesures et captures', () => {
  test('étape 1 (Sujets) : mesures et captures par zone', async ({ page, banc }) => {
    await ouvrirEtape1(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_1);
    ecrireMesures(test.info().project.name, 'etape1', m);
    test.info().annotations.push({ type: 'mesures-etape1', description: JSON.stringify(m) });
    await capturerZones(page, banc, 'etape1', m.zones);
    // Garde-fou du banc : les zones doivent être trouvées (sinon les mesures sont vides).
    expect(m.zones.filter((z) => !z.present && ZONES_STRUCTURELLES.includes(z.nom)).map((z) => z.nom), 'zones structurelles introuvables').toEqual([]);
  });

  test('étape 2 (Rushes) : mesures et captures par zone', async ({ page, banc }) => {
    await ouvrirEtape2(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_2);
    ecrireMesures(test.info().project.name, 'etape2', m);
    test.info().annotations.push({ type: 'mesures-etape2', description: JSON.stringify(m) });
    await capturerZones(page, banc, 'etape2', m.zones);
    expect(m.zones.filter((z) => !z.present && ZONES_STRUCTURELLES.includes(z.nom)).map((z) => z.nom), 'zones structurelles introuvables').toEqual([]);
  });

  test('bannière « Installer Studiio » : mesures et captures', async ({ page, banc }) => {
    await ouvrirEtape1(page, banc);
    await provoquerInvitationInstallation(page);
    await expect(banniere(page)).toBeVisible();
    const m = await mesurerZones(page, [ZONE_BANNIERE]);
    ecrireMesures(test.info().project.name, 'banniere', m);
    await banc.capture(page, 'ux-banniere-page');
    await banc.capture(page, 'ux-banniere-zone', { locator: page.locator('[data-banc-zone="banniere-installation"]') });
  });
});

test.describe('UX Autopilote — cible UX premium', () => {
  test('aucun débordement horizontal (page et zones)', async ({ page, banc }) => {
    await ouvrirEtape2(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_2);
    expect(m.page.deborde, `page : scrollWidth ${m.page.scrollWidth} > clientWidth ${m.page.clientWidth}`).toBe(false);
    for (const z of m.zones.filter((x) => x.present)) {
      expect.soft(z.debordeZone, `zone ${z.nom} déborde`).toBe(false);
      expect.soft(z.horsEcran, `zone ${z.nom} : éléments hors écran`).toBe(0);
    }
  });

  test('aucun pictogramme emoji / caractère symbole dans les zones (icônes SVG seulement)', async ({ page, banc }) => {
    attenduAvantCorrection('« ▶ pour les lire dans l’ordre » : caractère pictographique dans la mention de l’aperçu');
    await ouvrirEtape2(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_2);
    const trouves = m.zones.filter((z) => z.emojis.length).map((z) => `${z.nom}: ${z.emojis.join(' ')}`);
    test.info().annotations.push({ type: 'emojis', description: trouves.join(' | ') || 'aucun' });
    expect(trouves).toEqual([]);
  });

  test('colonne d’aperçu : texte d’aide visible court (≤ 160 caractères)', async ({ page, banc }) => {
    attenduAvantCorrection('mention « Aperçu du style », « Médias réels du plan » et encart « Double-cliquez » affichés en entier (capture utilisateur cap_0/cap_1)');
    await ouvrirEtape2(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_2);
    const aide = m.zones.filter((z) => ['mention-style', 'duree-estimee-apercu', 'medias-reels', 'aide-double-clic'].includes(z.nom) && z.present);
    const total = aide.reduce((s, z) => s + z.caracteres, 0);
    test.info().annotations.push({ type: 'aide-visible-caracteres', description: String(total) });
    expect(total, 'caractères d’aide visibles sous l’aperçu').toBeLessThanOrEqual(160);
  });

  test('colonne d’aperçu : au plus un encadré d’aide (pas d’encadré inutile)', async ({ page, banc }) => {
    attenduAvantCorrection('encart « Double-cliquez un élément » toujours visible en plus des mentions');
    await ouvrirEtape2(page, banc);
    // Cible : l'explication du double-clic n'est plus un encart permanent — elle vit derrière l'icône info.
    // Sélecteur ciblé sur la phrase LONGUE du grand encadré : une ligne-indice courte
    // (≤ 50 caractères, sans encadré) reste permise — le double-clic est la seule porte
    // vers police / taille / icône et doit rester découvrable.
    const encart = page.getByText(/Double-cliquez un élément — titre, CTA ou carte/).first();
    expect(await encart.isVisible().catch(() => false), 'encart « Double-cliquez » visible sans action').toBe(false);
    const indice = page.getByText(/^Double-cliquez un élément/).first();
    if (await indice.isVisible().catch(() => false)) {
      const t = (await indice.innerText()).trim();
      expect(t.length, 'indice double-clic court').toBeLessThanOrEqual(50);
      const borde = await indice.evaluate((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderTopWidth) >= 1 || parseFloat(s.borderLeftWidth) >= 1;
      });
      expect(borde, 'indice double-clic sans encadré').toBe(false);
    }
  });

  test('« Ce que dira chaque vidéo » : synthèse courte, la note détaillée derrière une icône', async ({ page, banc }) => {
    attenduAvantCorrection('note « La narration exacte… rien n’est généré ni facturé ici » toujours visible (capture cap_1)');
    await ouvrirEtape1(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_1);
    const brief = m.zones.find((z) => z.nom === 'brief-recap')!;
    test.info().annotations.push({ type: 'brief-recap', description: JSON.stringify(brief) });
    expect(brief.present).toBe(true);
    expect(brief.caracteres, 'texte visible du récapitulatif').toBeLessThanOrEqual(260);
    expect(brief.boutonsInfo.length, 'icône info avec aria-label').toBeGreaterThan(0);
  });

  test('icônes : aucune icône décorative isolée dans les zones (règle 7)', async ({ page, banc }) => {
    attenduAvantCorrection('icônes Info / Film / MousePointerClick décoratives devant les textes d’aide');
    await ouvrirEtape2(page, banc);
    const m = await mesurerZones(page, ZONES_ETAPE_2.filter((z) => z.nom !== 'colonne-apercu' && z.nom !== 'montage-prevu'));
    const deco = m.zones.filter((z) => z.present).map((z) => [z.nom, z.iconesSansAction] as const);
    test.info().annotations.push({ type: 'icones-decoratives', description: JSON.stringify(deco) });
    for (const [nom, n] of deco) expect.soft(n, `icônes sans action dans ${nom}`).toBe(0);
    expect(deco.every(([, n]) => n === 0)).toBe(true);
  });

  test('icône info de l’aperçu : aria-label, s’ouvre au clavier (Entrée), se ferme avec Échap', async ({ page, banc }) => {
    attenduAvantCorrection('aucune icône info cliquable dans la colonne d’aperçu (texte toujours affiché)');
    await ouvrirEtape2(page, banc);
    await mesurerZones(page, ZONES_ETAPE_2.slice(0, 1));
    const colonne = page.locator('[data-banc-zone="colonne-apercu"]');
    const info = colonne.getByRole('button', { name: /info|aide|détail|en savoir|explication|comment/i }).first();
    await expect(info, 'bouton info de l’aperçu (aria-label)').toBeVisible({ timeout: 5_000 });
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await info.focus();
    await page.keyboard.press('Enter');
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    const idPanneau = await info.getAttribute('aria-controls');
    const panneau = idPanneau ? page.locator(`[id="${idPanneau}"]`) : page.getByRole('dialog').or(page.getByRole('tooltip')).first();
    await expect(panneau).toBeVisible();
    // Le détail est consultable dans le popover (rien de perdu).
    await expect(panneau).toContainText(/exemple|double-cliquez|médias/i);
    await banc.capture(page, 'ux-etape2-popover-info-ouvert');
    await page.keyboard.press('Escape');
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await expect(panneau).toBeHidden();
    // Espace rouvre aussi (bouton natif ou rôle button complet).
    await info.focus();
    await page.keyboard.press('Space');
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
  });

  test('bannière « Installer Studiio » : entièrement dans l’écran, bouton Fermer atteignable', async ({ page, banc }) => {
    // Constat avant : au téléphone (390 px) la bannière déborde à droite et le bouton Fermer sort de l'écran.
    if (test.info().project.name === 'telephone') attenduAvantCorrection('bannière d’installation plus large que l’écran au téléphone : bouton Fermer hors écran');
    await ouvrirEtape1(page, banc);
    await provoquerInvitationInstallation(page);
    await expect(banniere(page)).toBeVisible();
    const zone = page.locator('div.fixed', { has: banniere(page) }).last();
    const fermer = zone.getByRole('button', { name: /Fermer/i });
    const boite = await fermer.boundingBox();
    const largeur = page.viewportSize()!.width;
    test.info().annotations.push({ type: 'bouton-fermer', description: JSON.stringify({ boite, largeur }) });
    expect(boite, 'bouton Fermer rendu').not.toBeNull();
    expect(boite!.x + boite!.width, 'bouton Fermer dans l’écran').toBeLessThanOrEqual(largeur);
    const m = await mesurerZones(page, [ZONE_BANNIERE]);
    expect(m.zones[0].horsEcran, 'aucun élément de la bannière hors écran').toBe(0);
  });

  test('bannière « Installer Studiio » : la fermeture est mémorisée après rechargement', async ({ page, banc }) => {
    attenduAvantCorrection('PWAInstallPrompt : `dismissedRef` en mémoire seulement — la bannière revient à chaque chargement');
    await ouvrirEtape1(page, banc);
    await provoquerInvitationInstallation(page);
    await expect(banniere(page)).toBeVisible();
    const zone = page.locator('div.fixed', { has: banniere(page) }).last();
    await zone.getByRole('button', { name: /Fermer/i }).click();
    await expect(banniere(page)).toBeHidden();
    await page.reload();
    await page.waitForTimeout(1500);
    await provoquerInvitationInstallation(page);
    await banc.capture(page, 'ux-banniere-apres-rechargement');
    const revenue = await banniere(page).isVisible().catch(() => false);
    test.info().annotations.push({ type: 'banniere-revenue-apres-rechargement', description: String(revenue) });
    expect(revenue, 'la bannière fermée ne revient pas après rechargement').toBe(false);
  });
});
