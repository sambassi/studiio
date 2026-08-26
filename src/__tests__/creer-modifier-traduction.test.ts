import { describe, it, expect } from 'vitest';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';
import { DRAFT_VERSION } from '../lib/creer/draft';

/**
 * Traduction d'un post enregistré vers l'état du parcours guidé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI PASSER PAR LE BROUILLON PLUTÔT QUE PAR 200 `setState`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le wizard sait DÉJÀ se remplir à partir d'un objet : c'est ce qu'il fait à
 * chaque rafraîchissement avec son brouillon local, par un bloc de `setState`
 * éprouvé et lui-même testé. Ce module produit donc un objet de la MÊME forme
 * (`Draft`), et le chemin d'application ne change pas d'une ligne.
 *
 * L'alternative — réécrire l'application champ par champ pour la modification —
 * aurait donné deux chemins de remplissage à maintenir, dont un seul est
 * exercé par les tests existants.
 *
 * `index.ts` du contrat documente trois défauts avérés de la traduction voisine
 * (`toComposerOptions`, retirée) : séquence vidéo fantôme, repli `videoUrl`
 * contraire au Calendrier, confusion `cardsTypography`/`cardsTextStyle`. Les
 * deux premiers viennent de la même faute — INVENTER une valeur là où la
 * metadata n'en portait pas. D'où la règle de ce module, vérifiée ci-dessous :
 * l'absence reste l'absence, et aucun défaut n'est injecté.
 *
 * Fonction PURE : aucune base, aucun réseau, aucun rendu.
 */

const POST_COMPLET = {
  id: 'post-42',
  title: 'MON TITRE',
  scheduled_date: '2026-09-01',
  metadata: {
    subtitle: 'mon sous-titre',
    theme: 'sport',
    videoSize: { w: 1080, h: 1920 },
    cards: [
      { emoji: '🔥', label: 'Carte A', value: '12', description: 'desc A', color: '#7C3AED' },
      { emoji: '💧', label: 'Carte B', value: '7', description: 'desc B', color: '#7C3AED' },
    ],
    posterUrl: 'https://exemple.test/affiche.jpg',
    musicUrl: 'https://exemple.test/musique.mp3',
    voiceUrl: 'https://exemple.test/voix.mp3',
    musicVolume: 0.4,
    voiceVolume: 1,
    rushUrls: ['https://exemple.test/rush.mp4'],
    sequenceVoiceUrls: { titre: 'https://exemple.test/v1.mp3' },
    sequences: { intro: 3, cards: 8, video: 5, cta: 2, total: 18, order: ['intro', 'cards', 'video', 'cta'] },
    branding: { accentColor: '#EC4899', ctaText: 'Rejoignez-nous', ctaSubText: 'dès aujourd\'hui' },
    design: {
      textAnimation: 'fade',
      gradientColor1: '#7C3AED',
      gradientColor2: '#EC4899',
      gradientOpacity: 0.5,
      positions: { title: { x: 10, y: 20 }, watermark: { x: 30, y: 40 }, elements: [] },
    },
  },
};

describe('un contenu enregistré revient entier', () => {
  const d = toWizardDraft(POST_COMPLET);

  it('le parcours s\'ouvre déjà commencé — jamais sur l\'écran d\'accueil', () => {
    // Un contenu existant qui rouvre sur « Que voulez-vous créer ? » donne
    // exactement l'impression de perte que ce lot combat.
    expect(d.started).toBe(true);
    expect(d.version).toBe(DRAFT_VERSION);
  });

  it('les textes reviennent', () => {
    expect(d.generated).toMatchObject({
      title: 'MON TITRE',
      subtitle: 'mon sous-titre',
      cta: 'Rejoignez-nous',
      ctaSub: 'dès aujourd\'hui',
    });
  });

  it('les cartes reviennent, avec leur vocabulaire d\'affichage', () => {
    // La metadata parle `emoji`/`label`, le wizard parle `icon`/`title`. Le
    // mapping est le point ou une carte se perd sans bruit.
    const cards = (d.generated as { cards: Array<Record<string, unknown>> }).cards;
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      icon: '🔥', title: 'Carte A', value: '12', description: 'desc A',
    });
    expect(typeof cards[0].id).toBe('string');
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it('le format est déduit des dimensions réelles du montage', () => {
    expect(d.format).toBe('9:16');
    expect(toWizardDraft({ ...POST_COMPLET, metadata: { videoSize: { w: 1080, h: 1080 } } }).format)
      .toBe('1:1');
    expect(toWizardDraft({ ...POST_COMPLET, metadata: { videoSize: { w: 1920, h: 1080 } } }).format)
      .toBe('16:9');
  });

  it('les durées de chaque séquence reviennent', () => {
    expect(d.introDuration).toBe(3);
    expect(d.cardsDuration).toBe(8);
    expect(d.videoDuration).toBe(5);
    expect(d.ctaDuration).toBe(2);
  });

  it('les séquences actives sont celles de l\'ordre enregistré', () => {
    expect(d.sequences).toEqual([
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: true },
      { key: 'cta', enabled: true },
    ]);
  });

  it('une séquence absente de l\'ordre revient désactivée', () => {
    const sansVideo = toWizardDraft({
      ...POST_COMPLET,
      metadata: { ...POST_COMPLET.metadata, sequences: { order: ['intro', 'cards', 'cta'] } },
    });
    expect(sansVideo.sequences).toContainEqual({ key: 'video', enabled: false });
  });

  it('les médias, l\'audio et le rush reviennent', () => {
    expect(d.posterUrl).toBe('https://exemple.test/affiche.jpg');
    expect(d.musicUrl).toBe('https://exemple.test/musique.mp3');
    expect(d.voiceUrl).toBe('https://exemple.test/voix.mp3');
    expect(d.musicVolume).toBe(0.4);
    expect(d.rushUrl).toBe('https://exemple.test/rush.mp4');
    expect(d.sequenceVoices?.titre?.audioUrl).toBe('https://exemple.test/v1.mp3');
  });

  it('les couleurs, l\'animation et les placements reviennent', () => {
    expect(d.colors).toEqual({
      accent: '#EC4899', gradStart: '#7C3AED', gradEnd: '#EC4899', gradientOpacity: 0.5,
    });
    expect(d.textAnimation).toBe('fade');
    expect(d.titlePos).toEqual({ x: 10, y: 20 });
    expect(d.ctaPos).toEqual({ x: 30, y: 40 });
  });

  it('la date programmée vient de la ligne du post, pas de sa metadata', () => {
    expect(d.scheduledDate).toBe('2026-09-01');
  });
});

