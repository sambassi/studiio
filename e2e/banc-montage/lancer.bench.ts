/**
 * BANC DE MONTAGE — compare, sur des rushs RÉELS déposés dans `medias/`, le montage
 * A (sans fiche) et B (avec fiche de scènes) d'Autopilote et de Créer, et produit des
 * MP4 à visionner À L'AVEUGLE (étiquettes neutres ; la clé est dans `resultats/cle-*.json`).
 *
 *   npx vitest run --config e2e/banc-montage/vitest.banc.config.ts
 *   BANC_MEDIAS=/autre/dossier  pour pointer ailleurs.
 *
 * ⚠️ NE MODIFIE RIEN du moteur ni de l'application. Aucun appel réseau ni fournisseur :
 * les fiches de scènes (B) sont LUES dans `fiches/<rush>.json` ; s'il n'y en a pas, B est
 * simplement omis. Les mesures automatiques sont des GARDE-FOUS : seul le visionnage humain
 * (grille `resultats/grille-modele.csv`) juge la qualité.
 */
import { it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { mesurerSourceLue } from '@/lib/creer/analyse-rush-serveur';
import { planMontage, dureePlan, PROTECTION_PAROLE_PAR_DEFAUT, type AnalyseRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import { analysesAvecScenes, type FicheScenes } from '@/lib/creer/fiche-scenes';
import { validerAnnotation, mesuresContreReference, type AnnotationRush } from './annotations';
import { scenariosPrets, codesAveugles, type ScenarioBanc } from './scenarios';

const RACINE = resolve(__dirname);
const MEDIAS = process.env.BANC_MEDIAS ? resolve(process.env.BANC_MEDIAS) : join(RACINE, 'medias');
const SORTIE = process.env.BANC_SORTIE ? resolve(process.env.BANC_SORTIE) : join(RACINE, 'resultats');
const lireJson = <T>(f: string): T | null => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return null; } };

function sonder(fichier: string): { duree: number; audio: boolean } | null {
  const d = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { encoding: 'utf8' });
  const a = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', fichier], { encoding: 'utf8' });
  const duree = parseFloat(d.stdout);
  return Number.isFinite(duree) && duree > 0 ? { duree, audio: a.stdout.trim().length > 0 } : null;
}

