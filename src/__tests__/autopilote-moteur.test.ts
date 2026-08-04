import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  preparePosts, toPostRow, slotDate, contentSeed, DEFAULT_SLOT_TIME,
} from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Moteur de l'Autopilote.
 *
 * ⚠️ **Il ne compose pas la vidéo, et ce n'est pas un choix.**
 *
 * `composeVideo` est un compositeur de NAVIGATEUR — Canvas, `MediaRecorder`,
 * `document.createElement`. Une route Next tourne dans Node : elle ne peut
 * pas l'exécuter. Et les cartes du Mode simple sont une **photographie du
 * DOM** de l'aperçu, qui n'existe pas dans un cron.
 *
 * Deux conséquences que ces tests verrouillent, parce qu'elles seraient
 * autrement corrigées « à l'envers » par quelqu'un qui n'aurait pas la
 * contrainte en tête :
 *
 * 1. Le statut est **toujours `draft`**, même en mode « publier
 *    automatiquement » : `/api/cron/publish` refuse un post sans média sur
 *    une plateforme sociale (`if (!videoUrl && requiresSocialAccount(…))`).
 *    Programmer une publication vouée à échouer serait pire que d'annoncer
 *    qu'il reste une étape.
 * 2. **Aucun crédit n'est débité** : rien n'a été rendu, et la composition
 *    débitera à son tour.
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

describe('La contrainte qui commande tout', () => {
  it('le compositeur est bien un compositeur de NAVIGATEUR', () => {
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    expect(composer).toContain('Client-side video composer using Canvas + MediaRecorder');
    expect(composer).toContain("document.createElement('video')");
  });

  it('le cron de publication REFUSE un post sans média', () => {
    // C'est ce qui interdit de programmer une publication ici.
    expect(publish).toContain('if (!videoUrl && requiresSocialAccount(post.platforms))');
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

  it('et il ne débite AUCUN crédit', () => {
    // Débiter un brouillon que l'utilisateur doit encore composer le ferait
    // payer deux fois.
    expect(route).not.toContain('deductCredits');
    expect(route).toContain('sert au calcul du plancher, pas a debiter');
  });
});

describe('Le statut est toujours « brouillon »', () => {
  it('en mode « me laisser valider »', () => {
    const p = preparePosts({ config: cfg({ mode: 'review' }), topic: 'yoga', count: 1, now: T0 });
    expect(toPostRow('u1', p[0], cfg({ mode: 'review' })).status).toBe('draft');
  });

  it('ET en mode « publier automatiquement »', () => {
    const c = cfg({ mode: 'auto' });
    const p = preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 });
    expect(toPostRow('u1', p[0], c).status).toBe('draft');
  });

  it('mais le mode voulu est conservé pour l après-composition', () => {
    const c = cfg({ mode: 'auto' });
    const row = toPostRow('u1', preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0], c);
    expect(row.metadata.autopilotMode).toBe('auto');
    expect(row.metadata.pendingRender).toBe(true);
  });

  it('le post se reconnaît comme venant de l Autopilote', () => {
    const c = cfg();
    const row = toPostRow('u1', preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0], c);
    expect(row.metadata.source).toBe('autopilote');
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
    const row = toPostRow('u1', preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0], c);
    // Aucun rush precedent : la rotation demarre sur le PREMIER.
    expect(row.metadata.rushUrls).toEqual([c.rushUrls[0]]);
    expect(row.metadata.rawVideoUrl).toBe(c.rushUrls[0]);
  });

  it('sans rush, le post se prépare quand même sans en référencer', () => {
    // `decideRun` refuse déjà ce cas ; le moteur ne doit pas produire de
    // référence morte s'il est appelé autrement.
    const c = cfg({ rushUrls: [] });
    const row = toPostRow('u1', preparePosts({ config: c, topic: 'yoga', count: 1, now: T0 })[0], c);
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

  it('un échec d écriture NE fait PAS avancer la cadence', () => {
    // Sinon l'utilisateur perdrait un cycle entier sur une panne passagère.
    const debut = route.indexOf('if (insertError) {');
    const bloc = route.slice(debut, route.indexOf('continue;', debut) + 10);
    expect(bloc).toContain('continue;');
    // Le bloc d'echec ne touche pas a la cadence.
    expect(bloc).not.toContain('last_run_at:');
  });

  it('la cadence avance après un passage réussi, et la rotation se souvient', () => {
    expect(route).toContain('last_run_at: new Date(now).toISOString(),');
    expect(route).toContain('last_rush_url: posts[posts.length - 1]?.rushUrl ?? config.lastRushUrl,');
  });

  it('sans la table, elle le dit en 503 plutôt que de planter', () => {
    expect(route).toContain('la migration autopilot_config est-elle appliquée ?');
  });

  it('elle rend un rapport par compte', () => {
    expect(route).toContain('rapport.push({ userId, prepares: 0, saute: decision.reason });');
    expect(route).toContain('pendingRender: total > 0');
  });

  it('elle valide la configuration relue avec le MÊME code que l écran', () => {
    expect(route).toContain('sanitizeConfig({');
  });
});