describe('valeurs falsy — conservées exactement', () => {
  /**
   * LE piège de ce genre de traduction : `metadata.musicVolume ?? 1` paraît
   * prudent et transforme un silence VOULU (0) en volume plein. Idem pour un
   * sous-titre vidé exprès, ou une liste de cartes vidée.
   */
  it('un volume à 0 reste 0, jamais un défaut', () => {
    const d = toWizardDraft({ id: 'p', metadata: { musicVolume: 0, voiceVolume: 0 } });
    expect(d.musicVolume).toBe(0);
    expect(d.voiceVolume).toBe(0);
  });

  it('une durée à 0 reste 0', () => {
    const d = toWizardDraft({
      id: 'p', metadata: { sequences: { intro: 0, cards: 0, video: 0, cta: 0 } },
    });
    expect(d.introDuration).toBe(0);
    expect(d.cardsDuration).toBe(0);
    expect(d.videoDuration).toBe(0);
    expect(d.ctaDuration).toBe(0);
  });

  it('un texte vidé exprès reste vide', () => {
    const d = toWizardDraft({
      id: 'p', title: '', metadata: { subtitle: '', branding: { ctaText: '', ctaSubText: '' } },
    });
    expect(d.generated).toMatchObject({ title: '', subtitle: '', cta: '', ctaSub: '' });
  });

  it('une liste de cartes vidée reste vide — et n\'en réinvente aucune', () => {
    const d = toWizardDraft({ id: 'p', metadata: { cards: [] } });
    expect((d.generated as { cards: unknown[] }).cards).toEqual([]);
  });

  it('une opacité à 0 reste 0', () => {
    const d = toWizardDraft({
      id: 'p', metadata: { design: { gradientOpacity: 0 }, branding: { accentColor: '#000000' } },
    });
    expect(d.colors?.gradientOpacity).toBe(0);
  });

  it('une liste d\'éléments libres vidée reste vide', () => {
    const d = toWizardDraft({ id: 'p', metadata: { design: { positions: { elements: [] } } } });
    expect(d.elements).toEqual([]);
  });
});

describe('l\'absence reste l\'absence — aucun défaut injecté', () => {
  /**
   * C'est la règle qui évite les deux défauts avérés de `toComposerOptions` :
   * une séquence vidéo fantôme et un repli `videoUrl` que le Calendrier ignore
   * volontairement. Les deux venaient d'une valeur inventée là où la metadata
   * n'en portait pas.
   */
  const vide = toWizardDraft({ id: 'p', metadata: {} });

  it('aucune durée n\'est inventée', () => {
    expect(vide.introDuration).toBeUndefined();
    expect(vide.cardsDuration).toBeUndefined();
    expect(vide.videoDuration).toBeUndefined();
    expect(vide.ctaDuration).toBeUndefined();
  });

  it('aucun média n\'est inventé', () => {
    expect(vide.posterUrl).toBeUndefined();
    expect(vide.musicUrl).toBeUndefined();
    expect(vide.rushUrl).toBeUndefined();
  });

  it('aucun rush n\'est déduit d\'une vidéo rendue', () => {
    // `metadata.videoUrl` porte le MONTAGE sur les posts anciens, pas un rush :
    // le Calendrier l'ignore volontairement, et ce module aussi.
    const d = toWizardDraft({
      id: 'p',
      metadata: { videoUrl: 'https://exemple.test/montage-final.mp4' },
    });
    expect(d.rushUrl).toBeUndefined();
  });

  it('aucun placement n\'est inventé', () => {
    expect(vide.titlePos).toBeUndefined();
    expect(vide.ctaPos).toBeUndefined();
    expect(vide.elements).toBeUndefined();
  });

  it('aucune couleur n\'est inventée', () => {
    expect(vide.colors).toBeUndefined();
  });

  it('un post sans metadata du tout ne fait pas exploser la traduction', () => {
    for (const abime of [undefined, null, 'texte', 42, []]) {
      const d = toWizardDraft({ id: 'p', metadata: abime });
      expect(d.version).toBe(DRAFT_VERSION);
      expect(d.started).toBe(true);
    }
  });
});

describe('le module ne fait que traduire', () => {
  it('ne modifie pas le post reçu', () => {
    const post = JSON.parse(JSON.stringify(POST_COMPLET));
    const copie = JSON.parse(JSON.stringify(post));
    toWizardDraft(post);
    expect(post).toEqual(copie);
  });

  it('les cartes rendues ne partagent aucune référence avec la metadata', () => {
    const post = JSON.parse(JSON.stringify(POST_COMPLET));
    const d = toWizardDraft(post);
    const cards = (d.generated as { cards: Array<Record<string, unknown>> }).cards;
    cards[0].title = 'MODIFIÉ PAR LE WIZARD';
    expect(post.metadata.cards[0].label).toBe('Carte A');
  });
});
