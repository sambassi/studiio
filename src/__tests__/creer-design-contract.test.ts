import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CANONICAL_DESIGN,
  MANAGED_FIELDS,
  fromPostMetadata,
  isPostMetadataUnchanged,
  resolveCanonicalDesign,
  toComposerOptions,
  toPostMetadata,
} from '@/lib/creer/design';
import { deepClone, deepFreeze } from '@/lib/creer/design/internal';
import {
  ADVANCED_METADATA,
  ASSISTANT_METADATA,
  EDGE_METADATA,
  LEGACY_PARTIAL_METADATA,
} from './fixtures/canonical-design';

/**
 * Contrat de design canonique.
 *
 * Ce que ces tests protegent : un post relu puis reenregistre doit ressortir
 * IDENTIQUE. Le contrat sera bientot le seul chemin d'ecriture des
 * metadonnees ; la moindre perte y devient une perte de travail utilisateur,
 * silencieuse et irrattrapable — la colonne `metadata` n'a pas d'historique.
 *
 * `toStrictEqual` et non `toEqual` : `toEqual` ignore les proprietes valant
 * `undefined`, donc il declarerait egaux `{voiceUrl: undefined}` et `{}`.
 * C'est precisement la distinction « absent / defini a undefined » que le
 * contrat doit tenir.
 */

/** Copie gelee : toute tentative d'ecriture leve, les modules etant en mode strict. */
const frozen = <T>(value: T): T => deepFreeze(deepClone(value));

const FIXTURES: Array<[string, Record<string, unknown>]> = [
  ['editeur avance', ADVANCED_METADATA],
  ['parcours guide', ASSISTANT_METADATA],
  ['ancien post partiel', LEGACY_PARTIAL_METADATA],
  ['valeurs limites', EDGE_METADATA],
];

