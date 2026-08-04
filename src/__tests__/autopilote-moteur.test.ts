import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  preparePosts, toPostRow, slotDate, contentSeed, DEFAULT_SLOT_TIME,
} from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';

/**
 * Moteur de l'Autopilote.
 *
 * ⚠️ **LA CONTRAINTE QUI COMMANDAIT TOUT A ÉTÉ LEVÉE.**
 *
 * Ce fichier verrouillait deux règles — statut toujours `draft`, aucun crédit
 * débité — parce que le moteur ne pouvait pas rendre : `composeVideo` est un
 * compositeur de NAVIGATEUR (Canvas, `MediaRecorder`, `document`) qu'une
 * route Next ne peut pas exécuter, et les cartes du Mode simple étaient une
 * photographie du DOM de l'aperçu.
 *
 * La composition Remotion `creer-simple-montage` rend désormais le même
 * montage sous Chromium sans tête. Les deux règles tombent **ensemble**, et
 * pour la même raison :
 *
 * 1. Le statut suit enfin le MODE. Il était forcé à `draft` parce que
 *    `/api/cron/publish` refuse un post sans média — le post en a un.
 * 2. Les crédits sont débités, comme pour un rendu manuel.
 *
 * Ce que les tests continuent de verrouiller : le compositeur NAVIGATEUR
 * n'est toujours pas appelé depuis le cron. Ce chemin-là reste impossible ;
 * seule la route par Remotion a été ouverte.
 */

const engine = readFileSync(resolve(__dirname, '../lib/autopilot/engine.ts'), 'utf-8');
const route = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
const publish = readFileSync(resolve(__dirname, '../app/api/cron/publish/route.ts'), 'utf-8');

const T0 = Date.parse('2026-08-04T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4', 'https://cdn.test/b.mp4'],
  ...p,
});

/** Une ligne de post complète, montage réputé rendu. */
const ligne = (c: AutopilotConfig, index = 0) => {
  const post = preparePosts({ config: c, topic: 'yoga', count: index + 1, now: T0 })[index];
  const design = buildAutopilotDesign(post);
  const videoUrl = 'https://cdn.test/rendu.mp4';
  return toPostRow({
    userId: 'u1',
    post,
    config: c,
    videoUrl,
    metadata: buildAutopilotMetadata({ post, design, videoUrl, mode: c.mode }),
  });
};

describe('La contrainte qui commandait tout', () => {
  it('le compositeur navigateur reste un compositeur de NAVIGATEUR', () => {
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    expect(composer).toContain('Client-side video composer using Canvas + MediaRecorder');
    expect(composer).toContain("document.createElement('video')");
  });

  it('le cron de publication REFUSE toujours un post sans média', () => {
    // C'est ce qui interdisait de programmer une publication. La règle n'a
    // pas bougé : c'est le post qui porte désormais son média.
    expect(publish).toContain('if (!videoUrl && requiresSocialAccount(post.platforms))');
  });

  it('le rendu passe par REMOTION, pas par le navigateur', () => {
    const rendu = readFileSync(resolve(__dirname, '../lib/autopilot/render.ts'), 'utf-8');
    expect(rendu).toContain("await import('@/lib/render/creerSimple')");
    // Imports DYNAMIQUES : `@remotion/bundler` est externalisé dans
    // `next.config.js`, un import en tête de module casse le build.
    expect(rendu).not.toContain("from '@remotion/");
  });

  it('le moteur n appelle donc jamais le compositeur', () => {
    // Hors commentaires : l'en-tête des deux fichiers NOMME le compositeur
    // pour expliquer pourquoi il ne l'appelle pas.
    const sansCommentaires = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const interdit of ['composeVideo', 'composeAndUpload', 'MediaRecorder']) {
      expect(sansCommentaires(engine), interdit).not.toContain(interdit);
      expect(sansCommentaires(route), interdit).not.toContain(interdit);
    }
  });

  it('et il débite MAINTENANT, comme un rendu manuel', () => {
    // Le montage est rendu et en ligne : il se paie, au même tarif.
    expect(route).toContain('deductCredits(userId, COST_PER_VIDEO');
    expect(route).toContain("getVideoRenderCost('reel')");
  });

  it('le débit vient APRÈS le rendu et l insertion', () => {
    // Débiter avant ferait payer un rendu qui peut encore échouer.
    const bloc = route.slice(route.indexOf('const { videoUrl, durationFrames }'));
    expect(bloc.indexOf('.insert(toPostRow(')).toBeLessThan(bloc.indexOf('deductCredits('));
  });

  it('un débit manqué ne retire pas le montage livré', () => {
    expect(route).toContain('debit manque pour');
  });
});

