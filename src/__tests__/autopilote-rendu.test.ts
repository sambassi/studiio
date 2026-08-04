import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildAutopilotDesign, buildAutopilotMetadata, autopilotVideoSeconds,
  AUTOPILOT_FORMAT, AUTOPILOT_WATERMARK,
} from '@/lib/autopilot/design';
import { preparePosts, toPostRow } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import {
  DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS, buildSequences, VIDEO_SIZE,
} from '@/lib/creer/designSpec';
import { DEFAULT_TRANSITION } from '@/lib/video-composer';
import { DEFAULT_TEXT_ANIMATION } from '@/lib/creer/textAnimation';

/**
 * L'Autopilote branché sur le rendu serveur.
 *
 * ⚠️ IL COMPOSE SANS ÉCRAN — sans personne pour régler un curseur, choisir
 * une couleur ou déplacer un titre. Il doit donc produire exactement le
 * montage qu'un utilisateur obtient en ouvrant l'assistant et en ne touchant
 * à rien. C'est la seule définition vérifiable de « correct » ici : il n'y a
 * pas d'intention utilisateur à respecter, seulement un défaut à ne pas
 * trahir.
 *
 * D'où les tests ci-dessous, qui comparent les valeurs du design produit aux
 * constantes PARTAGÉES plutôt qu'à des nombres réécrits — deux jeux de
 * « valeurs par défaut » auraient fini par diverger sans que personne ne le
 * voie.
 */

const design = readFileSync(resolve(__dirname, '../lib/autopilot/design.ts'), 'utf-8');
const rendu = readFileSync(resolve(__dirname, '../lib/autopilot/render.ts'), 'utf-8');
const route = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');

const T0 = Date.parse('2026-08-04T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG,
  enabled: true,
  platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4'],
  ...p,
});
const unPost = (c: AutopilotConfig = cfg()) =>
  preparePosts({ config: c, topic: 'yoga du matin', count: 1, now: T0 })[0];

describe('Le design est celui d un assistant qu on n a pas touché', () => {
  it('les durées viennent des constantes PARTAGÉES', () => {
    const d = buildAutopilotDesign(unPost());
    expect(d.introDuration).toBe(DEFAULT_SEQUENCE_SECONDS.intro);
    expect(d.cardsDuration).toBe(DEFAULT_SEQUENCE_SECONDS.cards);
    expect(d.ctaDuration).toBe(DEFAULT_SEQUENCE_SECONDS.cta);
  });

  it('la transition et l animation sont les défauts, pas des choix', () => {
    const d = buildAutopilotDesign(unPost());
    expect(d.transition).toBe(DEFAULT_TRANSITION);
    expect(d.textAnimation).toBe(DEFAULT_TEXT_ANIMATION);
  });

  it('le format est le vertical — celui des réseaux', () => {
    expect(AUTOPILOT_FORMAT).toBe('9:16');
    expect(buildAutopilotDesign(unPost()).format).toBe('9:16');
  });

  it('le titre part en MAJUSCULES, comme le Mode simple', () => {
    // `SequenceTitle` l'applique de toute façon : l'écrire ici garde le post
    // et la vidéo d'accord sur la même chaîne.
    expect(buildAutopilotDesign(unPost()).title).toBe('YOGA DU MATIN');
  });

  it('le post et la vidéo portent le MÊME titre', () => {
    // Une régénération depuis le Calendrier repart de `post.title` : un titre
    // en minuscules produirait un second montage différent du premier.
    const p = unPost();
    const row = toPostRow({
      userId: 'u1', post: p, config: cfg(), videoUrl: 'x',
      metadata: {},
    });
    expect(row.title).toBe(buildAutopilotDesign(p).title);
  });

  it('les cartes générées passent telles quelles', () => {
    const p = unPost();
    const d = buildAutopilotDesign(p);
    expect(d.cards).toHaveLength(p.content.cards.length);
    expect(d.cards?.[0].icon).toBe(p.content.cards[0].icon);
    expect(d.cards?.[0].value).toBe(p.content.cards[0].value);
  });
});

describe('La séquence vidéo, sans lecteur pour la mesurer', () => {
  it('un rush prend le repli du Mode simple', () => {
    // Un cron ne décode pas de vidéo : il applique la durée que l'assistant
    // utilise quand celle du rush est illisible.
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4')).toBe(RUSH_SEQUENCE_SECONDS.fallback);
  });

  it('sans rush, la séquence vaut zéro', () => {
    expect(autopilotVideoSeconds(null)).toBe(DEFAULT_SEQUENCE_SECONDS.video);
    expect(DEFAULT_SEQUENCE_SECONDS.video).toBe(0);
  });

  it('et un montage sans rush reste RENDABLE', () => {
    // `buildSequences` retire une séquence de durée nulle : le montage sort
    // en titre → cartes → CTA, ce qui est valide, pas amputé.
    const d = buildAutopilotDesign(unPost(cfg({ rushUrls: [] })));
    const seqs = buildSequences({
      introDuration: d.introDuration ?? 0,
      cardsDuration: d.cardsDuration ?? 0,
      videoDuration: d.videoDuration ?? 0,
      ctaDuration: d.ctaDuration ?? 0,
      cardCount: d.cards?.length ?? 0,
      hasVideoBackground: false,
      videoRequested: false,
    });
    expect(seqs.map((s) => s.type)).toEqual(['intro', 'cards', 'cta']);
  });

  it('avec rush, la séquence vidéo est bien là', () => {
    const d = buildAutopilotDesign(unPost());
    expect(d.videoUrl).toBe('https://cdn.test/a.mp4');
    expect(d.videoDuration).toBeGreaterThan(0);
  });
});

