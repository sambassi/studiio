import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickTopics, AUTOPILOT_TOPICS, normalizeTopic } from '@/lib/autopilot/topics';
import { preparePosts } from '@/lib/autopilot/engine';
import { pickRush, DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Des vidéos VARIÉES, et un aperçu qui lit le montage.
 *
 * ⚠️ LE SUJET ÉTAIT FIXE, ET TOUT EN DÉCOULE. Le cycle lisait
 * `objectives.target_audience` — une seule valeur par compte — et retombait
 * sur « motivation quotidienne ». Or le sujet détermine le titre, les cartes,
 * le CTA, et jusqu'à la requête ET au tirage de la photo d'affiche. Un sujet
 * unique ne donnait donc pas « des vidéos qui se ressemblent » : il donnait
 * deux fois la même.
 *
 * ⚠️ ET L'APERÇU DU CALENDRIER N'EST PAS UN LECTEUR. Il REJOUE les séquences
 * une à une depuis les métadonnées, parce que les anciens posts n'avaient pas
 * de fichier complet à montrer. Un montage rendu serveur EST déjà ce fichier :
 * le rejouer revenait à reconstruire une vidéo qui existe, et le lecteur
 * restait bloqué faute des morceaux attendus.
 */

const calendrier = readFileSync(resolve(__dirname, '../app/dashboard/calendar/page.tsx'), 'utf-8');
const poster = readFileSync(resolve(__dirname, '../lib/autopilot/poster.ts'), 'utf-8');
const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], ...p,
});

describe('B — les sujets tournent', () => {
  it('deux montages d un cycle ont des sujets DIFFÉRENTS', () => {
    const t = pickTopics({ count: 2 });
    expect(t).toHaveLength(2);
    expect(t[0]).not.toBe(t[1]);
  });

  it('un sujet récemment employé est évité', () => {
    const t = pickTopics({ count: 1, exclude: [AUTOPILOT_TOPICS[0]], seed: 0 });
    expect(normalizeTopic(t[0])).not.toBe(normalizeTopic(AUTOPILOT_TOPICS[0]));
  });

  it('la graine déplace le point de départ', () => {
    // Sans elle, deux cycles trouvant les mêmes exclusions repartiraient sur
    // le même sujet.
    expect(pickTopics({ count: 1, seed: 0 })[0]).not.toBe(pickTopics({ count: 1, seed: 1 })[0]);
  });

  it('tout épuisé : on reprend, on n échoue pas', () => {
    const t = pickTopics({ count: 2, exclude: [...AUTOPILOT_TOPICS] });
    expect(t).toHaveLength(2);
    expect(t[0]).not.toBe(t[1]);
  });

  it('le contenu produit DIFFÈRE réellement d un sujet à l autre', () => {
    const posts = preparePosts({
      config: cfg(), topic: ['sommeil', 'nutrition'], count: 2, now: 1_754_400_000_000,
    });
    expect(posts[0].title).not.toBe(posts[1].title);
    expect(posts[0].content.cards[0].title).not.toBe(posts[1].content.cards[0].title);
  });

  it('une chaîne unique reste acceptée — l ancien appel', () => {
    const posts = preparePosts({ config: cfg(), topic: 'danse', count: 2, now: 1 });
    expect(posts[0].title).toBe('danse');
    expect(posts[1].title).toBe('danse');
  });

  it('le cron exclut les sujets des brouillons récents', () => {
    expect(cron).toContain('const recents = await sujetsRecents(userId);');
    expect(cron).toContain('exclude: recents,');
  });
});

describe('B — l affiche change, elle aussi', () => {
  it('le tirage dépend de la VARIANTE, pas du seul sujet', () => {
    // Dérivée du seul sujet, la graine rendait la même photo à chaque cycle
    // d'un même thème.
    expect(poster).toContain('+ Math.abs(Math.floor(variante))');
    expect(cron).toContain('pickPosterUrl(post.title,');
  });
});

describe('B — les rushes alternent', () => {
  it('deux rushes, deux montages : pas le même', () => {
    const rushes = ['https://cdn/a.mp4', 'https://cdn/b.mp4'];
    expect(pickRush(rushes, null, 0)).not.toBe(pickRush(rushes, null, 1));
  });

  it('la rotation repart après le dernier utilisé', () => {
    const rushes = ['https://cdn/a.mp4', 'https://cdn/b.mp4', 'https://cdn/c.mp4'];
    expect(pickRush(rushes, 'https://cdn/a.mp4', 0)).toBe('https://cdn/b.mp4');
  });

  it('un seul rush : forcément le même — et c est documenté', () => {
    expect(pickRush(['https://cdn/a.mp4'], null, 3)).toBe('https://cdn/a.mp4');
  });
});

describe('A — l aperçu lit le montage serveur', () => {
  it('un post `serverRendered` prend une branche à part', () => {
    expect(calendrier).toContain('const urlServeur = meta?.serverRendered');
    expect(calendrier).toContain('if (urlServeur) {');
  });

  it('il lit le fichier au lieu de rejouer les séquences', () => {
    const bloc = calendrier.slice(
      calendrier.indexOf('const urlServeur = meta?.serverRendered'),
      calendrier.indexOf('const metaBranding = meta?.branding;'),
    );
    expect(bloc).toContain('<video');
    expect(bloc).toContain('controls');
    expect(bloc).toContain('playsInline');
  });

  it('`muted` est en dur — sinon Chrome refuse le démarrage', () => {
    const bloc = calendrier.slice(calendrier.indexOf('const urlServeur = meta?.serverRendered'));
    expect(bloc.slice(0, 2000)).toContain('muted');
  });

  it('il retombe sur les autres clés si `media_url` manque', () => {
    expect(calendrier).toContain('fullPreviewPost.media_url || meta?.renderedVideoUrl || meta?.videoUrl');
  });

  it('les anciens posts gardent le remontage par séquences', () => {
    // La branche ne s'arme que sur `serverRendered` : tout le reste passe
    // dessous, inchangé.
    expect(calendrier).toContain('meta?.serverRendered\n          ? (fullPreviewPost.media_url');
  });
});
