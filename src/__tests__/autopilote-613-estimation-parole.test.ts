/**
 * #613 — APERÇU = EXPORT : la parole de l'avatar prévue par l'aperçu part du
 * SCRIPT RÉEL, au débit du compte s'il est calibré sur ses rendus précédents.
 */
import { describe, it, expect, vi } from 'vitest';

const requetes: Array<[string, unknown[]]> = [];
let reponse: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock('@/lib/db/supabase', () => {
  const chaine: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'not', 'order']) {
    chaine[m] = (...a: unknown[]) => { requetes.push([m, a]); return chaine; };
  }
  chaine.limit = async (...a: unknown[]) => { requetes.push(['limit', a]); return reponse; };
  return { supabaseAdmin: chaine, supabase: chaine };
});

import {
  caracteresParole, debitCalibre, echantillonDeMetadata, estimerParoleAvatar, paroleEstimationPourMetadata,
  ECHANTILLONS_PAROLE_MAX,
} from '@/lib/autopilot/debit-parole';
import { lireDebitParoleCompte } from '@/lib/autopilot/debit-parole-compte';
import { estimerParoleJumeau } from '@/lib/autopilot/durees-sequences';
import { paroleAvatarDuBudget, paroleAvatarPrevue, planCompletAutopilote } from '@/lib/autopilot/plan-complet';
import { sanitizeConfig } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';
import { sourcesEffectives, sujetsCourants, type MediaStockRetenu } from '@/lib/autopilot/sources';
import { contexteDeLEchantillon } from '@/lib/autopilot/montage-avatar';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { buildAutopilotSample, postDeLEchantillon } from '@/lib/autopilot/sample';
import { scriptJumeauMontage } from '@/lib/autopilot/script-jumeau';

describe('estimerParoleAvatar — la règle unique', () => {
  it('sans débit du compte : exactement `estimerParoleJumeau` (débit par défaut)', () => {
    for (const s of ['x'.repeat(106), 'Motivation. Une idée. Passe à l’action', '   ']) {
      for (const r of [null, 'calme', 'normal', 'dynamique'] as const) {
        const e = estimerParoleAvatar(s, { rythme: r });
        expect(e.secondes).toBe(estimerParoleJumeau(s, r));
        expect(e.methode).toBe('defaut');
      }
    }
  });
  it('avec débit du compte : caractères ÷ débit, quel que soit le rythme', () => {
    const e = estimerParoleAvatar('x'.repeat(244), { rythme: 'dynamique', debitCompte: 12.2 });
    expect(e).toEqual({ secondes: 20, caracteres: 244, debit: 12.2, methode: 'compte' });
  });
  it('débit du compte invraisemblable : ignoré', () => {
    expect(estimerParoleAvatar('x'.repeat(100), { debitCompte: 0 }).methode).toBe('defaut');
    expect(estimerParoleAvatar('x'.repeat(100), { debitCompte: 99 }).methode).toBe('defaut');
    expect(estimerParoleAvatar('x'.repeat(100), { debitCompte: Number.NaN }).methode).toBe('defaut');
  });
});

describe('calibrage du débit du compte', () => {
  it('total des caractères ÷ total des secondes mesurées', () => {
    expect(debitCalibre([{ caracteres: 300, mesureeS: 25 }, { caracteres: 420, mesureeS: 39.5 }])).toBe(11.16);
  });
  it('échantillons inexploitables écartés (script court, mesure absente, débit absurde)', () => {
    expect(echantillonDeMetadata({ caracteres: 20, mesureeS: 2 })).toBeNull();
    expect(echantillonDeMetadata({ caracteres: 300, mesureeS: null })).toBeNull();
    expect(echantillonDeMetadata({ caracteres: 300, mesureeS: 3 })).toBeNull();
    expect(echantillonDeMetadata(null)).toBeNull();
    expect(debitCalibre([null, { caracteres: 20, mesureeS: 2 }])).toBeNull();
    expect(debitCalibre([])).toBeNull();
  });
  it(`au plus ${ECHANTILLONS_PAROLE_MAX} échantillons, les premiers (les plus récents)`, () => {
    const recents = Array.from({ length: ECHANTILLONS_PAROLE_MAX }, () => ({ caracteres: 240, mesureeS: 20 }));
    expect(debitCalibre([...recents, { caracteres: 400, mesureeS: 20 }])).toBe(12);
  });
  it('la metadata porte la prévision ET la mesure', () => {
    const e = estimerParoleAvatar('x'.repeat(302), { debitCompte: 12.24 });
    expect(paroleEstimationPourMetadata(e, 24.682)).toEqual({
      version: 1, caracteres: 302, debit: 12.24, methode: 'compte', estimeeS: 24.7, mesureeS: 24.682, ecartS: 0.018,
    });
    expect(paroleEstimationPourMetadata(e, null).ecartS).toBeNull();
    // Relue par le calibrage.
    expect(echantillonDeMetadata(paroleEstimationPourMetadata(e, 24.682))).toEqual({ caracteres: 302, mesureeS: 24.682 });
  });
});

describe('lireDebitParoleCompte — lecture seule', () => {
  it('lit les rendus du compte qui ont enregistré leur parole, les plus récents d’abord', async () => {
    requetes.length = 0;
    reponse = { data: [{ parole: { caracteres: 300, mesureeS: 25 } }, { parole: null }], error: null };
    expect(await lireDebitParoleCompte('u1')).toBe(12);
    expect(requetes.map(([m]) => m)).toEqual(['from', 'select', 'eq', 'not', 'order', 'limit']);
    expect(requetes[0][1]).toEqual(['scheduled_posts']);
    expect(requetes[2][1]).toEqual(['user_id', 'u1']);
  });
  it('erreur, aucun rendu, aucun compte : `null` (débit par défaut), jamais d’exception', async () => {
    reponse = { data: null, error: { message: 'x' } };
    expect(await lireDebitParoleCompte('u1')).toBeNull();
    reponse = { data: [], error: null };
    expect(await lireDebitParoleCompte('u1')).toBeNull();
    expect(await lireDebitParoleCompte(null)).toBeNull();
  });
});

