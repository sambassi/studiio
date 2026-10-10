/**
 * CRÉER — RECADRAGE PAR RUSH : chaque rush a SON recadrage (clé = URL).
 *
 * - le compositeur peint chaque rush avec le sien (A → crop A, B → crop B,
 *   C non recadré → « cover » centré) ;
 * - l'ancien `rushTransform` unique ne vaut que pour le rush principal ;
 * - brouillon, metadata (création / Modifier) et « Régénérer » (mono-rush,
 *   multi-rush, plan de montage) gardent chaque recadrage sur SON rush ;
 * - recadrer un rush ne touche pas les autres ; retirer un rush retire le sien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bornerRecadrageRush, rectangleRush, recadragePourRushPeint, avecRecadrageRush, recadragesPourRushs,
  recadragesRushAvecHeritage, recadragesRushValides, recadrageDuRush, RECADRAGE_RUSH_NEUTRE,
} from '../lib/creer/recadrage-rush';
import { drawVideoSeq } from '../lib/video-composer';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '../lib/creer/draft';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';
import { metadataPourEnregistrement } from '../lib/creer/postMetadata/from-wizard';
import { optionsRenduDepuisMetadata } from '../lib/rendus/options-depuis-metadata';
import { renderSignature } from '../lib/creer/renderSignature';

const A = 'https://cdn.test/media/u1/a.mp4';
const B = 'https://cdn.test/media/u1/b.mp4';
const C = 'https://cdn.test/media/u1/c.mp4';
const W = 1080; const H = 1920;
// Sources 16:9 dans un cadre 9:16 : beaucoup de marge horizontale.
const SRC = { srcW: 1920, srcH: 1080, w: W, h: H };
const CROP_A = bornerRecadrageRush({ scale: 1.5, offsetX: -0.4, offsetY: 0.1 }, SRC);
const CROP_B = bornerRecadrageRush({ scale: 1.2, offsetX: 0.5, offsetY: -0.05 }, SRC);

/** Le rectangle que trace `drawVideoSeq` pour un recadrage donné (contexte factice). */
function trace(t: unknown) {
  const appels: number[][] = [];
  const ctx = new Proxy({}, {
    get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const video = { videoWidth: SRC.srcW, videoHeight: SRC.srcH } as unknown as HTMLVideoElement;
  drawVideoSeq(ctx, W, H, video, null, 0.5, undefined, t as never);
  const [x, y, l, h] = appels[0];
  return { x, y, l, h };
}
const attendu = (t: unknown) => rectangleRush(SRC.srcW, SRC.srcH, W, H, t as never);
const egal = (r: { x: number; y: number; l: number; h: number }, e: { x: number; y: number; l: number; h: number }) => {
  for (const k of ['x', 'y', 'l', 'h'] as const) expect(r[k]).toBeCloseTo(e[k], 3);
};

describe('Compositeur — chaque rush est peint avec SON recadrage', () => {
  const options = { rushTransforms: { [A]: CROP_A, [B]: CROP_B }, videoUrl: A };

  it('⚠️ rush A → crop A, rush B → crop B, rush C (non recadré) → cover centré', () => {
    egal(trace(recadragePourRushPeint(A, options)), attendu(CROP_A));
    egal(trace(recadragePourRushPeint(B, options)), attendu(CROP_B));
    const c = trace(recadragePourRushPeint(C, options));
    egal(c, attendu(RECADRAGE_RUSH_NEUTRE));
    // Centré : même débord des deux côtés.
    expect(c.x + c.l / 2).toBeCloseTo(W / 2, 3);
    expect(c.y + c.h / 2).toBeCloseTo(H / 2, 3);
    // Et les trois sont bien différents.
    expect(trace(recadragePourRushPeint(A, options)).x).not.toBeCloseTo(trace(recadragePourRushPeint(B, options)).x, 1);
  });

  it('⚠️ héritage : l’ancien `rushTransform` unique ne vaut QUE pour le rush principal', () => {
    const legacy = { rushTransform: CROP_A, videoUrl: A };
    expect(recadragePourRushPeint(A, legacy)).toEqual(CROP_A);
    expect(recadragePourRushPeint(B, legacy)).toBeUndefined();
    egal(trace(recadragePourRushPeint(B, legacy)), attendu(RECADRAGE_RUSH_NEUTRE));
    // Mono-rush d'avant : identique au rendu d'avant.
    egal(trace(recadragePourRushPeint(A, legacy)), attendu(CROP_A));
    // Image fixe à la place du rush (pas d'URL) : l'ancien recadrage, comme avant.
    expect(recadragePourRushPeint(null, legacy)).toEqual(CROP_A);
    // Une entrée de la table l'emporte sur l'héritage.
    expect(recadragePourRushPeint(A, { ...legacy, rushTransforms: { [A]: CROP_B } })).toEqual(CROP_B);
  });

  it('le compositeur résout le recadrage du rush COURANT par son URL (multi-rush, montage, double tampon)', () => {
    const src = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    expect(src).toContain('rushTransforms?: Record<string, { scale?: number; offsetX?: number; offsetY?: number }> | null;');
    expect(src).toContain('for (const r of rushsLus) urlParLecteur.set(r.el, r.url);');
    expect(src).toContain('secondsTampons.forEach((el, u) => urlParLecteur.set(el, u));');
    expect(src).toContain('const recadrageCourant = recadragePourRushPeint(rushCourant ? urlParLecteur.get(rushCourant) : null, { rushTransforms: options.rushTransforms, rushTransform, videoUrl });');
    expect(src).toContain('normalizedDesign, recadrageCourant, videoImageEl');
  });

  it('la signature de rendu change quand le recadrage d’UN rush change', () => {
    const base = { videoUrl: A, rushs: [{ url: A }, { url: B }] };
    const s1 = renderSignature({ ...base, rushTransforms: { [A]: CROP_A } });
    const s2 = renderSignature({ ...base, rushTransforms: { [A]: CROP_A, [B]: CROP_B } });
    expect(s1).not.toBe(s2);
    expect(renderSignature({ ...base, rushTransforms: { [B]: CROP_B, [A]: CROP_A } })).toBe(s2);
  });
});

describe('Table des recadrages — un rush ne touche jamais les autres', () => {
  it('recadrer B ne change pas A ; revenir au neutre retire l’entrée', () => {
    const t1 = avecRecadrageRush({}, A, CROP_A);
    const t2 = avecRecadrageRush(t1, B, CROP_B);
    expect(t2[A]).toEqual(CROP_A);
    expect(t1).toEqual({ [A]: CROP_A }); // pas de mutation
    const t3 = avecRecadrageRush(t2, B, { scale: 1.8, offsetX: 0, offsetY: 0 });
    expect(t3[A]).toEqual(CROP_A);
    expect(t3[B]).toEqual({ scale: 1.8, offsetX: 0, offsetY: 0 });
    expect(avecRecadrageRush(t3, B, RECADRAGE_RUSH_NEUTRE)).toEqual({ [A]: CROP_A });
  });

  it('retirer un rush retire son recadrage ; réordonner ne change rien', () => {
    const t = { [A]: CROP_A, [B]: CROP_B };
    expect(recadragesPourRushs(t, [A])).toEqual({ [A]: CROP_A });
    expect(recadragesPourRushs(t, [B, A])).toEqual(t);
    expect(recadragesPourRushs(t, [])).toEqual({});
  });

  it('non recadré → neutre ; tables abîmées nettoyées', () => {
    expect(recadrageDuRush({ [A]: CROP_A }, C)).toEqual(RECADRAGE_RUSH_NEUTRE);
    expect(recadragesRushValides({ [A]: CROP_A, [B]: { scale: 9, offsetX: 0, offsetY: 0 }, [C]: RECADRAGE_RUSH_NEUTRE, '': CROP_A }))
      .toEqual({ [A]: CROP_A });
    expect(recadragesRushValides('nope')).toEqual({});
  });

  it('héritage : table présente = elle fait foi ; sinon l’ancien unique → rush principal seulement', () => {
    expect(recadragesRushAvecHeritage(undefined, CROP_A, A)).toEqual({ [A]: CROP_A });
    expect(recadragesRushAvecHeritage({}, CROP_A, A)).toEqual({});
    expect(recadragesRushAvecHeritage({ [B]: CROP_B }, CROP_A, A)).toEqual({ [B]: CROP_B });
    expect(recadragesRushAvecHeritage(undefined, undefined, A)).toEqual({});
    expect(recadragesRushAvecHeritage(undefined, CROP_A, null)).toEqual({});
  });
});

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16'], maxStep: 3,
  defaults: {
    themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
    sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};

describe('Brouillon (autosave / rechargement)', () => {
  it('⚠️ aller-retour : chaque recadrage reste sur SON rush ; un rush absent de la liste perd le sien', () => {
    const brut = {
      version: DRAFT_VERSION, savedAt: 1,
      rushUrl: A, rushSecondes: 4, rushSuivants: [{ url: B, name: 'b', secondes: 6 }, { url: C, name: 'c', secondes: 3 }],
      rushTransforms: { [A]: CROP_A, [B]: CROP_B, 'https://cdn.test/media/u1/z.mp4': CROP_A },
    };
    const s = sanitizeDraft(JSON.parse(JSON.stringify(brut)), DEPS);
    expect(s?.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
    // C non recadré : aucune entrée.
    expect(s?.rushTransforms).not.toHaveProperty(C);
  });

  it('brouillon d’avant (recadrage unique) : relu, le wizard le rend au rush principal seulement', () => {
    const s = sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, rushUrl: A, rushSuivants: [{ url: B, name: 'b', secondes: 6 }], rushTransform: CROP_A }, DEPS);
    expect(s?.rushTransform).toEqual(CROP_A);
    expect(s?.rushTransforms).toBeUndefined();
    expect(recadragesRushAvecHeritage(s?.rushTransforms, s?.rushTransform, s?.rushUrl)).toEqual({ [A]: CROP_A });
  });
});

const post = (metadata: Record<string, unknown>) => ({
  id: 'p1', title: 'T', format: 'reel', metadata: {
    sequences: { intro: 3, cards: 0, video: 10, cta: 3, order: ['intro', 'video', 'cta'] },
    ...metadata,
  },
});
const prep = { cards: [], rushLut: null } as never;

describe('Metadata du post — création, Modifier (from-wizard / to-wizard)', () => {
  it('⚠️ aller-retour : metadata → brouillon garde chaque recadrage sur son rush', () => {
    const meta = {
      rushUrls: [A, B, C],
      rushSegments: [{ url: A, debut: 0, fin: 3 }, { url: B, debut: 3, fin: 7 }, { url: C, debut: 7, fin: 10 }],
      rushTransforms: { [A]: CROP_A, [B]: CROP_B },
    };
    const d = toWizardDraft(post(meta) as never);
    expect(d.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
    const s = sanitizeDraft({ ...JSON.parse(JSON.stringify(d)), version: DRAFT_VERSION, savedAt: 1 }, DEPS);
    expect(s?.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
  });

  it('post d’avant (rushTransform unique) : rouvert, seul le rush principal est recadré', () => {
    const d = toWizardDraft(post({
      rushUrls: [A, B],
      rushSegments: [{ url: A, debut: 0, fin: 4 }, { url: B, debut: 4, fin: 10 }],
      rushTransform: CROP_A,
    }) as never);
    expect(d.rushTransforms).toEqual({ [A]: CROP_A });
  });

  it('Modifier : changer le recadrage d’un rush part ; sans changement rien n’est écrit ; tout retirer envoie {}', () => {
    const charge = { rushTransforms: { [A]: CROP_A } };
    const existante = { rushUrls: [A, B], rushTransforms: { [A]: CROP_A } };
    expect(metadataPourEnregistrement(existante, { rushTransforms: { [A]: CROP_A } }, charge)).not.toHaveProperty('rushTransforms');
    const envoi = metadataPourEnregistrement(existante, { rushTransforms: { [A]: CROP_A, [B]: CROP_B } }, charge);
    expect(envoi.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
    // Relu tel qu'enregistré.
    const relu = toWizardDraft(post({ ...existante, ...envoi }) as never);
    expect(relu.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
    // Tout retirer : `{}` part, et fait foi sur un ancien `rushTransform`.
    const vide = metadataPourEnregistrement(existante, { rushTransforms: {} }, charge);
    expect(vide.rushTransforms).toEqual({});
    expect(toWizardDraft(post({ rushUrls: [A], rushTransform: CROP_A, rushTransforms: {} }) as never).rushTransforms).toBeUndefined();
  });
});

describe('Calendrier « Régénérer » (options-depuis-metadata)', () => {
  it('mono-rush, ancien post : le recadrage unique revient au rush principal', () => {
    const o = optionsRenduDepuisMetadata(post({ rushUrls: [A], rushTransform: CROP_A }) as never, 'regenerer', prep);
    expect(o.rushTransforms).toEqual({ [A]: CROP_A });
    expect(o.rushTransform).toBeUndefined();
  });

  it('⚠️ multi-rush : un recadrage par rush, le rush non recadré n’en a pas', () => {
    const o = optionsRenduDepuisMetadata(post({
      rushUrls: [A, B, C],
      rushSegments: [{ url: A, debut: 0, fin: 3 }, { url: B, debut: 3, fin: 7 }, { url: C, debut: 7, fin: 10 }],
      rushTransforms: { [A]: CROP_A, [B]: CROP_B },
    }) as never, 'regenerer', prep);
    expect(o.rushs?.map((r) => r.url)).toEqual([A, B, C]);
    expect(o.rushTransforms).toEqual({ [A]: CROP_A, [B]: CROP_B });
    expect(recadragePourRushPeint(C, { ...o, videoUrl: o.videoUrl })).toBeUndefined();
  });

  it('⚠️ plan de montage (extraits, rushes repris) : chaque extrait prend le recadrage de SON rush', () => {
    const o = optionsRenduDepuisMetadata(post({
      rushUrls: [A, B],
      rushSegments: [
        { url: B, debut: 0, fin: 3, depuis: 2 }, { url: A, debut: 3, fin: 6, depuis: 0 }, { url: B, debut: 6, fin: 10, depuis: 8 },
      ],
      rushTransforms: { [B]: CROP_B },
    }) as never, 'regenerer', prep);
    expect(o.montage?.length).toBe(3);
    expect(o.rushTransforms).toEqual({ [B]: CROP_B });
    for (const seg of o.montage!) {
      expect(recadragePourRushPeint(seg.url, o)).toEqual(seg.url === B ? CROP_B : undefined);
    }
  });

  it('plan de montage, ancien post : l’ancien recadrage unique ne va qu’au rush principal', () => {
    const o = optionsRenduDepuisMetadata(post({
      rushUrls: [A, B],
      rushSegments: [{ url: A, debut: 0, fin: 5, depuis: 1 }, { url: B, debut: 5, fin: 10, depuis: 0 }],
      rushTransform: CROP_A,
    }) as never, 'regenerer', prep);
    expect(o.rushTransforms).toEqual({ [A]: CROP_A });
  });

  it('aucun recadrage : clé absente (options d’avant)', () => {
    const o = optionsRenduDepuisMetadata(post({ rushUrls: [A] }) as never, 'regenerer', prep);
    expect(o).not.toHaveProperty('rushTransforms');
    expect(o).not.toHaveProperty('rushTransform');
  });
});

describe('Créer — chaîne écran → export (sources)', () => {
  const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

  it('un bouton « Recadrer » par rush de la liste, ouvrant la modale sur CE rush', () => {
    expect(wizard).toContain('data-rush-item-recadrer');
    expect(wizard).toContain('onClick={() => setRecadrerRushOuvert(r.url)}');
    expect(wizard).toContain('onClick={() => setRecadrerRushOuvert(rushUrl)}');
    expect(wizard).toContain('valeur={recadrageDuRush(rushTransforms, recadrerRushOuvert)}');
    expect(wizard).toContain('onChange={(t) => setRushTransforms((prev) => avecRecadrageRush(prev, recadrerRushOuvert, t))}');
  });

  it('le plateau montre le recadrage du rush qu’il affiche ; l’export reçoit la table par rush', () => {
    expect(wizard).toContain('const rushTransform: RecadrageRush = recadrageDuRush(rushTransforms, rushUrl);');
    expect(wizard).toContain('? recadragesRendu(plateau.rushUrl, plateau.rushs, planMontageRushs)');
    expect(wizard).not.toContain('? { rushTransform }');
  });
});
