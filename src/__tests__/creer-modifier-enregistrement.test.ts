import { describe, it, expect, vi } from 'vitest';
import { metadataPourEnregistrement } from '../lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '../lib/creer/postMetadata';
import { enregistrerModification } from '../lib/creer/savePost';

/**
 * Ce que la modification renvoie au serveur — et surtout ce qu'elle NE renvoie
 * pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PIÈGE QUE CES TESTS EXISTENT POUR FERMER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `mergePostMetadata` fusionne au niveau des CLÉS DE PREMIER NIVEAU : une clé
 * envoyée remplace l'existante ENTIÈREMENT. Envoyer un `design` partiel —
 * seulement les champs que le parcours guidé règle — effacerait donc
 * `design.siteText` (le filigrane), `design.font`, `design.sizes`, et tout ce
 * que l'éditeur avancé a pu y écrire. La perte serait silencieuse : la colonne
 * `jsonb` n'a pas d'historique.
 *
 * D'où la règle de ce module : les objets imbriqués sont recomposés à partir de
 * l'EXISTANT, jamais reconstruits de zéro. Ce que le wizard ne connaît pas
 * traverse la modification intact.
 *
 * Ce module ne fait AUCUN appel réseau et ne modifie pas ses arguments.
 */

/** Une metadata riche, telle que l'éditeur avancé a pu la laisser. */
const EXISTANT = {
  type: 'infographic',
  source: 'assistant-simple',
  subtitle: 'ancien sous-titre',
  theme: 'sport',
  cards: [{ emoji: '🔥', label: 'Ancienne', value: '1', description: 'd', color: '#000' }],
  videoSize: { w: 1080, h: 1920 },
  renderedVideoUrl: 'https://exemple.test/montage.mp4',
  thumbnailUrl: 'https://exemple.test/vignette.jpg',
  composerVersion: 7,
  hasAudio: true,
  musicVolume: 0.3,
  branding: { accentColor: '#111111', ctaText: 'ancien', ctaSubText: 'ancien sub', borderEnabled: true },
  sequences: { intro: 3, cards: 8, video: 0, cta: 2, total: 13, order: ['intro', 'cards', 'cta'] },
  design: {
    textAnimation: 'none',
    font: 'Inter',
    titleAlign: 'left',
    siteText: 'monsite.example',
    sizes: { title: 0.8, watermark: 0.3 },
    gradientColor1: '#111111',
    gradientColor2: '#222222',
    gradientOpacity: 0.2,
    positions: { title: { x: 1, y: 2 }, watermark: { x: 3, y: 4 }, elements: [] },
  },
  // Une cle qu'aucun module ne declare — elle doit survivre a tout.
  cleInconnueDeTous: { garde: 'moi', profond: { oui: true } },
};

/** Ce que le parcours guidé sait produire après modification. */
const VALEURS = {
  subtitle: 'nouveau sous-titre',
  theme: 'danse',
  cards: [{ emoji: '💧', label: 'Nouvelle', value: '2', description: 'dd', color: '#EC4899' }],
  accentColor: '#EC4899',
  ctaText: 'Nouveau CTA',
  ctaSubText: 'nouveau sub',
  textAnimation: 'fade',
  gradientColor1: '#7C3AED',
  gradientColor2: '#EC4899',
  gradientOpacity: 0.6,
  titlePos: { x: 10, y: 20 },
  ctaPos: { x: 30, y: 40 },
  elements: [],
  sequences: { intro: 4, cards: 9, video: 0, cta: 3, total: 16, order: ['intro', 'cards', 'cta'] },
  videoSize: { w: 1080, h: 1080 },
  posterUrl: 'https://exemple.test/nouvelle-affiche.jpg',
  musicUrl: undefined,
  voiceUrl: undefined,
  musicVolume: 0,
  voiceVolume: 0.8,
  sequenceVoiceUrls: undefined,
  rushUrls: undefined,
  audioKeyframes: [],
  cardGroups: [],
  hasAudio: false,
};

describe('ce que le wizard a modifié part bien', () => {
  const envoi = metadataPourEnregistrement(EXISTANT, VALEURS);

  it('les textes et les cartes sont à jour', () => {
    expect(envoi.subtitle).toBe('nouveau sous-titre');
    expect(envoi.theme).toBe('danse');
    expect(envoi.cards).toEqual(VALEURS.cards);
  });

  it('le branding est à jour', () => {
    expect(envoi.branding).toMatchObject({
      accentColor: '#EC4899', ctaText: 'Nouveau CTA', ctaSubText: 'nouveau sub',
    });
  });

  it('le design réglable est à jour', () => {
    const design = envoi.design as Record<string, unknown>;
    expect(design.textAnimation).toBe('fade');
    expect(design.gradientColor1).toBe('#7C3AED');
    expect(design.gradientOpacity).toBe(0.6);
    expect(design.positions).toEqual({
      title: { x: 10, y: 20 }, watermark: { x: 30, y: 40 }, elements: [],
    });
  });
});