describe('Les métadonnées sont celles que le Calendrier sait relire', () => {
  const meta = () => {
    const p = unPost();
    return buildAutopilotMetadata({
      post: p, design: buildAutopilotDesign(p),
      videoUrl: 'https://cdn.test/rendu.mp4', mode: 'review',
    });
  };

  it('les DEUX clés du montage sont renseignées', () => {
    // Le Calendrier interroge `videoUrl` puis `renderedVideoUrl` : n'en
    // écrire qu'une donne un post visible à un endroit seulement.
    const m = meta();
    expect(m.videoUrl).toBe('https://cdn.test/rendu.mp4');
    expect(m.renderedVideoUrl).toBe('https://cdn.test/rendu.mp4');
  });

  it('les dimensions RÉELLES sont écrites', () => {
    // `format` ne connaît que « reel » et « tv » : sans ce champ, le
    // Calendrier cadrerait le montage dans le mauvais conteneur.
    expect(meta().videoSize).toEqual({ w: VIDEO_SIZE['9:16'].w, h: VIDEO_SIZE['9:16'].h });
  });

  it('les durées de séquence sont celles du rendu', () => {
    const s = meta().sequences as Record<string, number>;
    expect(s.intro).toBe(DEFAULT_SEQUENCE_SECONDS.intro);
    expect(s.total).toBe(
      DEFAULT_SEQUENCE_SECONDS.intro + DEFAULT_SEQUENCE_SECONDS.cards
      + RUSH_SEQUENCE_SECONDS.fallback + DEFAULT_SEQUENCE_SECONDS.cta,
    );
  });

  it('le filigrane est celui qui a été rendu', () => {
    const d = (meta().design ?? {}) as Record<string, unknown>;
    expect((d.siteText as Record<string, unknown>).text).toBe(AUTOPILOT_WATERMARK);
  });

  it('rien n est INVENTÉ sur ce que l Autopilote ne sait pas', () => {
    // Positions libres, cartes déplacées, éléments posés : l'Autopilote n'en
    // a aucune. Écrire des valeurs inventées ferait diverger l'aperçu du
    // Calendrier de la vidéo réellement rendue ; les lecteurs retombent sur
    // leurs défauts, qui sont exactement ceux du rendu.
    const m = meta();
    expect(m.positions).toBeUndefined();
    expect(m.cardBoxes).toBeUndefined();
    expect((m.design as Record<string, unknown>).positions).toBeUndefined();
  });
});

describe('Le rendu serveur, et rien d autre', () => {
  it('il passe par l entrée Remotion', () => {
    expect(rendu).toContain("await import('@/lib/render/creerSimple')");
    expect(rendu).toContain('renderCreerSimple(');
  });

  it('les imports Remotion sont DYNAMIQUES', () => {
    // `@remotion/bundler` est externalisé dans `next.config.js` : un import
    // en tête de module casse le build. Le chemin manuel fait pareil.
    const enTete = rendu.slice(0, rendu.indexOf('export const RENDER_BUCKET'));
    expect(enTete).not.toContain("from '@remotion/");
  });

  it('le fichier téléversé va dans le même compartiment que le chemin manuel', () => {
    const manuelle = readFileSync(resolve(__dirname, '../app/api/render/route.ts'), 'utf-8');
    expect(manuelle).toContain("bucket: 'videos'");
    expect(rendu).toContain("export const RENDER_BUCKET = 'videos';");
  });

  it('le fichier temporaire est supprimé après mise en ligne', () => {
    // Un cron quotidien remplirait sinon le disque du serveur.
    const upload = readFileSync(resolve(__dirname, '../lib/storage/upload.ts'), 'utf-8');
    expect(upload).toContain('fs.unlinkSync(filePath);');
  });
});

describe('Ce que ce passage NE fait PAS', () => {
  it('il ne publie rien', () => {
    // Il prépare des posts ; `/api/cron/publish` publie, et seulement les
    // `scheduled`.
    const sansCommentaires = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const interdit of ['publishToInstagram', 'publishToTikTok', '/api/cron/publish']) {
      expect(sansCommentaires, interdit).not.toContain(interdit);
    }
  });

  it('il ne touche pas au compositeur navigateur', () => {
    const sansCommentaires = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const interdit of ['composeVideo', 'MediaRecorder']) {
      expect(sansCommentaires(route), interdit).not.toContain(interdit);
      expect(sansCommentaires(design), interdit).not.toContain(interdit);
    }
  });

  it('une banque de rushes vide reste un ARRÊT, pas une production', () => {
    // `decideRun` refuse déjà ce cas et l'utilisateur reçoit un courriel.
    // Produire quand même surprendrait qui a configuré un Autopilote sans
    // jamais y déposer de rush.
    expect(route).toContain("reason === 'sans-rush'");
  });
});