/** Rend le plan en MP4 9:16 540×960, son d'origine des rushs (silence si le rush n'en a pas). */
function rendre(plan: Array<{ fichier: string; depuis: number; jusqua: number; audio: boolean }>, sortie: string): boolean {
  const entrees: string[] = []; const filtres: string[] = [];
  plan.forEach((s, i) => {
    entrees.push('-ss', String(s.depuis), '-to', String(s.jusqua), '-i', s.fichier);
    const d = s.jusqua - s.depuis;
    filtres.push(`[${i}:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}]`);
    filtres.push(s.audio ? `[${i}:a]aresample=44100,apad,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]` : `anullsrc=r=44100:cl=stereo,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const liste = plan.map((_, i) => `[v${i}][a${i}]`).join('');
  filtres.push(`${liste}concat=n=${plan.length}:v=1:a=1[v][a]`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...entrees, '-filter_complex', filtres.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sortie], { encoding: 'utf8' });
  return r.status === 0;
}

it('banc de montage', async () => {
  mkdirSync(SORTIE, { recursive: true });
  const { scenarios } = lireJson<{ scenarios: ScenarioBanc[] }>(join(RACINE, 'scenarios.json'))!;
  const { prets, ignores } = scenariosPrets(scenarios, (f) => existsSync(join(MEDIAS, f)));
  const rapport: Record<string, unknown> = { date: new Date().toISOString(), medias: MEDIAS, ignores, scenarios: {} as Record<string, unknown> };
  for (const s of prets) {
    const sondes = s.rushs.map((r) => sonder(join(MEDIAS, r)));
    if (sondes.some((x) => !x)) { (rapport.ignores as unknown[]).push({ id: s.id, manquants: ['fichier illisible par ffprobe'] }); continue; }
    const analyses: AnalyseRush[] = [];
    for (let i = 0; i < s.rushs.length; i++) {
      const a = await mesurerSourceLue('banc:' + s.rushs[i], join(MEDIAS, s.rushs[i]), sondes[i]!.duree);
      if (a) analyses.push(a);
    }
    if (analyses.length < 2) { (rapport.ignores as unknown[]).push({ id: s.id, manquants: ['analyse impossible (moins de 2 rushs lisibles)'] }); continue; }
    const annotations: Record<string, AnnotationRush> = {}; const avertissements: string[] = [];
    s.rushs.forEach((r, i) => {
      const a = lireJson<AnnotationRush>(join(RACINE, 'annotations', r.replace(/\.[^.]+$/, '') + '.json'));
      if (!a) return;
      const err = validerAnnotation(a, sondes[i]!.duree);
      if (err.length) avertissements.push(`${r} : annotation ignorée — ${err.join(' ; ')}`); else annotations[r] = a;
    });
    const fiches: Record<string, FicheScenes> = {};
    for (const r of s.rushs) {
      const f = lireJson<FicheScenes>(join(RACINE, 'fiches', r.replace(/\.[^.]+$/, '') + '.json'));
      if (f) fiches['banc:' + r] = { ...f, url: 'banc:' + r };
    }
    const avecFiches = Object.keys(fiches).length === s.rushs.length;
    if (!avecFiches) avertissements.push('B omis : une fiche de scènes par rush est nécessaire (fiches/<rush>.json, format fiche-scenes.ts).');
    const parcours: Array<[string, OptionsMontage]> = [
      ['autopilote', { netteteCommune: true }], // son des rushs coupé par défaut ⇒ pas de protection de la parole
      ['creer', { uniciteParTimecode: true, netteteCommune: true, protectionParole: PROTECTION_PAROLE_PAR_DEFAUT }],
    ];
    const methodes: Array<[string, AnalyseRush[]]> = [['A', analyses], ...(avecFiches ? [['B', analysesAvecScenes(analyses, fiches, true)] as [string, AnalyseRush[]]] : [])];
    const combos = parcours.flatMap(([p]) => methodes.map(([m]) => `${p}-${m}`));
    const codes = codesAveugles(s.id, combos.length);
    const cle: Record<string, string> = {}; const lignes: unknown[] = [];
    let k = 0;
    for (const [p, opts] of parcours) for (const [m, an] of methodes) {
      const plan = planMontage(an, s.cibleSecondes, { ...opts, contexte: { theme: s.theme, objectif: s.objectif } }) ?? [];
      const code = codes[k++]; cle[code] = `${p}-${m}`;
      const seg = plan.map((x) => ({ rush: x.url.replace('banc:', ''), depuis: x.depuis ?? 0, jusqua: x.jusqua ?? 0 }));
      const rendu = plan.length ? rendre(seg.map((x) => ({ fichier: join(MEDIAS, x.rush), depuis: x.depuis, jusqua: x.jusqua, audio: sondes[s.rushs.indexOf(x.rush)]!.audio })), join(SORTIE, `${s.id}-${code}.mp4`)) : false;
      lignes.push({
        code, parcours: p, methode: m, rendu, duree: dureePlan(plan), dureeRendue: rendu ? sonder(join(SORTIE, `${s.id}-${code}.mp4`))?.duree ?? null : null, matiereMontee: Math.round(seg.reduce((t, x) => t + (x.jusqua - x.depuis), 0) * 100) / 100, cible: s.cibleSecondes, extraits: plan.length, rushs: new Set(seg.map((x) => x.rush)).size,
        reference: Object.keys(annotations).length ? mesuresContreReference(seg, annotations) : null,
        extraitsDetail: seg.map((x) => `${x.rush}@${x.depuis}-${x.jusqua}`),
      });
    }
    writeFileSync(join(SORTIE, `cle-${s.id}.json`), JSON.stringify({ avertissement: 'NE PAS OUVRIR avant d’avoir noté les vidéos à l’aveugle.', cle }, null, 1));
    (rapport.scenarios as Record<string, unknown>)[s.id] = { avertissements, annotes: Object.keys(annotations), lignes };
  }
  writeFileSync(join(SORTIE, 'auto.json'), JSON.stringify(rapport, null, 1));
  console.log(`[banc-montage] ${prets.length} scénario(s) prêt(s), ${ignores.length} ignoré(s) — résultats : ${SORTIE}`);
  console.log(readdirSync(SORTIE).join(' '));
}, 1_800_000);
