/**
 * Démo AUTOPILOTE « rushes personnels » — variante de `autopilote-motivation.ts` : les 3 rushes du
 * banc (e2e/banc/medias/rush-1..3, qui portent une COUPE ou une image FIGÉE de leur source en tête :
 * rush-1 coupe à 0,43 s, rush-2 coupe à 0,3 s, rush-3 figé 0–0,63 s) + les 3 médias stock retenus,
 * SANS avatar (défaut) ou AVEC (`DEMO_AVATAR=1`).
 *
 *   npx --no-install tsx --env-file=.env.local e2e/banc/rendus/autopilote-rushes.ts [dossierSortie]
 *
 * Mêmes fonctions que `produireUnMontage` (branche multi-sources, src/lib/autopilot/produire.ts) :
 * analyse des rushes = `mesurerSourceLue` (le cœur d'`analyserRushServeurCache`, sur le fichier local),
 * rythme = `analyserRythme` (le cœur d'`analyserMusiqueServeur`), `cibleSequenceSansAvatar`,
 * `rythmeSurFenetre`, `planMultiSources` / `planMontageAvatar`, `planOverlays`, mise en page, rendu
 * hybride / Remotion. Simulé comme la démo Motivation : HeyGen, sondes réseau, stock Pexels.
 * Sorties : autopilote-rushes[-avatar].mp4, *-plan.json (segments : source, fichier, depuis, durée), *-bilan.json.
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
import { planMontageAvatar, pertinencesAutopilote, contexteMontageAutopilote, type ContexteTextesAutopilote } from '@/lib/autopilot/montage-avatar';
import { planMultiSources, cibleSequenceSansAvatar, matiereSansAvatar } from '@/lib/autopilot/plan-multi-sources';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { dureePlanRendu, verifierDureeRendu } from '@/lib/autopilot/produire';
import { profilMontageDuContexte, mesuresSegments, dureePlan, type AnalyseRush } from '@/lib/creer/smart-montage';
import { mesurerSourceLue } from '@/lib/creer/analyse-rush-serveur';
import { analyserRythme, rythmeSurFenetre } from '@/lib/creer/rythme-musique';
import { planOverlays, profilEnSurimpression, type OverlaysMontage } from '@/lib/creer/overlays';
import { rapportPlan } from '@/lib/creer/smart-montage-regles';
import { appliquerMiseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { zoneCalmeSortie } from '@/lib/creer/zone-calme';
import { controleQualite } from '@/lib/creer/quality-gate';
import { rushsDuPlan } from '@/lib/creer/multi-rush';
import { versEntreeRemotion } from '@/lib/render/spec-rendu';

const RACINE = path.resolve(__dirname, '../../..');
const BANC = path.join(RACINE, 'e2e/banc/medias');
const MEDIAS = path.join(BANC, 'demo');
const SORTIE = path.resolve(process.argv[2] || path.join(RACINE, 'e2e/banc/resultats/demos'));
const AVATAR = process.env.DEMO_AVATAR === '1';
const NOM = AVATAR ? 'autopilote-rushes-avatar' : 'autopilote-rushes';
const USER_ID = '00000000-0000-4000-8000-000000000000';
const JOB_ID = `demo-${NOM}-${Date.now()}`;
const RUSHS = ['rush-1.mp4', 'rush-2.mp4', 'rush-3.mp4'];

function duree(fichier: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { encoding: 'utf8' }).trim());
}
const fichierLocal = (nom: string) => (fs.existsSync(path.join(MEDIAS, nom)) ? path.join(MEDIAS, nom) : path.join(BANC, nom));

function servir(): Promise<{ base: string; fermer: () => void }> {
  const types: Record<string, string> = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    const f = fichierLocal(path.basename(decodeURIComponent((req.url || '/').split('?')[0])));
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
  for (const f of [...RUSHS, 'avatar-motivation.mp4', 'stock-ecriture.mp4', 'stock-muscu.mp4', 'stock-torse.mp4', 'musique.mp3']) {
    if (!fs.existsSync(fichierLocal(f))) throw new Error(`média manquant : ${f} — lancer preparer-medias.sh puis preparer-demos.sh`);
  }
  fs.mkdirSync(SORTIE, { recursive: true });
  const { base, fermer } = await servir();
  const url = (f: string) => `${base}/${f}`;
  const versLocal = new Map<string, string>();
  const urlStockage = (f: string, nom: string) => {
    const u = `https://studiio.pro/storage/v1/object/public/media/${USER_ID}/${nom}`;
    versLocal.set(u, url(f));
    return u;
  };
  const fichierDe = (u: string) => fichierLocal(path.basename(versLocal.get(u) ?? u));
  try {
    const stock: MediaStockRetenu[] = [
      ['stock-ecriture.mp4', 'hand-writing-motivation-word-with-brush-pen-on-paper-5527758'],
      ['stock-muscu.mp4', 'man-lifting-dumbbells-in-a-gym-4761426'],
      ['stock-torse.mp4', 'black-and-white-shirtless-man-crossing-arms-6455987'],
    ].map(([f, slug], i) => ({
      url: urlStockage(f, `stock-pexels-video-${9100 + i}.mp4`), type: 'video' as const, provider: 'pexels' as const, providerAssetId: String(9100 + i),
      auteur: `Auteur Pexels ${i + 1}`, sourceUrl: `https://www.pexels.com/video/${slug}/`, licence: 'Licence Pexels',
      vignetteUrl: url(f), sujet: 'Motivation',
    }));
    // Rushes personnels : adresses « de notre stockage », au dossier du compte (le rush du créneau en tête).
    const rushUrls = RUSHS.map((f) => urlStockage(f, f));
    const config = sanitizeConfig({
      enabled: true, mode: 'review', cadence: 'weekly', countPerCycle: 1, platforms: [], creditFloor: 50,
      rushUrls, topics: ['Motivation'], runTimezone: 'Europe/Paris', publishTime: '18:00',
      voiceEnabled: false, jumeauAvatar: AVATAR, ...(AVATAR ? { jumeauAvatarId: '11111111-1111-4111-8111-111111111111' } : {}),
      cardGradientStart: '#7C3AED', cardGradientEnd: '#EC4899', titleColor: '#FFFFFF', cardsShowPoster: false,
      musicUrl: url('musique.mp3'), keepRushAudio: false, musicVolume: 0.3, voiceVolume: 1, rushVolume: 0.5,
      posterUrls: [], posterMode: 'auto', brief: { duree: 30 },
      designStyle: { sources: { actives: { rushes: true, avatar: AVATAR, stock: true }, stock, gabarit: [] } },
    });
    const [post] = preparePosts({ config, topic: 'Motivation', count: 1, now: Date.parse('2026-10-20T08:00:00Z'), seeds: [2] });
    const sourcesCfg = sourcesEffectives(config);
    const medias = mediasDesSources(config);
    const jumeauVideoUrl = AVATAR ? url('avatar-motivation.mp4') : null;
    const jumeauSeconds = AVATAR ? duree(fichierLocal('avatar-motivation.mp4')) : null;

    // ── Analyse des rushes (produire.ts : `analyserRushServeurCache`, un rush après l'autre) ──
    const secondesRush = rushUrls.map((u) => duree(fichierDe(u)));
    const analysesRushs: AnalyseRush[] = [];
    for (const [i, u] of rushUrls.entries()) {
      const a = await mesurerSourceLue(u, fichierDe(u), secondesRush[i]);
      if (a) analysesRushs.push(a);
    }
    const designBase = buildAutopilotDesign(post, {
      posterUrl: null, rushSeconds: secondesRush[0], voices: {}, config,
      ...(AVATAR ? { jumeau: { videoUrl: jumeauVideoUrl as string, seconds: jumeauSeconds as number } } : {}),
    });
    const videosOk = medias.videosStock;
    const photosOk = medias.photosStock;
    const rushes = rushUrls.map((u, i) => ({ url: u, secondes: secondesRush[i] }));
    const stockVideos = videosOk.map((u) => ({ url: u, secondes: duree(fichierDe(u)) }));
    const contexteTextes: ContexteTextesAutopilote = {
      sujets: sujetsCourants(config), titre: post.title, sousTitre: post.content?.subtitle ?? null,
      objectif: post.brief?.objectif ?? null, message: post.brief?.message ?? null, cta: post.brief?.cta ?? null,
      cartes: post.content?.cards ?? [],
    };
    const contexteMontage = contexteMontageAutopilote(contexteTextes);
    const profilVideo = profilMontageDuContexte(contexteMontage).profil;
    const gabarit = gabaritSuggere({ avatar: AVATAR, rushes: rushes.length, stock: videosOk.length + photosOk.length }, { dureeSecondes: post.brief?.duree, rythme: post.brief?.rythme });
    const pertinences = pertinencesAutopilote(sourcesCfg.sources.stock.filter((m) => videosOk.includes(m.url) || photosOk.includes(m.url)), contexteTextes);
    let res: ReturnType<typeof planMultiSources>;
    let overlays: OverlaysMontage | null = null;
    let rythmeVideo: ReturnType<typeof rythmeSurFenetre> | null = null;
    if (AVATAR) {
      const m = planMontageAvatar({
        avatar: { url: jumeauVideoUrl as string, secondes: jumeauSeconds as number }, dureeVisee: post.brief?.duree ?? null,
        rushes, analyses: analysesRushs, stockVideos, photos: photosOk,
        gabarit, pertinences, profil: profilVideo, titre: post.title, cartes: designBase.cards ?? [],
        options: { contexte: contexteMontage, plagesExclues: null },
      });
      res = m.res;
      overlays = m.overlays;
    } else {
      const enSurimpression = profilEnSurimpression(profilVideo);
      const cible = cibleSequenceSansAvatar({
        brief: post.brief, design: designBase, enSurimpression, voixAPorter: 0,
        matiere: matiereSansAvatar({ rushes, stockVideos, photos: photosOk }),
      });
      // analyserMusiqueServeur, sur le fichier local (même décodage : mono 11 025 Hz, f32).
      const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-t', '240', '-i', fichierLocal('musique.mp3'), '-vn', '-ac', '1', '-ar', '11025', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
      const rythme = analyserRythme(new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4)), 11025);
      const debutVideo = enSurimpression ? 0 : (designBase.introDuration ?? 0) + (designBase.cardsDuration ?? 0);
      rythmeVideo = rythmeSurFenetre(rythme, debutVideo, cible);
      res = planMultiSources({
        rushes, analyses: analysesRushs, stockVideos, photos: photosOk, gabarit, cible, pertinences,
        options: { rythme: rythmeVideo, contexte: contexteMontage, plagesExclues: null },
      });
      if (res.plan.length && enSurimpression) {
        overlays = planOverlays({
          duree: res.duree, profil: profilVideo, nbCartes: designBase.cards?.length ?? 0,
          finHook: res.plan.filter((x) => x.phase === 'HOOK').at(-1)?.fin ?? null,
          voix: { titre: 0, cartes: 0, video: 0, cta: 0 },
        });
      }
    }
    const plan = res.plan;
    if (!plan.length) throw new Error(`plan vide : ${res.explications.join(' / ')}`);
    let design: typeof designBase = {
      ...designBase,
      montage: plan,
      rushs: rushsDuPlan(plan.filter((x) => x.kind !== 'image' && x.kind !== 'avatar')),
      videoDuration: dureePlan(plan),
      ...(overlays ? { surimpressions: overlays, introDuration: 0, cardsDuration: 0, ctaDuration: 0 } : {}),
      videoUrl: designBase.videoUrl ?? plan[0].url,
      ...(AVATAR ? {
        videoUrl: jumeauVideoUrl as string, rushMuted: true, sequenceVoiceUrls: { video: jumeauVideoUrl as string },
        ...(res.debutCloture !== null && res.debutCloture > 0 ? { finVoixJumeauS: res.debutCloture } : {}),
      } : {}),
    };
    const zoneCta = overlays?.cta ? zoneCalmeSortie(plan, analysesRushs, overlays.cta[0]) : null;
    if (overlays) design = sansLisibiliteCtaAction(design, config.designStyle?.cta?.scale);
    if (overlays) design = appliquerMiseEnPageSurimpression(design, profilVideo, { ctaBande: zoneCta?.bande, avatar: plan.some((x) => x.kind === 'avatar') });
    const ms = mesuresSegments(plan, analysesRushs);
    const qualite = controleQualite({
      profil: profilVideo, mesures: ms, rapport: ms ? rapportPlan(profilVideo, ms, rythmeVideo) : null, overlays,
      cartes: post.content.cards ?? [], cta: { texte: design.ctaText ?? '', sousTexte: design.ctaSubText ?? null },
      ctaUtilisateur: post.brief?.cta ?? null, voixTitre: false, antiGels: true,
    });
    const segments = plan.map((s) => ({
      kind: s.kind, source: s.source, fichier: path.basename(versLocal.get(s.url) ?? s.url),
      debut: s.debut, fin: s.fin, depuis: s.depuis, duree: Math.round((s.fin - s.debut) * 1000) / 1000, phase: s.phase,
    }));
    fs.writeFileSync(path.join(SORTIE, `${NOM}-plan.json`), JSON.stringify({
      avatar: AVATAR, profil: profilVideo, gabarit, explications: res.explications, dureePlan: dureePlanRendu(design),
      analyses: analysesRushs.map((a) => ({ fichier: path.basename(versLocal.get(a.url) ?? a.url), duree: a.duree, echantillons: a.echantillons.map((e) => [e.t, Math.round(e.mouvement * 1e4) / 1e4]) })),
      segments, surimpressions: overlays, qualite: qualite.map(({ code, ok, detail }) => ({ code, ok, detail })),
    }, null, 2));
    console.log(`[demo] ${NOM} — ${segments.length} plans, ${dureePlan(plan)} s`);
    for (const s of segments) console.log(`[demo]   ${s.debut.toFixed(2)}–${s.fin.toFixed(2)}  ${s.source}:${s.fichier} depuis ${s.depuis ?? 0} (${s.duree} s) ${s.phase ?? ''}`);

    let brut = JSON.stringify(design);
    for (const [u, l] of versLocal) brut = brut.split(u).join(l);
    design = JSON.parse(brut);
    fs.writeFileSync(path.join(SORTIE, `${NOM}-props.json`), JSON.stringify(versEntreeRemotion(design as never), null, 2));

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
    const sortie = path.join(SORTIE, `${NOM}.mp4`);
    fs.copyFileSync(rendu.outputPath, sortie);
    fs.rmSync(rendu.outputPath, { force: true });
    const verif = verifierDureeRendu(dureePlanRendu(design), duree(sortie));
    const bilan = { moteur, raisonHybride: raison, renduMs: Date.now() - t0, images: rendu.durationFrames, verifDuree: verif, sortie };
    fs.writeFileSync(path.join(SORTIE, `${NOM}-bilan.json`), JSON.stringify(bilan, null, 2));
    console.log(`[demo] ${JSON.stringify(bilan)}`);
  } finally {
    fermer();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
