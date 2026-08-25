import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as contrat from '@/lib/creer/postMetadata';
import {
  DEFAULT_CANONICAL_DESIGN,
  MANAGED_FIELDS,
  fromPostMetadata,
  isPostMetadataUnchanged,
  mergePostMetadata,
  resolveCanonicalDesign,
  toPostMetadata,
} from '@/lib/creer/postMetadata';
import { deepClone, deepFreeze } from '@/lib/creer/postMetadata/testing';
import { DEFAULT_DURATIONS } from '@/lib/creer/designSpec';
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
    expect(DEFAULT_CANONICAL_DESIGN.sequences.intro).toBe(DEFAULT_DURATIONS.intro);
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
    expect(r.sequences.intro).toBe(DEFAULT_DURATIONS.intro);
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

describe('defauts — une seule source de verite', () => {
  it('les durees de sequence sont celles de designSpec, jamais redites', () => {
    expect(DEFAULT_CANONICAL_DESIGN.sequences.intro).toBe(DEFAULT_DURATIONS.intro);
    expect(DEFAULT_CANONICAL_DESIGN.sequences.cards).toBe(DEFAULT_DURATIONS.cards);
    expect(DEFAULT_CANONICAL_DESIGN.sequences.video).toBe(DEFAULT_DURATIONS.video);
    expect(DEFAULT_CANONICAL_DESIGN.sequences.cta).toBe(DEFAULT_DURATIONS.cta);
  });

  it('les tire par IMPORT et non par recopie', () => {
    // Une egalite de valeurs ne prouve rien : deux tables identiques
    // aujourd hui divergent au premier reglage change d un seul cote. Ce qui
    // protege, c est le lien lui-meme.
    const source = readFileSync(
      resolve(__dirname, '../lib/creer/postMetadata/defaults.ts'),
      'utf-8',
    );
    expect(source).toContain("import { DEFAULT_DURATIONS } from '@/lib/creer/designSpec'");
    for (const cle of ['intro', 'cards', 'video', 'cta'] as const) {
      expect(source).toContain(`${cle}: DEFAULT_DURATIONS.${cle}`);
    }
    // Et aucune duree ecrite en chiffre DANS LE CODE : c'est la recopie
    // qu'on interdit. Les commentaires, eux, ont le droit de citer les
    // valeurs de `main` pour expliquer d'ou elles viennent.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(intro|cards|video|cta):\s*\d/);
  });

  it('ne defaute AUCUNE dimension, bien que designSpec en propose', () => {
    // `VIDEO_SIZE` existe, mais choisir 1080x1920 recadrerait tout montage
    // paysage ou carre dont le post ne porte pas `videoSize`.
    expect(DEFAULT_CANONICAL_DESIGN.format.videoSize).toBeNull();
    expect(resolveCanonicalDesign(fromPostMetadata({})).format.videoSize).toBeNull();
  });
});

describe('perimetre du lot — le compositeur reste dehors', () => {
  it('n exporte pas `toComposerOptions`', () => {
    expect(Object.keys(contrat)).not.toContain('toComposerOptions');
    expect((contrat as Record<string, unknown>).toComposerOptions).toBeUndefined();
  });

  it('ne contient plus le fichier de traduction', () => {
    expect(existsSync(resolve(__dirname, '../lib/creer/postMetadata/to-composer.ts'))).toBe(false);
  });

  it('ne fait dependre aucun type de `ComposerOptions`', () => {
    // Le contrat est une couche de PERSISTANCE : la faire dependre d un
    // module de rendu cote navigateur la rendrait inutilisable cote serveur.
    const types = readFileSync(
      resolve(__dirname, '../lib/creer/postMetadata/types.ts'),
      'utf-8',
    );
    // On vise la DECLARATION d'import, quelle que soit sa mise en forme —
    // une liste sur une ligne, ou `ComposerOptions` ailleurs qu'en dernier,
    // passaient au travers d'une comparaison de texte litterale.
    const imports = types.match(/import[\s\S]*?from\s*'[^']+';/g) ?? [];
    const depuisCompositeur = imports.filter((i) => i.includes('@/lib/video-composer'));
    expect(depuisCompositeur.length).toBeGreaterThan(0);
    for (const decl of depuisCompositeur) {
      expect(decl).not.toMatch(/\bComposerOptions\b/);
    }
    // Et aucune derivation de type non plus.
    expect(types).not.toMatch(/ComposerOptions\s*\[/);
  });
});

describe('pollution de prototype', () => {
  /** `JSON.parse` cree une cle PROPRE `__proto__` — un litteral, lui, muterait le prototype. */
  const empoisonne = () => JSON.parse('{"__proto__":{"pollue":true},"subtitle":"ok"}');

  it('ne laisse pas `__proto__` contaminer Object.prototype a la lecture', () => {
    const d = fromPostMetadata(empoisonne());
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(d.passthrough, '__proto__')).toBe(true);
    expect(d.content.subtitle).toBe('ok');
  });

  it('ne la laisse pas contaminer non plus a la reecriture', () => {
    const merged = toPostMetadata(fromPostMetadata(empoisonne()), empoisonne());
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true);
  });

  it('ne la laisse pas contaminer a la fusion d un fragment client', () => {
    const merged = mergePostMetadata({ subtitle: 'avant' }, empoisonne());
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(merged.subtitle).toBe('ok');
  });
});

