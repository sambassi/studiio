/**
 * Démo CRÉER « LE SPORT LE PLUS COMPLET » — composition RÉELLE par le compositeur navigateur
 * (video-composer, Chromium complet), dans le banc isolé.
 *
 *   DEMO_SORTIE=/chemin/demos BANC_PORT=3200 npx playwright test -c e2e/banc/playwright.banc.config.ts \
 *     e2e/banc/demo-creer.spec.ts --project ordinateur
 *
 * Cas réel rejoué : brouillon RESTAURÉ sans `versionLisibilite` (retombe en v1), titre + sous-titre,
 * 5 cartes du brouillon de l'utilisateur, 3 rushes (SPORT 9–13 s, 13–17 s, 21–26 s), voix-off par
 * séquence (mp3 local), musique locale, CTA « JE ME LANCE » / « RÉSERVE TON COURS D'ESSAI », 9:16.
 * Le PUT du blob est intercepté (fixtures) → .webm sur disque ; la conversion MP4 se fait hors test
 * (voir e2e/banc/rendus/README.md).
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect, DOSSIER_RESULTATS, media } from './fixtures';
import { ouvrirCreer, allerA, choisirFormat, sonder } from './parcours';

const SORTIE = process.env.DEMO_SORTIE || path.join(DOSSIER_RESULTATS, 'demos');
/** Format du projet : 9:16 (défaut, fichiers `creer-sport.*`), 1:1 ou 16:9 (`creer-sport-1x1.*`, `creer-sport-16x9.*`). */
const FORMAT = (process.env.DEMO_FORMAT || '9:16') as '9:16' | '1:1' | '16:9';
/** `DEMO_CARTES=longues` : 5 cartes aux titres longs (lisibilité 16:9 / 1:1), fichiers `…-longues.*`. */
const LONGUES = process.env.DEMO_CARTES === 'longues';
/**
 * `DEMO_STYLE=minimaliste|sport|cinematique` : le style vidéo est CHOISI dans la galerie de
 * l'étape Style (un clic, comme l'utilisateur) après la restauration ; fichiers `…-style-<id>.*`.
 */
const STYLE = process.env.DEMO_STYLE || '';
const SUFFIXE = (FORMAT === '9:16' ? '' : `-${FORMAT.replace(':', 'x')}`) + (LONGUES ? '-longues' : '') + (STYLE ? `-style-${STYLE}` : '');

const CARTES = [
  { title: 'CARDIO COMPLET', value: '3-en-1', description: 'Danser fait travailler le cœur, le souffle et l’endurance en même temps.', icon: 'HeartPulse' },
  { title: 'OS RENFORCÉS', value: '+2 %/an', description: 'Les sauts et appuis densifient les os.', icon: 'Bone' },
  { title: 'ANTI-ÂGE', value: '-10 ans', description: 'Coordination et mémoire entretenues à chaque cours.', icon: 'Sparkles' },
  { title: '300+ MUSCLES', value: '300+', description: 'Tout le corps est sollicité, du gainage aux mollets.', icon: 'Dumbbell' },
  { title: 'RISQUE RÉDUIT', value: '-76 %', description: 'Moins de risques cardio-vasculaires avec une pratique régulière.', icon: 'ShieldCheck' },
];
const CARTES_LONGUES = [
  { title: 'MÉLATONINE NATURELLE', value: '+30 %', description: 'Un sommeil plus profond.', icon: 'Moon' },
  { title: 'RENFORCEMENT MUSCULAIRE', value: '300+', description: 'Tout le corps travaille.', icon: 'Dumbbell' },
  { title: 'ENDURANCE CARDIOVASCULAIRE', value: '-76 %', description: 'Le cœur se renforce.', icon: 'HeartPulse' },
  { title: 'CONCENTRATION AMÉLIORÉE', value: '+2 %/an', description: 'La mémoire est entretenue.', icon: 'Brain' },
  { title: 'IMMUNITÉ RENFORCÉE', value: '-10 ans', description: 'Moins de fatigue.', icon: 'ShieldCheck' },
];
const VOIX: Record<string, string> = {
  titre: 'Le sport le plus complet ? La danse.',
  cartes: 'Cardio complet, os renforcés, effet anti-âge, plus de trois cents muscles et un risque réduit.',
  video: 'Danser active plus de muscles que la plupart des sports.',
  cta: 'Je me lance : réserve ton cours d’essai.',
};

