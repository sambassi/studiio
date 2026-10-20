/**
 * Démo AUTOPILOTE « Motivation » — rendu par le VRAI moteur serveur (Remotion / hybride ffmpeg),
 * à partir de props construites par les MÊMES fonctions que `produireUnMontage`
 * (src/lib/autopilot/produire.ts, branche « jumeau + multi-sources », l. 405–930).
 *
 *   npx --no-install tsx e2e/banc/rendus/autopilote-motivation.ts [dossierSortie]
 *
 * SIMULÉ (aucun réseau, aucune écriture DB / stockage, src/ intact) :
 *  - vidéo HeyGen du jumeau  → e2e/banc/medias/demo/avatar-motivation.mp4 (passages réels d'avatar, 24,68 s) ;
 *  - médias stock Pexels     → stock-ecriture / stock-muscu / stock-torse.mp4 (servis en http://127.0.0.1) ;
 *  - sondes réseau (probeRushSeconds, mesurerDureeJumeau, sonderMediaStock) → ffprobe local ;
 *  - jumeauPleinCadre, proxys de rendu, localiserEntreesRendu, uploadToStorage, insertion du post,
 *    débit → NON appelés (aucun effet de bord) ;
 *  - affiche Pexels (pickPosterUrl) → aucune : non utilisée en surimpression avatar.
 * RÉEL : preparePosts (smart-content, graine 2 = cartes du MP4 de l'utilisateur), sanitizeConfig,
 *  sourcesEffectives/mediasDesSources, buildAutopilotDesign, gabaritSuggere, scenarioPertinence,
 *  pertinencesPourPlan, narrationDesSurimpressions, planOverlays, planMultiSources, sansLisibiliteCtaAction,
 *  appliquerMiseEnPageSurimpression, controleQualite, dureePlanRendu, raisonNonEligibleHybride,
 *  rendreHybride / renderCreerSimple (bundle Remotion réel, Chromium réel).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

import { sanitizeConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { sansLisibiliteCtaAction } from '@/lib/autopilot/cta-action';
import { sourcesEffectives, mediasDesSources, sujetsCourants, type MediaStockRetenu } from '@/lib/autopilot/sources';
import { narrationDesSurimpressions, pertinencesPourPlan, scenarioPertinence } from '@/lib/autopilot/pertinence-medias';
import { planMultiSources } from '@/lib/autopilot/plan-multi-sources';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { dureePlanRendu, verifierDureeRendu } from '@/lib/autopilot/produire';
import { profilMontageDuContexte, mesuresSegments, dureePlan } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';
import { appliquerMiseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { zoneCalmeSortie } from '@/lib/creer/zone-calme';
import { controleQualite } from '@/lib/creer/quality-gate';
import { rushsDuPlan } from '@/lib/creer/multi-rush';
import { versEntreeRemotion } from '@/lib/render/spec-rendu';

const RACINE = path.resolve(__dirname, '../../..');
const MEDIAS = path.join(RACINE, 'e2e/banc/medias/demo');
const SORTIE = path.resolve(process.argv[2] || path.join(RACINE, 'e2e/banc/resultats/demos'));
const USER_ID = '00000000-0000-4000-8000-000000000000';
const JOB_ID = `demo-autopilote-motivation-${Date.now()}`;

function duree(fichier: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { encoding: 'utf8' }).trim());
}

/** Petit serveur de médias local (Range pris en charge) : Remotion / ffmpeg lisent en http. */
function servir(): Promise<{ base: string; fermer: () => void }> {
  const types: Record<string, string> = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    const nom = path.basename(decodeURIComponent((req.url || '/').split('?')[0]));
    const f = path.join(MEDIAS, nom);
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    const taille = fs.statSync(f).size;
    const type = types[path.extname(f)] ?? 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ''));
    if (m) {
      const debut = m[1] ? Number(m[1]) : 0;
      const fin = m[2] ? Math.min(Number(m[2]), taille - 1) : taille - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${debut}-${fin}/${taille}`, 'Content-Length': fin - debut + 1, 'Access-Control-Allow-Origin': '*' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(f, { start: debut, end: fin }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': taille, 'Access-Control-Allow-Origin': '*' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as AddressInfo;
    r({ base: `http://127.0.0.1:${port}`, fermer: () => srv.close() });
  }));
}