describe('comportement deterministe', () => {
  it.each(FIXTURES)('%s : deux lectures identiques rendent le meme design', (_label, fixture) => {
    expect(fromPostMetadata(frozen(fixture))).toStrictEqual(fromPostMetadata(frozen(fixture)));
  });

  it.each(FIXTURES)('%s : deux ecritures identiques rendent les memes metadonnees', (_label, fixture) => {
    const d = fromPostMetadata(frozen(fixture));
    expect(toPostMetadata(d, frozen(fixture))).toStrictEqual(toPostMetadata(d, frozen(fixture)));
  });

  it('la resolution est stable et ne depend d aucun etat exterieur', () => {
    const d = fromPostMetadata(frozen(EDGE_METADATA));
    expect(resolveCanonicalDesign(d)).toStrictEqual(resolveCanonicalDesign(d));
  });
});

describe('mergePostMetadata — le fragment du client', () => {
  /**
   * C'est la fonction qui justifie ce lot : les routes API remplacent
   * aujourd'hui la colonne `metadata` entiere par ce que le client renvoie,
   * detruisant tout ce qu'il n'a pas envoye.
   */
  it('ce que le client n envoie PAS survit', () => {
    const existant = { subtitle: 'avant', theme: 'sport', error: null, objective: 'ventes' };
    const merged = mergePostMetadata(frozen(existant), { subtitle: 'apres' });
    expect(merged.subtitle).toBe('apres');
    expect(merged.theme).toBe('sport');
    expect(merged.error).toBeNull();
    expect(merged.objective).toBe('ventes');
  });

  it('un zero, un false ou une chaine vide envoyes ECRASENT bien l ancienne valeur', () => {
    const merged = mergePostMetadata(
      frozen({ musicVolume: 0.8, hasAudio: true, subtitle: 'plein' }),
      { musicVolume: 0, hasAudio: false, subtitle: '' },
    );
    expect(merged.musicVolume).toBe(0);
    expect(merged.hasAudio).toBe(false);
    expect(merged.subtitle).toBe('');
  });

  it('fusionne au PREMIER NIVEAU : un objet imbriqué envoye remplace l ancien', () => {
    // Une fusion profonde interdirait de retirer une cle imbriquee et
    // rendrait le sort des tableaux ambigu. Le remplacement est le contrat.
    const merged = mergePostMetadata(
      frozen({ design: { titleFont: 'Anton', ctaFont: 'Syne' } }),
      { design: { titleFont: 'Bebas' } },
    );
    expect(merged.design).toStrictEqual({ titleFont: 'Bebas' });
  });

  it('preserve les cles inconnues du fragment entrant', () => {
    const merged = mergePostMetadata(frozen({ subtitle: 'a' }), { champTotalementInconnu: [1, 2] });
    expect(merged.champTotalementInconnu).toStrictEqual([1, 2]);
    expect(merged.subtitle).toBe('a');
  });

  it('ne mute ni l existant ni le fragment', () => {
    const existant = frozen({ subtitle: 'avant', design: { titleFont: 'Anton' } });
    const entrant = frozen({ subtitle: 'apres' });
    const merged = mergePostMetadata(existant, entrant);
    expect(existant).toStrictEqual({ subtitle: 'avant', design: { titleFont: 'Anton' } });
    expect(entrant).toStrictEqual({ subtitle: 'apres' });
    expect(merged).not.toBe(existant);
  });

  it('tolere n importe quelle entree sans lever', () => {
    for (const absurde of [null, undefined, 'texte', 42, [], true]) {
      expect(() => mergePostMetadata(absurde, { subtitle: 'ok' })).not.toThrow();
      expect(() => mergePostMetadata({ subtitle: 'ok' }, absurde)).not.toThrow();
    }
  });
});

describe('garde-fous de structure', () => {
  it('la table des champs geres n a ni cle ni chemin en double', () => {
    // Un chemin duplique par copier-coller ferait disparaitre une cle en
    // silence : la seconde entree ecraserait la premiere a la lecture.
    const cles = MANAGED_FIELDS.map((f) => f.key);
    const chemins = MANAGED_FIELDS.map((f) => f.path);
    expect(new Set(cles).size).toBe(cles.length);
    expect(new Set(chemins).size).toBe(chemins.length);
  });

  it('la vue resolue est gelee, comme la lecture', () => {
    const r = resolveCanonicalDesign(fromPostMetadata(ADVANCED_METADATA));
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r.sequences as Record<string, unknown>).intro = 99;
    }).toThrow();
  });

  it('la vue resolue abandonne `present` et `passthrough` — a dessein', () => {
    // Sans ces deux champs, `ResolvedCanonicalDesign` ne satisfait pas
    // `CanonicalDesign` : le typage interdit de repasser la vue a
    // `toPostMetadata`, donc de graver un defaut d affichage en base.
    const r = resolveCanonicalDesign(fromPostMetadata(EDGE_METADATA)) as unknown as Record<string, unknown>;
    expect(r.present).toBeUndefined();
    expect(r.passthrough).toBeUndefined();
  });
});