describe('rien de ce que le wizard ignore n\'est perdu', () => {
  const envoi = metadataPourEnregistrement(EXISTANT, VALEURS);

  it('les champs de `design` que le parcours ne règle pas survivent', () => {
    // LE test de ce module. `design` est remplace en entier par la fusion :
    // l'envoyer partiel effacerait le filigrane et la police.
    const design = envoi.design as Record<string, unknown>;
    expect(design.siteText).toBe('monsite.example');
    expect(design.font).toBe('Inter');
    expect(design.titleAlign).toBe('left');
    expect(design.sizes).toEqual({ title: 0.8, watermark: 0.3 });
  });

  it('les champs de `branding` que le parcours ne règle pas survivent', () => {
    expect((envoi.branding as Record<string, unknown>).borderEnabled).toBe(true);
  });

  it('le montage déjà rendu n\'est pas touché', () => {
    // Modifier des textes ne rend pas une nouvelle video : y toucher ferait
    // pointer le post vers un fichier qui ne correspond a rien.
    expect(envoi.renderedVideoUrl).toBeUndefined();
    expect(envoi.thumbnailUrl).toBeUndefined();
    expect(envoi.composerVersion).toBeUndefined();
  });

  it('une clé que personne ne déclare n\'est même pas renvoyée — donc conservée', () => {
    expect(envoi.cleInconnueDeTous).toBeUndefined();
  });

  it('après fusion serveur, TOUT est encore là', () => {
    // La preuve de bout en bout : on rejoue la fusion reelle du serveur.
    const fusionne = mergePostMetadata(EXISTANT, envoi);
    expect(fusionne.cleInconnueDeTous).toEqual({ garde: 'moi', profond: { oui: true } });
    expect(fusionne.renderedVideoUrl).toBe('https://exemple.test/montage.mp4');
    expect(fusionne.thumbnailUrl).toBe('https://exemple.test/vignette.jpg');
    expect(fusionne.composerVersion).toBe(7);
    expect(fusionne.type).toBe('infographic');
    expect((fusionne.design as Record<string, unknown>).siteText).toBe('monsite.example');
    expect((fusionne.design as Record<string, unknown>).font).toBe('Inter');
    expect((fusionne.branding as Record<string, unknown>).borderEnabled).toBe(true);
    // ... et les modifications ont bien pris.
    expect(fusionne.subtitle).toBe('nouveau sous-titre');
    expect((fusionne.design as Record<string, unknown>).textAnimation).toBe('fade');
  });
});

describe('valeurs falsy — envoyées, pas effacées', () => {
  it('un volume remis à 0 part bien à 0', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, VALEURS);
    expect(envoi.musicVolume).toBe(0);
    const fusionne = mergePostMetadata(EXISTANT, envoi);
    expect(fusionne.musicVolume).toBe(0);
  });

  it('`hasAudio` remis à false part bien à false', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, VALEURS);
    expect(envoi.hasAudio).toBe(false);
    expect(mergePostMetadata(EXISTANT, envoi).hasAudio).toBe(false);
  });

  it('un sous-titre vidé exprès part bien vide', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...VALEURS, subtitle: '' });
    expect(envoi.subtitle).toBe('');
    expect(mergePostMetadata(EXISTANT, envoi).subtitle).toBe('');
  });

  it('une liste de cartes vidée part bien vide', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...VALEURS, cards: [] });
    expect(envoi.cards).toEqual([]);
    expect(mergePostMetadata(EXISTANT, envoi).cards).toEqual([]);
  });

  it('une opacité remise à 0 part bien à 0', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, { ...VALEURS, gradientOpacity: 0 });
    expect((envoi.design as Record<string, unknown>).gradientOpacity).toBe(0);
  });
});