// ═══════════════════════════════════════════════════════════════════
describe('fromPostMetadata — lecture', () => {
  it('range les champs de l editeur avance dans leurs groupes', () => {
    const d = fromPostMetadata(ADVANCED_METADATA);
    expect(d.version).toBe(1);
    expect(d.source).toBe('advanced');
    expect(d.content.subtitle).toBe('Sous-titre de demonstration');
    expect(d.media.rushUrls).toEqual(['https://media.exemple.test/rush.mp4']);
    expect(d.cards.cards).toHaveLength(2);
    expect(d.cards.cardGroups).toHaveLength(1);
    expect(d.sequences?.order).toEqual(['intro', 'cards', 'video', 'cta']);
    expect(d.branding?.accentColor).toBe('#a855f7');
    expect(d.audio.audioKeyframes).toHaveLength(2);
    expect(d.audio.sequenceVoiceUrls?.titre).toBe('https://media.exemple.test/voix-titre.mp3');
    expect(d.overlays.videoOverlayText).toBe('TEXTE INCRUSTE');
    expect(d.overlays.overlays).toHaveLength(1);
    expect(d.designOptions?.titleFont).toBe('Anton');
  });

  it('reconnait le parcours guide a sa marque de fabrique', () => {
    expect(fromPostMetadata(ASSISTANT_METADATA).source).toBe('assistant');
  });

  it('n invente aucune valeur : un champ absent reste absent', () => {
    const d = fromPostMetadata(LEGACY_PARTIAL_METADATA);
    expect(d.designOptions).toBeUndefined();
    expect(d.sequences).toBeUndefined();
    expect(d.branding).toBeUndefined();
    expect(d.media.renderedVideoUrl).toBeUndefined();
    // Le defaut existe, mais il vit dans la vue resolue, pas dans le design.
    expect(DEFAULT_CANONICAL_DESIGN.sequences.intro).toBe(5);
  });

  it('distingue « absent » de « defini a null »', () => {
    const d = fromPostMetadata({ musicUrl: null });
    expect(d.present).toContain('musicUrl');
    expect(d.audio.musicUrl).toBeNull();
    expect(d.present).not.toContain('voiceUrl');
    expect(d.audio.voiceUrl).toBeUndefined();
  });

  it('retient une cle presente MEME portant undefined', () => {
    const d = fromPostMetadata(ASSISTANT_METADATA);
    expect(d.present).toContain('voiceUrl');
    expect(d.audio.voiceUrl).toBeUndefined();
  });

  it('classe en passthrough tout ce qu il ne gere pas', () => {
    const d = fromPostMetadata(EDGE_METADATA);
    expect(d.passthrough).toStrictEqual({
      error: null,
      cron_publish_results: [
        { platform: 'instagram', success: false, error: 'jeton expire' },
      ],
      timezone: 'Europe/Paris',
      champInconnuRacine: { a: 1, b: [true, false], c: { d: '' } },
    });
  });

  it('tolere n importe quelle entree sans lever', () => {
    for (const input of [null, undefined, 'texte', 42, [], true]) {
      const d = fromPostMetadata(input);
      expect(d.version).toBe(1);
      expect(d.present).toEqual([]);
      expect(d.passthrough).toStrictEqual({});
      expect(toPostMetadata(d)).toStrictEqual({});
    }
  });

  it('produit un `present` deterministe, ordonne par la table des champs', () => {
    const order = MANAGED_FIELDS.map((f) => f.key);
    for (const [, fixture] of FIXTURES) {
      const present = [...fromPostMetadata(fixture).present];
      const expected = order.filter((k) => Object.prototype.hasOwnProperty.call(fixture, k));
      expect(present).toEqual(expected);
    }
  });

  it('gele son resultat — une mutation accidentelle leve au lieu de corrompre', () => {
    const d = fromPostMetadata(ADVANCED_METADATA);
    expect(() => {
      (d.content as Record<string, unknown>).subtitle = 'pirate';
    }).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('aller-retour — aucune perte', () => {
  it.each(FIXTURES)('%s : metadata -> design -> metadata a l identique', (_label, fixture) => {
    const input = frozen(fixture);
    const output = toPostMetadata(fromPostMetadata(input), input);
    expect(output).toStrictEqual(fixture);
  });

  it.each(FIXTURES)('%s : reste stable sur cinq allers-retours', (_label, fixture) => {
    let current: Record<string, unknown> = deepClone(fixture);
    for (let i = 0; i < 5; i += 1) {
      current = toPostMetadata(fromPostMetadata(current), current);
    }
    expect(current).toStrictEqual(fixture);
  });

  it.each(FIXTURES)('%s : sans metadonnees d origine, le passthrough suffit', (_label, fixture) => {
    const output = toPostMetadata(fromPostMetadata(frozen(fixture)));
    expect(output).toStrictEqual(fixture);
  });

  it.each(FIXTURES)('%s : une simple lecture ne modifie rien', (_label, fixture) => {
    expect(isPostMetadataUnchanged(fromPostMetadata(fixture), fixture)).toBe(true);
  });

  it('preserve false, 0 et la chaine vide', () => {
    const out = toPostMetadata(fromPostMetadata(EDGE_METADATA), EDGE_METADATA);
    expect(out.hasAudio).toBe(false);
    expect(out.musicVolume).toBe(0);
    expect(out.overlayEndTime).toBe(0);
    expect(out.subtitle).toBe('');
    expect((out.branding as Record<string, unknown>).ctaText).toBe('');
    expect((out.design as Record<string, unknown>).gradientOpacity).toBe(0);
  });

  it('preserve les tableaux vides sans les confondre avec une absence', () => {
    const out = toPostMetadata(fromPostMetadata(EDGE_METADATA), EDGE_METADATA);
    expect(out.cards).toEqual([]);
    expect(out.rushUrls).toEqual([]);
    expect(out.audioKeyframes).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(out, 'cardGroups')).toBe(true);
  });

  it('preserve les objets imbriques inconnus, y compris dans `design`', () => {
    const out = toPostMetadata(fromPostMetadata(EDGE_METADATA), EDGE_METADATA);
    expect((out.design as Record<string, unknown>).champInconnuDansDesign)
      .toStrictEqual({ imbrique: { profond: [1, 2, 3] } });
    expect(out.champInconnuRacine).toStrictEqual({ a: 1, b: [true, false], c: { d: '' } });
  });

  it('preserve une extension future ajoutee apres coup', () => {
    const futur = { ...ADVANCED_METADATA, champQuiNExistePasEncore: { v: 2, actif: true } };
    const out = toPostMetadata(fromPostMetadata(futur), futur);
    expect(out.champQuiNExistePasEncore).toStrictEqual({ v: 2, actif: true });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('toPostMetadata — fusion', () => {
  it('ne supprime JAMAIS une cle des metadonnees d origine', () => {
    // Design lu d un post pauvre, fusionne dans un post riche : le riche
    // garde tout. C est le garde-fou contre l ecrasement du `metadata`
    // entier par un objet incomplet.
    const pauvre = fromPostMetadata({ subtitle: 'nouveau' });
    const out = toPostMetadata(pauvre, ADVANCED_METADATA);
    expect(out.subtitle).toBe('nouveau');
    expect(out.design).toStrictEqual(ADVANCED_METADATA.design);
    expect(out.branding).toStrictEqual(ADVANCED_METADATA.branding);
    expect(out.audioKeyframes).toStrictEqual(ADVANCED_METADATA.audioKeyframes);
    expect(Object.keys(out).length).toBe(Object.keys(ADVANCED_METADATA).length);
  });

  it('n ajoute aucune cle quand le champ etait absent et le reste', () => {
    const out = toPostMetadata(fromPostMetadata({ subtitle: 'a' }));
    expect(out).toStrictEqual({ subtitle: 'a' });
    expect(Object.prototype.hasOwnProperty.call(out, 'sequences')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'design')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'branding')).toBe(false);
  });

  it('reecrit une cle presente meme sur une base vide — `present` fait foi', () => {
    // Sans cette memoire, une cle presente portant `undefined` ou `null`
    // disparaitrait des qu on fusionne dans autre chose que la source.
    const design = fromPostMetadata({ voiceUrl: undefined, musicUrl: null, subtitle: '' });
    const out = toPostMetadata(design, {});
    expect(Object.prototype.hasOwnProperty.call(out, 'voiceUrl')).toBe(true);
    expect(out.voiceUrl).toBeUndefined();
    expect(out.musicUrl).toBeNull();
    expect(out.subtitle).toBe('');
    expect(out).toStrictEqual({ voiceUrl: undefined, musicUrl: null, subtitle: '' });
  });

  it('ne modifie ni le design ni les metadonnees d origine', () => {
    const original = frozen(ADVANCED_METADATA);
    const design = fromPostMetadata(original);
    expect(() => toPostMetadata(design, original)).not.toThrow();
    expect(original).toStrictEqual(ADVANCED_METADATA);
  });

  it('rend un objet NEUF, jamais l entree', () => {
    const design = fromPostMetadata(ADVANCED_METADATA);
    const out = toPostMetadata(design, ADVANCED_METADATA);
    expect(out).not.toBe(ADVANCED_METADATA);
    expect(out.design).not.toBe(ADVANCED_METADATA.design);
    out.subtitle = 'modifie apres coup';
    expect(ADVANCED_METADATA.subtitle).toBe('Sous-titre de demonstration');
  });

  it('signale un changement des qu une valeur bouge', () => {
    const design = fromPostMetadata(ADVANCED_METADATA);
    const modifie = {
      ...design,
      audio: { ...design.audio, musicUrl: 'https://media.exemple.test/autre.mp3' },
    };
    expect(isPostMetadataUnchanged(modifie, ADVANCED_METADATA)).toBe(false);
    const out = toPostMetadata(modifie, ADVANCED_METADATA);
    expect(out.musicUrl).toBe('https://media.exemple.test/autre.mp3');
    expect(out.design).toStrictEqual(ADVANCED_METADATA.design);
  });

  it('ecrit un champ renseigne apres coup, meme s il etait absent a la lecture', () => {
    const design = fromPostMetadata({ subtitle: 'a' });
    const enrichi = { ...design, audio: { ...design.audio, musicUrl: 'https://media.exemple.test/m.mp3' } };
    const out = toPostMetadata(enrichi);
    expect(out.musicUrl).toBe('https://media.exemple.test/m.mp3');
    expect(out.subtitle).toBe('a');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('defauts et resolution', () => {
  it('les defauts sont geles en profondeur', () => {
    expect(Object.isFrozen(DEFAULT_CANONICAL_DESIGN)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CANONICAL_DESIGN.sequences)).toBe(true);
    expect(() => {
      (DEFAULT_CANONICAL_DESIGN.sequences as Record<string, unknown>).intro = 99;
    }).toThrow();
  });

  it('comble les manques sans toucher a l enregistre', () => {
    const design = fromPostMetadata(LEGACY_PARTIAL_METADATA);
    const r = resolveCanonicalDesign(design);
    expect(r.sequences.intro).toBe(5);
    expect(r.branding.accentColor).toBe('#D91CD2');
    expect(r.audio.musicVolume).toBe(0.5);
    // …et l enregistrement d origine n a pas bouge.
    expect(design.sequences).toBeUndefined();
    expect(toPostMetadata(design, LEGACY_PARTIAL_METADATA)).toStrictEqual(LEGACY_PARTIAL_METADATA);
  });

  it('un zero enregistre l emporte sur le defaut', () => {
    const r = resolveCanonicalDesign(fromPostMetadata(EDGE_METADATA));
    expect(r.sequences.intro).toBe(0);
    expect(r.audio.musicVolume).toBe(0);
    expect(r.overlays.overlayEndTime).toBe(0);
  });

  it('un null significatif est conserve, un null incoherent retombe sur le defaut', () => {
    const r = resolveCanonicalDesign(fromPostMetadata({ posterUrl: null, rushUrls: null }));
    // Pas d affiche : c est une information, elle reste nulle.
    expect(r.media.posterUrl).toBeNull();
    // Une liste nulle ne se parcourt pas : le defaut `[]` la remplace.
    expect(r.media.rushUrls).toEqual([]);
  });

  it('laisse passer les cles inconnues jusqu a la vue resolue', () => {
    const r = resolveCanonicalDesign(fromPostMetadata(EDGE_METADATA));
    expect((r.designOptions as Record<string, unknown>).champInconnuDansDesign)
      .toStrictEqual({ imbrique: { profond: [1, 2, 3] } });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('toComposerOptions — traduction', () => {
  it('traduit un post de l editeur avance', () => {
    const o = toComposerOptions(fromPostMetadata(ADVANCED_METADATA));
    // Le rush vient de `rushUrls[0]`, jamais de `videoUrl`.
    expect(o.videoUrl).toBe('https://media.exemple.test/rush.mp4');
    expect(o.posterUrl).toBe('https://media.exemple.test/poster.jpg');
    expect(o.logoUrl).toBe('https://media.exemple.test/logo.png');
    expect(o.introDuration).toBe(5);
    expect(o.videoDuration).toBe(10);
    expect(o.sequenceOrder).toEqual(['intro', 'cards', 'video', 'cta']);
    expect(o.accentColor).toBe('#a855f7');
    expect(o.musicUrl).toBe('https://media.exemple.test/musique.mp3');
    expect(o.audioKeyframes).toHaveLength(2);
    expect(o.sequenceVoiceUrls?.titre).toBe('https://media.exemple.test/voix-titre.mp3');
    expect(o.siteText?.text).toBe('exemple.test');
  });

  it('aplatit positions, tailles et typographie que le design imbrique', () => {
    const o = toComposerOptions(fromPostMetadata(ADVANCED_METADATA));
    expect(o.design?.titlePosition).toEqual({ x: 50, y: 10 });
    expect(o.design?.cardsPosition).toEqual({ x: 50, y: 50 });
    expect(o.design?.watermarkPosition).toEqual({ x: 50, y: 97 });
    expect(o.design?.logoPosition).toEqual({ x: 50, y: 85 });
    expect(o.design?.titleSize).toBe(90);
    expect(o.design?.cardsSize).toBe(92);
    expect(o.design?.watermarkSize).toBe(70);
    expect(o.design?.titleTypography?.bold).toBe(true);
    expect(o.design?.ctaTypography?.letterSpacing).toBe(2);
    expect(o.design?.cardsTypography?.valueGradient).toBe(true);
  });

  it('remet les incrustations, stockees a la racine, la ou le compositeur les lit', () => {
    const o = toComposerOptions(fromPostMetadata(ADVANCED_METADATA));
    expect(o.design?.overlayText).toBe('TEXTE INCRUSTE');
    expect(o.design?.overlayPosition).toEqual({ x: 50, y: 33 });
    expect(o.design?.overlayColor).toBe('#FFFFFF');
    expect(o.design?.overlayStartTime).toBe(0);
    expect(o.design?.overlayEndTime).toBe(-1);
    expect(o.design?.overlays).toHaveLength(1);
  });

  it('renomme `design.ctaSubText` en `ctaSubTextDesign`', () => {
    const o = toComposerOptions(fromPostMetadata(ADVANCED_METADATA));
    expect(o.design?.ctaSubTextDesign).toBe('CHAT POUR PLUS D INFOS');
    expect(o.ctaSubText).toBe('LIEN EN BIO');
  });

  it('donne les dimensions quand le post les porte, et rien sinon', () => {
    const avec = toComposerOptions(fromPostMetadata(ASSISTANT_METADATA));
    expect(avec.width).toBe(1080);
    expect(avec.height).toBe(1920);
    // Sans `videoSize`, aucune dimension n est inventee : c est a l appelant,
    // qui connait `post.format`, de trancher.
    const sans = toComposerOptions(fromPostMetadata(ADVANCED_METADATA));
    expect(sans.width).toBeUndefined();
    expect(sans.height).toBeUndefined();
  });

  it('ignore `videoUrl` quand il porte un montage et non un rush', () => {
    const o = toComposerOptions(fromPostMetadata(LEGACY_PARTIAL_METADATA));
    expect(o.videoUrl).toBe('https://media.exemple.test/ancien-rush.mp4');
  });

  it('complete une carte incomplete plutot que de la faire disparaitre', () => {
    const o = toComposerOptions(fromPostMetadata({ cards: [{ label: 'Seul' }] }));
    expect(o.cards).toEqual([{ label: 'Seul', emoji: '', value: '' }]);
  });

  it('transmet un zero enregistre au lieu de le remplacer par un defaut', () => {
    const o = toComposerOptions(fromPostMetadata(EDGE_METADATA));
    expect(o.design?.gradientOpacity).toBe(0);
    expect(o.introDuration).toBe(0);
    expect(o.musicVolume).toBe(0);
    expect(o.design?.overlayTextScale).toBe(0);
  });

  it('omet l ordre des sequences quand il est vide — l option est opt-in', () => {
    expect(toComposerOptions(fromPostMetadata(EDGE_METADATA)).sequenceOrder).toBeUndefined();
    expect(toComposerOptions(fromPostMetadata({})).sequenceOrder).toBeUndefined();
  });

  it('ecarte un filigrane de site sans texte, que le compositeur refuserait', () => {
    const o = toComposerOptions(fromPostMetadata({ design: { siteText: { color: '#FFF' } } }));
    expect(o.siteText).toBeUndefined();
  });

  it('ne declenche aucun rendu et reste deterministe', () => {
    const design = fromPostMetadata(ADVANCED_METADATA);
    expect(toComposerOptions(design)).toStrictEqual(toComposerOptions(design));
    expect(toComposerOptions(fromPostMetadata(ADVANCED_METADATA)))
      .toStrictEqual(toComposerOptions(fromPostMetadata(ADVANCED_METADATA)));
  });

  it('n altere pas le design qu on lui donne', () => {
    const design = fromPostMetadata(ADVANCED_METADATA);
    toComposerOptions(design);
    expect(toPostMetadata(design, ADVANCED_METADATA)).toStrictEqual(ADVANCED_METADATA);
  });
});