async function main() {
  for (const f of ['avatar-motivation.mp4', 'stock-ecriture.mp4', 'stock-muscu.mp4', 'stock-torse.mp4']) {
    if (!fs.existsSync(path.join(MEDIAS, f))) throw new Error(`média manquant : ${f} — lancer sh e2e/banc/rendus/preparer-demos.sh`);
  }
  fs.mkdirSync(SORTIE, { recursive: true });
  const { base, fermer } = await servir();
  const url = (f: string) => `${base}/${f}`;
  // Adresses « de notre stockage », comme après /api/stock/importer : seules acceptées par la garde SSRF
  // (`urlStockAutorisee`). Jamais contactées : remplacées par le serveur local juste avant le rendu
  // (rôle de `sonderMediaStock` → `urlsFinalesStock` et de `localiserEntreesRendu`).
  const versLocal = new Map<string, string>();
  const urlStockage = (f: string, id: number) => {
    const u = `https://studiio.pro/storage/v1/object/public/media/${USER_ID}/stock-pexels-video-${id}.mp4`;
    versLocal.set(u, url(f));
    return u;
  };
  const fichierDe = (u: string) => path.join(MEDIAS, path.basename(versLocal.get(u) ?? u));
  try {
    // ── Entrées « utilisateur » : sujet Motivation, 30 s, avatar + 3 médias stock retenus ──
    const stock: MediaStockRetenu[] = [
      ['stock-ecriture.mp4', 'hand-writing-motivation-word-with-brush-pen-on-paper-5527758'],
      ['stock-muscu.mp4', 'man-lifting-dumbbells-in-a-gym-4761426'],
      ['stock-torse.mp4', 'black-and-white-shirtless-man-crossing-arms-6455987'],
    ].map(([f, slug], i) => ({
      url: urlStockage(f, 9100 + i), type: 'video' as const, provider: 'pexels' as const, providerAssetId: String(9100 + i),
      auteur: `Auteur Pexels ${i + 1}`, sourceUrl: `https://www.pexels.com/video/${slug}/`, licence: 'Licence Pexels',
      vignetteUrl: url(f), sujet: 'Motivation',
    }));
    const config = sanitizeConfig({
      enabled: true, mode: 'review', cadence: 'weekly', countPerCycle: 1, platforms: [], creditFloor: 50,
      rushUrls: [], topics: ['Motivation'], runTimezone: 'Europe/Paris', publishTime: '18:00',
      voiceEnabled: false, jumeauAvatar: true, jumeauAvatarId: '11111111-1111-4111-8111-111111111111',
      cardGradientStart: '#7C3AED', cardGradientEnd: '#EC4899', titleColor: '#FFFFFF', cardsShowPoster: false,
      musicUrl: null, keepRushAudio: false, musicVolume: 0.3, voiceVolume: 1, rushVolume: 0.5,
      posterUrls: [], posterMode: 'auto', brief: { duree: 30 },
      designStyle: { sources: { actives: { rushes: false, avatar: true, stock: true }, stock, gabarit: [] } },
    });
    // Graine 2 : mêmes cartes que le MP4 de l'utilisateur (ancré / boucle / proc / dopa).
    const [post] = preparePosts({ config, topic: 'Motivation', count: 1, now: Date.parse('2026-10-20T08:00:00Z'), seeds: [2] });

    // ── Copie de produireUnMontage, branche jumeau + multi-sources ──
    const sourcesCfg = sourcesEffectives(config);
    const medias = mediasDesSources(config);
    const jumeauVideoUrl = url('avatar-motivation.mp4');
    const jumeauSeconds = duree(path.join(MEDIAS, 'avatar-motivation.mp4')); // tient lieu de mesurerDureeJumeau (parole HeyGen)
    const designBase = buildAutopilotDesign(post, {
      posterUrl: null, rushSeconds: null, voices: {}, config,
      jumeau: { videoUrl: jumeauVideoUrl, seconds: jumeauSeconds },
    });
    const videosOk = medias.videosStock; // sonderMediaStock simulé : tous présents
    const photosOk = medias.photosStock;
    const stockVideos = videosOk.map((u) => ({ url: u, secondes: duree(fichierDe(u)) }));
    const contexteMontage = contexteMontageDepuis({
      theme: post.title, titre: post.title, sousTitre: post.content?.subtitle ?? null,
      objectif: [post.brief?.objectif, post.brief?.message].filter(Boolean).join(' ') || null,
      cartes: post.content?.cards ?? [],
    });
    const profilVideo = profilMontageDuContexte(contexteMontage).profil;
    const gabarit = gabaritSuggere({ avatar: true, rushes: 0, stock: videosOk.length + photosOk.length }, { dureeSecondes: post.brief?.duree, rythme: post.brief?.rythme });
    const cartesPost = post.content?.cards ?? [];
    const scenario = scenarioPertinence({
      sujets: [...sujetsCourants(config), post.brief?.objectif ?? null],
      textes: [post.title, post.content?.subtitle ?? null, post.brief?.message ?? null, post.brief?.cta ?? null,
        ...cartesPost.flatMap((c) => [c.title ?? null, c.description ?? null])],
    });
    const pertinences = pertinencesPourPlan(sourcesCfg.sources.stock.filter((m) => videosOk.includes(m.url) || photosOk.includes(m.url)), scenario);
    const T = jumeauSeconds;
    const narration = narrationDesSurimpressions(planOverlays({
      duree: T, profil: profilVideo, nbCartes: designBase.cards?.length ?? 0,
      finHook: Math.min(4, Math.max(2, T * 0.2)), voix: { video: T },
    }), { titre: post.title, cartes: designBase.cards ?? [] });
    const res = planMultiSources({
      avatar: { url: jumeauVideoUrl, secondes: T },
      rushes: [], analyses: [], stockVideos, photos: photosOk,
      gabarit, cible: T, pertinences, narration,
      options: { contexte: contexteMontage, plagesExclues: null },
    });
    if (!res.plan.length) throw new Error(`plan vide : ${res.explications.join(' / ')}`);
    const o = planOverlays({
      duree: res.duree, profil: profilVideo, nbCartes: designBase.cards?.length ?? 0,
      finHook: res.plan[0]?.kind === 'avatar' ? res.plan[0].fin : null, voix: { video: res.duree },
    });
    const overlays = { ...o, voix: { video: 0 } };
    const plan = res.plan;
    let design: typeof designBase = {
      ...designBase,
      montage: plan,
      rushs: rushsDuPlan(plan.filter((x) => x.kind !== 'image' && x.kind !== 'avatar')),
      videoDuration: dureePlan(plan),
      surimpressions: overlays, introDuration: 0, cardsDuration: 0, ctaDuration: 0,
      videoUrl: jumeauVideoUrl, rushMuted: true, sequenceVoiceUrls: { video: jumeauVideoUrl },
    };
    const zoneCta = overlays.cta ? zoneCalmeSortie(plan, [], overlays.cta[0]) : null;
    design = sansLisibiliteCtaAction(design, config.designStyle?.cta?.scale);
    design = appliquerMiseEnPageSurimpression(design, profilVideo, { ctaBande: zoneCta?.bande, avatar: plan.some((x) => x.kind === 'avatar') });
    const ms = mesuresSegments(plan, []);
    const qualite = controleQualite({
      profil: profilVideo, mesures: ms, rapport: ms ? rapportPlan(profilVideo, ms, null) : null, overlays,
      cartes: post.content.cards ?? [], cta: { texte: design.ctaText ?? '', sousTexte: design.ctaSubText ?? null },
      ctaUtilisateur: post.brief?.cta ?? null, voixTitre: !!overlays.voix?.titre, antiGels: true,
    });

    if (videosOk.length !== stock.length) console.warn(`[demo] stock retenu ${videosOk.length}/${stock.length} (garde SSRF ou pertinence)`);
    const plansLisibles = plan.map((s) => ({ kind: s.kind, source: s.source, fichier: path.basename(versLocal.get(s.url) ?? s.url), debut: s.debut, fin: s.fin, depuis: s.depuis, phase: s.phase, cadrage: (s as { cadrage?: number }).cadrage }));
    const diag = {
      jobId: JOB_ID, titre: design.title, sousTitre: design.subtitle, cartes: (design.cards ?? []).map((c) => ({ titre: c.title, valeur: c.value })),
      cta: design.ctaText, ctaSous: design.ctaSubText, profil: profilVideo, gabarit, pertinences, explications: res.explications,
      plan: plansLisibles, dureePlan: dureePlanRendu(design), surimpressions: overlays,
      qualite: qualite.map(({ code, ok, detail }) => ({ code, ok, detail })),
    };
    fs.writeFileSync(path.join(SORTIE, 'autopilote-motivation-plan.json'), JSON.stringify(diag, null, 2));
    // props.json = l'entrée EXACTE de la composition (rejouable par `npx remotion render`, serveur de médias requis).
    // Entrée du rendu : les adresses de stockage remplacées par le serveur local (aucun accès réseau).
    let brut = JSON.stringify(design);
    for (const [u, l] of versLocal) brut = brut.split(u).join(l);
    design = JSON.parse(brut);
    fs.writeFileSync(path.join(SORTIE, 'props.json'), JSON.stringify(versEntreeRemotion(design as never), null, 2));
    console.log(`[demo] plan ${plan.length} plans, ${dureePlan(plan)} s — ${plansLisibles.map((p) => `${p.kind}:${p.fichier}@${p.debut}-${p.fin}`).join(' | ')}`);
    console.log(`[demo] titre ${JSON.stringify(overlays.titre)} cartes ${JSON.stringify(overlays.cartes)} cta ${JSON.stringify(overlays.cta)}`);

    // ── Rendu : même enchaînement que renderAndUpload, sans localisation ni dépôt ──
    const { raisonNonEligibleHybride, rendreHybride } = await import('@/lib/render/hybride/rendu');
    const { renderCreerSimple } = await import('@/lib/render/creerSimple');
    let raison = raisonNonEligibleHybride(design as never);
    let moteur = 'REMOTION';
    let rendu: { outputPath: string; durationFrames: number } | null = null;
    const t0 = Date.now();
    if (raison === null) {
      try { rendu = await rendreHybride({ jobId: JOB_ID, userId: USER_ID, design: design as never }); moteur = 'HYBRID'; } catch (e) {
        moteur = 'REMOTION_FALLBACK'; raison = e instanceof Error ? e.message : String(e);
      }
    }
    console.log(`[demo] MOTEUR_RENDU=${moteur}${raison ? ` — ${raison}` : ''}`);
    if (!rendu) {
      let dernier = -1;
      rendu = await renderCreerSimple({
        jobId: JOB_ID, userId: USER_ID, design: design as never,
        onProgress: ({ progress }) => { const p = Math.floor(progress / 10) * 10; if (p !== dernier) { dernier = p; console.log(`[demo] rendu ${p} %`); } },
      });
    }
    const sortie = path.join(SORTIE, 'autopilote-motivation.mp4');
    fs.copyFileSync(rendu.outputPath, sortie);
    fs.rmSync(rendu.outputPath, { force: true });
    const verif = verifierDureeRendu(dureePlanRendu(design), duree(sortie));
    const bilan = { moteur, raisonHybride: raison, renduMs: Date.now() - t0, images: rendu.durationFrames, verifDuree: verif, sortie };
    fs.writeFileSync(path.join(SORTIE, 'autopilote-motivation-bilan.json'), JSON.stringify(bilan, null, 2));
    console.log(`[demo] ${JSON.stringify(bilan)}`);
  } finally {
    fermer();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