describe('Le statut suit enfin le MODE', () => {
  it('« me laisser valider » dépose un brouillon — et reste le défaut', () => {
    expect(DEFAULT_CONFIG.mode).toBe('review');
    expect(ligne(cfg({ mode: 'review' })).status).toBe('draft');
  });

  it('« publier automatiquement » programme', () => {
    expect(ligne(cfg({ mode: 'auto' })).status).toBe('scheduled');
  });

  it('le post porte son média des DEUX côtés', () => {
    // Le Calendrier lit `media_url` ou `metadata.videoUrl` selon l'écran :
    // n'en renseigner qu'un donne un post visible à un endroit seulement.
    const row = ligne(cfg());
    expect(row.media_url).toBe('https://cdn.test/rendu.mp4');
    expect(row.metadata.videoUrl).toBe('https://cdn.test/rendu.mp4');
    expect(row.metadata.renderedVideoUrl).toBe('https://cdn.test/rendu.mp4');
  });

  it('plus rien n attend le navigateur', () => {
    expect(ligne(cfg()).metadata.pendingRender).toBe(false);
  });

  it('le post se reconnaît comme venant de l Autopilote', () => {
    const row = ligne(cfg());
    expect(row.metadata.source).toBe('autopilote');
    expect(row.metadata.autopilotMode).toBe('review');
    expect(row.agent_generated).toBe(true);
  });
});

describe('Les créneaux', () => {
  it('le premier montage part DEMAIN, pas aujourd hui', () => {
    expect(slotDate(new Date(T0), 0)).toBe('2026-08-05');
  });

  it('un jour de plus par montage — deux publications le même jour se feraient concurrence', () => {
    expect(slotDate(new Date(T0), 1)).toBe('2026-08-06');
    expect(slotDate(new Date(T0), 2)).toBe('2026-08-07');
  });

  it('le passage de mois est correct', () => {
    expect(slotDate(new Date(Date.parse('2026-08-30T09:00:00Z')), 1)).toBe('2026-09-01');
  });

  it('l heure est la même pour tous', () => {
    const p = preparePosts({ config: cfg(), topic: 'yoga', count: 2, now: T0 });
    expect(p.every((x) => x.scheduledTime === DEFAULT_SLOT_TIME)).toBe(true);
  });
});