test('démo Créer « LE SPORT LE PLUS COMPLET » → webm réel', async ({ page, context, banc }, info) => {
  test.skip(info.project.name !== 'ordinateur', 'démo rendue une fois (ordinateur)');
  test.setTimeout(900_000);
  fs.mkdirSync(SORTIE, { recursive: true });
  const webm = path.join(SORTIE, `creer-sport${SUFFIXE}.webm`);
  fs.rmSync(webm, { force: true });
  banc.etat.fichierRendu = webm;
  // Journal console COMPLET (plan de montage, compositeur) : la preuve du plan réellement rendu.
  const journal = path.join(SORTIE, `creer-console${SUFFIXE}.log`);
  fs.writeFileSync(journal, '');
  page.on('console', (m) => { try { fs.appendFileSync(journal, `${m.text()}\n`); } catch { /* */ } });

  // 1) Un brouillon NATUREL, produit par l'interface (structure exacte de la version courante).
  await ouvrirCreer(page);
  await allerA(page, 'Style');
  await choisirFormat(page, FORMAT);
  await allerA(page, 'Audio');
  await allerA(page, 'Contenu');
  await page.getByRole('button', { name: /Générer toutes les voix TTS/ }).click();
  await expect(page.getByRole('button', { name: /Générer toutes les voix TTS/ })).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  // Clé du brouillon (`draftKey`) : préfixe + identifiant de session, lue telle que l'app l'a écrite.
  await expect.poll(() => page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('studiio_creer_simple_draft')).length), { timeout: 15_000 }).toBeGreaterThan(0);
  const [cle, brut] = await page.evaluate(() => {
    const k = Object.keys(window.localStorage).filter((x) => x.startsWith('studiio_creer_simple_draft'))
      .sort((a, b) => b.length - a.length)[0];
    return [k, window.localStorage.getItem(k)] as const;
  });
  test.info().annotations.push({ type: 'cle-brouillon', description: cle });
  expect(brut, 'brouillon écrit par l’interface').toBeTruthy();
  const initial = JSON.parse(brut as string) as Record<string, any>;
  fs.writeFileSync(path.join(SORTIE, `creer-brouillon-initial${SUFFIXE}.json`), JSON.stringify(initial, null, 2));

  // 2) Le brouillon de l'utilisateur : contenu, médias, audio — SANS `versionLisibilite` (cas réel).
  const d: Record<string, any> = { ...initial };
  delete d.versionLisibilite;
  const ids = (initial.generated?.cards ?? []).map((c: { id: string }) => c.id);
  d.started = true;
  d.step = 3;
  d.format = FORMAT;
  d.customTopic = 'Le sport le plus complet';
  d.generated = {
    title: 'LE SPORT LE PLUS COMPLET',
    subtitle: 'Danser active plus de muscles que la plupart des sports',
    cards: (LONGUES ? CARTES_LONGUES : CARTES).map((c, i) => ({ id: ids[i] ?? `carte-demo-${i + 1}`, ...c })),
    cta: 'JE ME LANCE',
    ctaSub: 'RÉSERVE TON COURS D’ESSAI',
  };
  d.posterUrl = media('demo-affiche.jpg');
  d.rushUrl = media('demo-rush-1.mp4');
  d.rushName = 'SPORT 9–13 s';
  d.rushIsClip = false;
  d.rushSecondes = 4;
  d.rushSuivants = [
    { url: media('demo-rush-2.mp4'), name: 'SPORT 13–17 s', secondes: 4 },
    { url: media('demo-rush-3.mp4'), name: 'SPORT 21–26 s', secondes: 5 },
  ];
  delete d.mediasVideo;
  d.musicUrl = media('musique.mp3');
  d.musicName = 'Musique (banc)';
  const sv = (initial.sequenceVoices ?? {}) as Record<string, Record<string, unknown>>;
  d.sequenceVoices = Object.fromEntries(Object.entries(VOIX).map(([k, texte]) => [k, {
    ...(sv[k] ?? {}), text: texte, textAtGeneration: texte, audioUrl: media(`demo-voix-${k}.mp3`), source: 'tts',
  }]));
  // Séquence Vidéo ACTIVE (le brouillon de départ, sans rush, l'avait coupée à 0 s) ; durées d'une vraie
  // narration (voix : titre 6 s, cartes 14 s, vidéo 12 s, CTA 4,5 s).
  d.sequences = [
    { key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: true }, { key: 'cta', enabled: true },
  ];
  d.introDuration = 6;
  d.cardsDuration = 14;
  d.videoDuration = 13;
  d.ctaDuration = 4.5;
  d.sequenceVoicesUserEdited = { titre: true, cartes: true, video: true, cta: true };
  d.savedAt = Date.now();
  fs.writeFileSync(path.join(SORTIE, `creer-brouillon-restaure${SUFFIXE}.json`), JSON.stringify(d, null, 2));

  // 3) Restauration : posé AVANT les scripts de la page (après le `pagehide` qui réécrit l'ancien).
  await context.addInitScript(({ k, v }) => {
    try {
      if (!window.sessionStorage.getItem('demo-brouillon-pose')) {
        window.localStorage.setItem(k, v);
        window.sessionStorage.setItem('demo-brouillon-pose', '1');
      }
    } catch { /* */ }
  }, { k: cle, v: JSON.stringify(d) });
  await page.goto('/dashboard/creer');
  const creer = page.getByRole('button', { name: 'Créer une vidéo' });
  if (await creer.isVisible({ timeout: 5_000 }).catch(() => false)) await creer.click();
  await expect(page.getByText(/Brouillon restauré/).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await banc.capture(page, 'demo-creer-1-restaure', { fullPage: true });

  if (STYLE) {
    await page.getByRole('button', { name: 'Aller à l’étape Style' }).first().click();
    await page.waitForTimeout(800);
    const carte = page.locator(`[data-style-video="${STYLE}"] button[aria-pressed]`).first();
    await carte.click();
    await expect(carte).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1500);
    await banc.capture(page, `demo-creer-1b-style-${STYLE}`, { fullPage: true });
    await page.getByRole('button', { name: 'Aller à l’étape Contenu' }).first().click();
    await page.waitForTimeout(800);
  }

  // 4) Envoi → brouillon → composition réelle.
  await allerA(page, 'Envoi');
  await page.getByRole('button', { name: /Garder en brouillon/ }).click();
  await banc.capture(page, 'demo-creer-2-envoi', { fullPage: true });
  await page.getByRole('button', { name: /Composer et envoyer/ }).click();
  await page.waitForTimeout(5000);
  // Matière insuffisante : l'app propose « Continuer avec N s » ou « Ajouter des rushes ». L'utilisateur
  // réel a continué : on fait pareil, et on garde la proposition en preuve.
  const continuer = page.getByRole('button', { name: /^Continuer avec/ });
  if (await continuer.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await banc.capture(page, 'demo-creer-3a-raccourci');
    test.info().annotations.push({ type: 'raccourci', description: (await continuer.textContent()) ?? '' });
    await continuer.click();
  }
  await page.waitForTimeout(3000);
  await banc.capture(page, 'demo-creer-3-composition');
  await expect.poll(() => banc.etat.rendus.length + banc.etat.posts.length, { timeout: 800_000, intervals: [3000] }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(2500);
  await banc.capture(page, 'demo-creer-4-fin', { fullPage: true });
  expect(fs.existsSync(webm)).toBe(true);
  const mesure = sonder(webm);
  const post = banc.etat.posts[0] as Record<string, unknown>;
  fs.writeFileSync(path.join(SORTIE, `creer-post${SUFFIXE}.json`), JSON.stringify(post, null, 2));
  test.info().annotations.push({ type: 'webm', description: `${webm} ${JSON.stringify(mesure)}` });
  expect(mesure.images ?? 0, 'le montage contient des images').toBeGreaterThan(10);
});
