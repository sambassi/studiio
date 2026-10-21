/**
 * #613 — APERÇU vs RENDU sur la démo Motivation : la parole PRÉVUE par l'aperçu
 * (avant tout rendu) contre la parole MESURÉE du rendu (24,682 s).
 *
 *   npx --no-install tsx e2e/banc/rendus/apercu-parole-motivation.ts [rendu.json] [sortie.json]
 *
 * PUR : aucun réseau, aucun fournisseur, aucune base. Mêmes entrées que la démo
 * (`autopilote-motivation.ts`) ; l'aperçu est calculé EXACTEMENT comme l'écran
 * (`AutopilotPanel` : échantillon → `scriptJumeauMontage` → `paroleAvatarPrevue`
 * → `planCompletAutopilote`). Le rendu de référence est relu dans
 * `plan-apercu-vs-rendu.json` (sortie de la démo), sinon recalculé à parole mesurée.
 *
 * Trois aperçus : AVANT (budget du script, l'ancienne règle), APRÈS sans
 * calibrage (script réel, débit par défaut), APRÈS calibré (débit du compte
 * appris d'un rendu PRÉCÉDENT : le script de production de ce post et sa parole
 * mesurée — ce que `metadata.paroleEstimation` enregistre désormais).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';
import { sourcesEffectives, sujetsCourants, avatarAvecAutresSources, type MediaStockRetenu } from '@/lib/autopilot/sources';
import { planCompletAutopilote, paroleAvatarDuBudget, paroleAvatarPrevue, type PlanComplet } from '@/lib/autopilot/plan-complet';
import { contexteDeLEchantillon } from '@/lib/autopilot/montage-avatar';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { buildAutopilotSample, postDeLEchantillon } from '@/lib/autopilot/sample';
import { scriptJumeauMontage } from '@/lib/autopilot/script-jumeau';
import { secondesReserveesEnveloppeJumeau } from '@/lib/autopilot/duree-cible';
import { debitCalibre, caracteresParole, estimerParoleAvatar } from '@/lib/autopilot/debit-parole';

const PAROLE_MESUREE = 24.682;
const USER_ID = '00000000-0000-4000-8000-000000000000';
const RENDU = process.argv[2];
const SORTIE = process.argv[3] || path.resolve('e2e/banc/resultats/demos/apercu-vs-rendu-parole.json');

const stock: MediaStockRetenu[] = [
  ['hand-writing-motivation-word-with-brush-pen-on-paper-5527758', 4],
  ['man-lifting-dumbbells-in-a-gym-4761426', 3],
  ['black-and-white-shirtless-man-crossing-arms-6455987', 3],
].map(([slug], i) => ({
  url: `https://studiio.pro/storage/v1/object/public/media/${USER_ID}/stock-pexels-video-${9100 + i}.mp4`,
  type: 'video' as const, provider: 'pexels' as const, providerAssetId: String(9100 + i),
  auteur: `Auteur Pexels ${i + 1}`, sourceUrl: `https://www.pexels.com/video/${slug}/`, licence: 'Licence Pexels',
  vignetteUrl: 'x', sujet: 'Motivation',
}));
const dureesStock = [4, 3, 3];
const config = sanitizeConfig({
  enabled: true, mode: 'review', cadence: 'weekly', countPerCycle: 1, platforms: [], creditFloor: 50,
  rushUrls: [], topics: ['Motivation'], runTimezone: 'Europe/Paris', publishTime: '18:00',
  voiceEnabled: false, jumeauAvatar: true, jumeauAvatarId: '11111111-1111-4111-8111-111111111111',
  posterUrls: [], posterMode: 'auto', brief: { duree: 30 },
  designStyle: { sources: { actives: { rushes: false, avatar: true, stock: true }, stock, gabarit: [] } },
});
const sourcesCfg = sourcesEffectives(config);
const urlsStock = sourcesCfg.sources.stock.map((m) => m.url);
const durees = Object.fromEntries(urlsStock.map((u, i) => [u, dureesStock[i]]));

// ── Le rendu PRÉCÉDENT du compte (calibrage) : le script de production de ce post, et sa parole mesurée.
const [post] = preparePosts({ config, topic: 'Motivation', count: 1, now: Date.parse('2026-10-20T08:00:00Z'), seeds: [2] });
const scriptRendu = scriptJumeauMontage(post, config);
const debitCompte = debitCalibre([{ caracteres: caracteresParole(scriptRendu), mesureeS: PAROLE_MESUREE }]);

// ── L'APERÇU, comme l'écran : l'échantillon, son script, sa parole.
const echantillon = buildAutopilotSample({ topics: config.topics, brief: config.brief });
const scriptApercu = scriptJumeauMontage(postDeLEchantillon(echantillon, config.brief), config);
const contexte = contexteDeLEchantillon(echantillon, sujetsCourants(config), config.brief);
const seul = !avatarAvecAutresSources(config);
const reserve = seul ? secondesReserveesEnveloppeJumeau(config.brief?.duree) : 0;
const resume = {
  gabarit: gabaritSuggere({ avatar: true, rushes: 0, stock: urlsStock.length }, { dureeSecondes: config.brief.duree, rythme: config.brief.rythme }),
  actives: { rushes: false, stock: true, avatar: true }, rushesPerso: [], stock: sourcesCfg.sources.stock,
  avatar: { disponible: true, vignette: null },
};
const options = { cible: config.brief.duree ?? 30, rythme: config.brief.rythme ?? null, durees, dureeVisee: config.brief.duree ?? null, contexte };
const apercu = (secondesAvatarEstimees: number | null) => planCompletAutopilote(resume, { ...options, secondesAvatarEstimees });

const avant = apercu(paroleAvatarDuBudget(config.brief, reserve));
const sansCalibrage = apercu(paroleAvatarPrevue({ script: scriptApercu, brief: config.brief, secondesReservees: reserve }));
const calibre = apercu(paroleAvatarPrevue({ script: scriptApercu, brief: config.brief, secondesReservees: reserve, debitCompte }));

type Rendu = Pick<PlanComplet, 'parole' | 'duree' | 'debutCloture' | 'cta' | 'segments'>;
const rendu: Rendu = RENDU && fs.existsSync(RENDU)
  ? (JSON.parse(fs.readFileSync(RENDU, 'utf8')) as { rendu: Rendu }).rendu
  : planCompletAutopilote(resume, { ...options, secondesAvatar: PAROLE_MESUREE });

const r3 = (n: number) => Math.round(n * 1000) / 1000;
function comparer(a: PlanComplet) {
  const memeOrdre = a.segments.length === rendu.segments.length
    && a.segments.every((s, i) => s.genre === rendu.segments[i].genre && s.role === rendu.segments[i].role);
  const ecarts = memeOrdre ? a.segments.map((s, i) => Math.max(Math.abs(s.debut - rendu.segments[i].debut), Math.abs(s.fin - rendu.segments[i].fin))) : [];
  return {
    parole: a.parole, duree: a.duree, debutCloture: a.debutCloture, cta: a.cta,
    cloture: a.debutCloture !== null,
    memeOrdreEtRoles: memeOrdre,
    ecartMaxSegmentsS: memeOrdre ? r3(Math.max(...ecarts)) : null,
    ecartParoleS: a.parole === null || rendu.parole === null ? null : r3(a.parole - rendu.parole),
    ecartDebutClotureS: a.debutCloture === null || rendu.debutCloture === null ? null : r3(a.debutCloture - rendu.debutCloture),
    ecartCtaS: a.cta && rendu.cta ? r3(Math.max(Math.abs(a.cta[0] - rendu.cta[0]), Math.abs(a.cta[1] - rendu.cta[1]))) : null,
    segments: a.segments.map(({ genre, role, debut, fin }) => ({ genre, role, debut, fin })),
  };
}

const sortie = {
  paroleMesureeRendu: PAROLE_MESUREE,
  scripts: {
    apercu: { texte: scriptApercu, caracteres: caracteresParole(scriptApercu) },
    renduPrecedent: { texte: scriptRendu, caracteres: caracteresParole(scriptRendu) },
  },
  debit: { defaut: estimerParoleAvatar(scriptApercu, {}).debit, compte: debitCompte },
  rendu: { parole: rendu.parole, duree: rendu.duree, debutCloture: rendu.debutCloture, cta: rendu.cta, segments: rendu.segments.map(({ genre, role, debut, fin }) => ({ genre, role, debut, fin })) },
  avant_budget: comparer(avant),
  apres_script_debit_defaut: comparer(sansCalibrage),
  apres_script_debit_compte: comparer(calibre),
};
fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
fs.writeFileSync(SORTIE, JSON.stringify(sortie, null, 2));
for (const k of ['avant_budget', 'apres_script_debit_defaut', 'apres_script_debit_compte'] as const) {
  const c = sortie[k];
  console.log(`${k}: parole ${c.parole} (écart ${c.ecartParoleS}), clôture ${c.cloture}, ordre ${c.memeOrdreEtRoles}, écart segments ${c.ecartMaxSegmentsS}, CTA ${c.ecartCtaS}`);
}
console.log(`→ ${SORTIE}`);