describe('Le contenu VARIE d un cycle à l autre', () => {
  it('la graine change avec le passage', () => {
    // Sans elle, deux cycles sur le même thème rendraient le même contenu, et
    // l'Autopilote republierait la même vidéo indéfiniment.
    expect(contentSeed(T0, 0)).not.toBe(contentSeed(T0 + 3_600_000, 0));
  });

  it('et avec l index dans le cycle', () => {
    expect(contentSeed(T0, 0)).not.toBe(contentSeed(T0, 1));
  });

  it('elle reste stable à la minute — deux appels du même passage concordent', () => {
    expect(contentSeed(T0, 0)).toBe(contentSeed(T0 + 999, 0));
  });

  it('elle n est jamais négative', () => {
    expect(contentSeed(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('La rotation des rushes dans un cycle', () => {
  it('deux montages du même cycle ne prennent pas le même rush', () => {
    const p = preparePosts({ config: cfg(), topic: 'yoga', count: 2, now: T0 });
    expect(p[0].rushUrl).not.toBe(p[1].rushUrl);
  });

  it('le rush choisi devient la séquence Vidéo à la composition', () => {
    const c = cfg();
    const row = ligne(c);
    // Aucun rush precedent : la rotation demarre sur le PREMIER.
    expect(row.metadata.rushUrls).toEqual([c.rushUrls[0]]);
    expect(row.metadata.rawVideoUrl).toBe(c.rushUrls[0]);
  });

  it('sans rush, le post se prépare quand même sans en référencer', () => {
    // `decideRun` refuse déjà ce cas ; le moteur ne doit pas produire de
    // référence morte s'il est appelé autrement.
    const c = cfg({ rushUrls: [] });
    const row = ligne(c);
    expect(row.metadata.rushUrls).toEqual([]);
    expect(row.metadata.rawVideoUrl).toBeUndefined();
  });
});

describe('La route', () => {
  it('elle s authentifie comme le cron de publication', () => {
    expect(route).toContain('`Bearer ${secret}`');
    expect(route).toContain("req.headers.get('authorization')");
    // Sans secret configuré, personne ne passe.
    expect(route).toContain('if (!secret) return false;');
  });

  it('elle ne traite que les comptes ACTIFS', () => {
    expect(route).toContain(".eq('enabled', true)");
  });

  it('elle prévient sur ce que l utilisateur peut lever, et seulement ça', () => {
    // « pas encore » est le cas normal entre deux cycles : le notifier serait
    // du bruit quotidien.
    expect(route).toContain("if (decision.reason === 'credits' || decision.reason === 'sans-rush')");
    expect(route).toContain('Autopilote en pause — crédits insuffisants');
    expect(route).toContain('Autopilote en attente — ajoutez des rushes');
  });

  it('la notification ne peut pas retarder ni faire échouer le passage', () => {
    expect(route).toContain('sendEmailSilent({');
  });

  it('un cycle ENTIÈREMENT raté ne fait PAS avancer la cadence', () => {
    // Sinon l'utilisateur perdrait un cycle entier sur une panne passagère.
    expect(route).toContain('if (reussis > 0) {');
    const bloc = route.slice(route.indexOf('if (reussis > 0) {'));
    expect(bloc).toContain('last_run_at:');
  });

  it('la cadence avance après un passage réussi, et la rotation se souvient', () => {
    expect(route).toContain('last_run_at: new Date(now).toISOString(),');
    // Le dernier rush RÉELLEMENT utilisé : un rush dont le rendu a échoué ne
    // doit pas faire avancer la rotation.
    expect(route).toContain('last_rush_url: dernierRush,');
    expect(route).toContain('dernierRush = post.rushUrl ?? dernierRush;');
  });

  it('chaque montage est isolé — un échec n emporte pas le cycle', () => {
    const bloc = route.slice(route.indexOf('for (const post of posts) {'));
    expect(bloc).toContain('} catch (err) {');
    expect(bloc).toContain('echecs += 1;');
  });

  it('un créneau déjà produit n est pas refait', () => {
    // La cadence ne protège de rien si `last_run_at` n'a pas pu être écrit
    // APRÈS l'insertion — et c'est l'ordre réel des opérations.
    expect(route).toContain('if (dejaFaits.has(jeton)) {');
    expect(route).toContain('doublons += 1;');
  });

  it('sans la table, elle le dit en 503 plutôt que de planter', () => {
    expect(route).toContain('la migration autopilot_config est-elle appliquée ?');
  });

  it('elle rend un rapport par compte', () => {
    expect(route).toContain('rapport.push({ userId, prepares: 0, saute: decision.reason });');
    expect(route).toContain('rendus: total,');
    expect(route).toContain('echecs: rates,');
  });

  it('elle valide la configuration relue avec le MÊME code que l écran', () => {
    expect(route).toContain('sanitizeConfig({');
  });
});