describe('paroleAvatarPrevue — l’aperçu', () => {
  it('sans durée cible : rien ne change (`null`)', () => {
    expect(paroleAvatarPrevue({ script: 'x'.repeat(200), brief: {} })).toBeNull();
  });
  it('avec durée cible : la parole du script réel, sinon le budget', () => {
    expect(paroleAvatarPrevue({ script: 'x'.repeat(212), brief: { duree: 30 } })).toBe(20);
    expect(paroleAvatarPrevue({ script: '', brief: { duree: 30 } })).toBe(paroleAvatarDuBudget({ duree: 30 }));
    expect(paroleAvatarPrevue({ script: 'x'.repeat(244), brief: { duree: 30 }, debitCompte: 12.2 })).toBe(20);
  });
});

describe('démo Motivation (30 s, avatar + 3 médias stock) : aperçu avant rendu vs rendu (parole mesurée 24,682 s)', () => {
  const USER_ID = '00000000-0000-4000-8000-000000000000';
  const stock: MediaStockRetenu[] = [
    'hand-writing-motivation-word-with-brush-pen-on-paper-5527758',
    'man-lifting-dumbbells-in-a-gym-4761426',
    'black-and-white-shirtless-man-crossing-arms-6455987',
  ].map((slug, i) => ({
    url: `https://studiio.pro/storage/v1/object/public/media/${USER_ID}/stock-pexels-video-${9100 + i}.mp4`,
    type: 'video' as const, provider: 'pexels' as const, providerAssetId: String(9100 + i),
    auteur: `A${i}`, sourceUrl: `https://www.pexels.com/video/${slug}/`, licence: 'Licence Pexels', vignetteUrl: 'x', sujet: 'Motivation',
  }));
  const config = sanitizeConfig({
    enabled: true, mode: 'review', cadence: 'weekly', countPerCycle: 1, platforms: [], creditFloor: 50,
    rushUrls: [], topics: ['Motivation'], runTimezone: 'Europe/Paris', publishTime: '18:00', voiceEnabled: false,
    jumeauAvatar: true, jumeauAvatarId: '11111111-1111-4111-8111-111111111111', posterUrls: [], posterMode: 'auto', brief: { duree: 30 },
    designStyle: { sources: { actives: { rushes: false, avatar: true, stock: true }, stock, gabarit: [] } },
  });
  const urls = sourcesEffectives(config).sources.stock.map((m) => m.url);
  const echantillon = buildAutopilotSample({ topics: config.topics, brief: config.brief });
  const resume = {
    gabarit: gabaritSuggere({ avatar: true, rushes: 0, stock: urls.length }, { dureeSecondes: 30, rythme: null }),
    actives: { rushes: false, stock: true, avatar: true }, rushesPerso: [], stock: sourcesEffectives(config).sources.stock,
    avatar: { disponible: true, vignette: null },
  };
  const options = {
    cible: 30, rythme: null, durees: Object.fromEntries(urls.map((u, i) => [u, [4, 3, 3][i]])), dureeVisee: 30,
    contexte: contexteDeLEchantillon(echantillon, sujetsCourants(config), config.brief),
  };
  const rendu = planCompletAutopilote(resume, { ...options, secondesAvatar: 24.682 });
  const script = scriptJumeauMontage(postDeLEchantillon(echantillon, config.brief), config);

  it('le rendu a une clôture (parole 24,682 s < 30 s)', () => {
    expect(rendu.debutCloture).toBeCloseTo(24.682, 3);
  });

  it('calibré sur un rendu précédent du compte : même ordre, mêmes rôles, clôture et CTA à ≤ 1,5 s', () => {
    const [post] = preparePosts({ config, topic: 'Motivation', count: 1, now: Date.parse('2026-10-20T08:00:00Z'), seeds: [2] });
    const debitCompte = debitCalibre([{ caracteres: caracteresParole(scriptJumeauMontage(post, config)), mesureeS: 24.682 }]);
    const apercu = planCompletAutopilote(resume, { ...options, secondesAvatarEstimees: paroleAvatarPrevue({ script, brief: config.brief, debitCompte }) });
    expect(apercu.debutCloture).not.toBeNull();
    expect(apercu.segments.map((s) => [s.genre, s.role])).toEqual(rendu.segments.map((s) => [s.genre, s.role]));
    apercu.segments.forEach((s, i) => {
      expect(Math.abs(s.debut - rendu.segments[i].debut)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(s.fin - rendu.segments[i].fin)).toBeLessThanOrEqual(1.5);
    });
    expect(Math.abs(apercu.cta![0] - rendu.cta![0])).toBeLessThanOrEqual(1.5);
  });

  it('sans calibrage, le script réel montre déjà la clôture (l’ancienne règle du budget ne la montrait pas)', () => {
    const avant = planCompletAutopilote(resume, { ...options, secondesAvatarEstimees: paroleAvatarDuBudget(config.brief, 0) });
    const apres = planCompletAutopilote(resume, { ...options, secondesAvatarEstimees: paroleAvatarPrevue({ script, brief: config.brief }) });
    expect(avant.debutCloture).toBeNull();
    expect(apres.debutCloture).not.toBeNull();
    expect(Math.abs(apres.parole! - 24.682)).toBeLessThan(Math.abs(avant.parole! - 24.682));
  });
});