describe('médias absents — on n\'efface pas ce qu\'on ne sait pas', () => {
  it('une musique absente de l\'état n\'est pas envoyée, donc pas effacée', () => {
    // `undefined` signifie « le wizard n'en porte pas », pas « supprimez-la ».
    // La difference compte : un rush televerse par l'editeur avance ne doit pas
    // disparaitre parce que le parcours guide ne l'affiche pas.
    const envoi = metadataPourEnregistrement(
      { ...EXISTANT, musicUrl: 'https://exemple.test/musique.mp3' },
      VALEURS,
    );
    expect('musicUrl' in envoi).toBe(false);
    const fusionne = mergePostMetadata(
      { ...EXISTANT, musicUrl: 'https://exemple.test/musique.mp3' }, envoi,
    );
    expect(fusionne.musicUrl).toBe('https://exemple.test/musique.mp3');
  });

  it('une affiche renseignée est bien envoyée', () => {
    const envoi = metadataPourEnregistrement(EXISTANT, VALEURS);
    expect(envoi.posterUrl).toBe('https://exemple.test/nouvelle-affiche.jpg');
  });
});

describe('le module ne fait que composer', () => {
  it('ne modifie ni la metadata existante, ni les valeurs reçues', () => {
    const existant = JSON.parse(JSON.stringify(EXISTANT));
    const valeurs = JSON.parse(JSON.stringify(VALEURS));
    const copieE = JSON.parse(JSON.stringify(existant));
    const copieV = JSON.parse(JSON.stringify(valeurs));
    metadataPourEnregistrement(existant, valeurs);
    expect(existant).toEqual(copieE);
    expect(valeurs).toEqual(copieV);
  });

  it('une metadata existante absente ou abîmée ne fait pas échouer la composition', () => {
    for (const abime of [undefined, null, 'texte', 42, []]) {
      const envoi = metadataPourEnregistrement(abime, VALEURS);
      expect(envoi.subtitle).toBe('nouveau sous-titre');
      expect((envoi.design as Record<string, unknown>).textAnimation).toBe('fade');
    }
  });
});

/**
 * L'envoi lui-même : un PATCH, sur demande explicite, et jamais rien d'autre.
 *
 * Le 409 mérite son propre soin. `PATCH /api/posts/[id]` protège les mises à
 * jour portant `metadata` par un contrôle optimiste sur `updated_at` : si la
 * ligne a bougé depuis la lecture, l'écriture est refusée plutôt qu'appliquée
 * par-dessus. Sans traitement dédié côté client, ce refus passerait pour une
 * panne quelconque — et l'utilisateur croirait avoir enregistré alors que rien
 * n'a été écrit. C'est le pire des deux mondes : un travail perdu ET la
 * conviction qu'il est sauvé.
 */
describe('envoi de la modification', () => {
  function reponse(status: number, corps: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => corps } as Response;
  }

  it('un seul appel, en PATCH, sur la bonne route', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: { id: 'post-42' } }));
    const r = await enregistrerModification('post-42', { metadata: { subtitle: 'x' } }, f);
    expect(r.kind).toBe('ok');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/posts/post-42');
    expect(init.method).toBe('PATCH');
  });

  it('n\'envoie JAMAIS de `user_id` — il vient de la session côté serveur', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: {} }));
    await enregistrerModification(
      'post-42',
      { metadata: { subtitle: 'x' } } as Record<string, unknown>,
      f,
    );
    const corps = String(f.mock.calls[0][1].body);
    expect(corps).not.toContain('user_id');
  });

  it('un conflit (409) a sa propre issue — pas une panne anonyme', async () => {
    const f = vi.fn().mockResolvedValue(reponse(409, { success: false, error: 'Conflict' }));
    expect(await enregistrerModification('post-42', { metadata: {} }, f))
      .toEqual({ kind: 'conflit' });
  });

  it('les autres refus gardent leur nom', async () => {
    const cas: Array<[number, string]> = [
      [401, 'session'], [403, 'refuse'], [404, 'introuvable'], [422, 'invalide'], [500, 'erreur'],
    ];
    for (const [status, attendu] of cas) {
      const f = vi.fn().mockResolvedValue(reponse(status, { success: false }));
      expect((await enregistrerModification('post-42', { metadata: {} }, f)).kind).toBe(attendu);
    }
  });

  it('une coupure réseau est distinguée d\'un refus — elle se réessaie', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await enregistrerModification('post-42', { metadata: {} }, f))
      .toEqual({ kind: 'reseau' });
  });

  it('un identifiant vide n\'atteint jamais le réseau', async () => {
    const f = vi.fn();
    expect((await enregistrerModification('  ', { metadata: {} }, f)).kind).toBe('erreur');
    expect(f).not.toHaveBeenCalled();
  });

  it('ne rend, ne débite et ne publie rien : un seul appel, et c\'est le PATCH', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: {} }));
    await enregistrerModification('post-42', { metadata: {} }, f);
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(['/api/posts/post-42']);
  });
});
