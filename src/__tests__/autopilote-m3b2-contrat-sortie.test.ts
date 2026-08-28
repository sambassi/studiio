/**
 * M3-B2 — Le contrat de sortie de l'extraction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VÉRIFIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur d'extraction rend, en cas de succès, trois choses et trois
 * seulement : une DURÉE mesurée, un objet TECHNIQUE (dimensions, codec, fps,
 * piste audio) et des VIGNETTES. En cas d'échec, un motif pris dans un
 * vocabulaire fermé.
 *
 * La forme de ces trois champs n'est pas libre : elle doit passer les
 * validateurs que M3-B1 a déjà écrits, parce que c'est par eux que la valeur
 * atteindra la colonne. Une sortie que `vignettesValides` refuse est une
 * sortie qui ne sera JAMAIS écrite — et un moteur qui la produit travaille
 * pour rien, sans que rien ne le signale avant la production.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI RÉUTILISER `vignettesValides` PLUTÔT QUE REVALIDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Réécrire ici « pas de `://`, pas de `..`, compartiment dans la liste
 * blanche » produirait une SECONDE définition du même contrat. Elles ne
 * divergeraient pas tout de suite ; elles divergeraient le jour où l'une
 * accueille une règle et pas l'autre — exactement la faute que le contrat
 * M3-B1 décrit lui-même à propos des listes de compartiments. Le validateur
 * du contrat est donc appelé, pas recopié.
 *
 * Ce fichier ajoute UNIQUEMENT ce que le contrat M3-B1 ne pouvait pas savoir,
 * parce que ce sont des propriétés de l'EXTRACTION et non du stockage : une
 * durée strictement positive, un plafond de huit vignettes, des secondes
 * comprises dans la durée, et l'absence de tout chemin serveur dans
 * `technique`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE FICHIER TOURNE AVANT QUE LE MOTEUR EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `sortieExtractionValide` est écrite ici et éprouvée ici, sur des exemples
 * construits à la main — un valide, et un par règle enfreinte. Elle est donc
 * démontrée AVANT d'être braquée sur le moteur réel : un juge qu'on n'a
 * jamais vu condamner ne prouve rien quand il acquitte.
 *
 * Le dernier bloc, lui, ne peut tourner qu'après intégration : il importe le
 * moteur pour vérifier son vocabulaire d'échec. Il est mis de côté par
 * `skipIf` tant que le module manque — et le fichier « gros fichiers » porte
 * la garde qui échoue bruyamment dans ce cas, pour qu'un module renommé ne
 * puisse pas rendre ces tests silencieux à perpétuité.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { ALLOWED_BUCKETS } from '@/lib/storage/buckets';
import {
  vignettesValides, objetJsonValide,
  CHAMPS_INTERDITS_ANALYSE, MOTIF_ECHEC_MAX,
  type VignetteAnalyse,
} from '@/lib/autopilot/analyse/contrat';

// ───────────────────────────────────────────────────────────────────────────
// Le contrat, écrit une fois
// ───────────────────────────────────────────────────────────────────────────

/**
 * Huit vignettes, pas neuf.
 *
 * Le plafond n'est pas esthétique : les vignettes seront lues par un modèle à
 * l'étape `visuel` (M3-B4), et chaque image y coûte des jetons. Un rush d'une
 * heure ne doit pas coûter huit fois un rush de sept minutes. Le plafond
 * appartient donc à l'extraction, qui est la seule à décider combien elle en
 * produit.
 */
export const VIGNETTES_MAX = 8;

/**
 * Plafond de durée, en secondes : 24 heures.
 *
 * Une durée au-delà n'est pas un long rush, c'est un en-tête mal lu. ffmpeg
 * rend volontiers des durées aberrantes sur un fichier tronqué — et une
 * aberration écrite en base devient un fait que les lots suivants croiront.
 */
export const DUREE_MAX = 24 * 60 * 60;

export interface SortieExtraction {
  dureeSecondes: number;
  technique: Record<string, unknown>;
  vignettes: VignetteAnalyse[];
}

/** Les quatre échecs typés, et les seuls. */
export const MOTIFS_EXTRACTION = [
  'format_illisible', 'extraction_impossible', 'timeout', 'objet_introuvable',
] as const;

export interface Verdict { ok: boolean; champ?: string }

/**
 * Une sortie d'extraction acceptable.
 *
 * Rend le NOM du champ fautif, jamais un simple `false` : c'est ce qui
 * distingue un refus utile d'un « invalide » que l'appelant devra deviner.
 * Même principe que `ResultatAnalyse.champ` du service M3-B1.
 */
export function sortieExtractionValide(sortie: unknown): Verdict {
  if (typeof sortie !== 'object' || sortie === null || Array.isArray(sortie)) {
    return { ok: false, champ: 'sortie' };
  }
  const s = sortie as Record<string, unknown>;

  // — La durée. `null` est un aveu d'échec, pas un succès ; `0` se lirait
  //   comme « vide » ; une valeur négative ou aberrante vient d'un en-tête
  //   illisible, cas que le moteur doit rendre en `format_illisible`.
  const duree = s.dureeSecondes;
  if (typeof duree !== 'number' || !Number.isFinite(duree)) {
    return { ok: false, champ: 'dureeSecondes' };
  }
  if (duree <= 0 || duree > DUREE_MAX) return { ok: false, champ: 'dureeSecondes' };

  // — L'objet technique. Le contrat M3-B1 décide de sa forme JSON.
  const technique = objetJsonValide(s.technique);
  if (!technique.ok) return { ok: false, champ: 'technique' };

  // Rien de ce que ffmpeg a vu du système de fichiers ne sort d'ici. Un
  // `/tmp/rush-8f3a/…` écrit en base raconte la disposition du serveur à
  // quiconque lira l'analyse, et survit au dossier qu'il désigne.
  const techniqueBrute = JSON.stringify(technique.valeur);
  if (techniqueBrute.includes('://')) return { ok: false, champ: 'technique' };
  if (/(^|["/])(\/tmp|\/var|\/home|\/Users|[A-Za-z]:\\\\)/.test(techniqueBrute)) {
    return { ok: false, champ: 'technique' };
  }

  // — Les vignettes. Le contrat M3-B1 porte la liste blanche de
  //   compartiments, le refus des URL et le refus de `..`. On l'APPELLE.
  if (!Array.isArray(s.vignettes)) return { ok: false, champ: 'vignettes' };
  if (s.vignettes.length > VIGNETTES_MAX) return { ok: false, champ: 'vignettes' };
  const vignettes = vignettesValides(s.vignettes);
  if (!vignettes.ok) return { ok: false, champ: 'vignettes' };

  // Ce que le contrat ne pouvait pas savoir : une vignette est une POSITION
  // dans CE rush. Au-delà de la durée mesurée, elle ne désigne rien.
  let precedente = -1;
  for (const v of vignettes.valeur) {
    if (v.seconde > duree) return { ok: false, champ: 'vignettes' };
    // Croissantes et distinctes : deux vignettes à la même seconde sont la
    // même image comptée deux fois, et coûteront deux fois à l'étape visuelle.
    if (v.seconde <= precedente) return { ok: false, champ: 'vignettes' };
    precedente = v.seconde;
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────

const VIGNETTE = (seconde: number): VignetteAnalyse => ({
  bucket: 'media', cle: `u-1/rush/r-1/vignette-${seconde}.jpg`, seconde,
});

const SORTIE_VALIDE: SortieExtraction = {
  dureeSecondes: 42.5,
  technique: {
    largeur: 1080, hauteur: 1920, fps: 30,
    codecVideo: 'h264', codecAudio: 'aac', pisteAudio: true,
    debitBits: 4_200_000,
  },
  vignettes: [0, 6, 12, 18, 24, 30, 36, 42].map(VIGNETTE),
};

// ───────────────────────────────────────────────────────────────────────────
describe('Une sortie d extraction conforme est acceptée', () => {
  it('durée mesurée, technique, huit vignettes — le plafond exact passe', () => {
    expect(sortieExtractionValide(SORTIE_VALIDE)).toEqual({ ok: true });
    expect(SORTIE_VALIDE.vignettes).toHaveLength(VIGNETTES_MAX);
  });

  it('une extraction sans vignette reste valide — un rush d une seconde n en mérite pas huit', () => {
    expect(sortieExtractionValide({ ...SORTIE_VALIDE, vignettes: [] })).toEqual({ ok: true });
  });

  it('une technique vide est valide — mesurer la durée sans lire le codec reste une extraction', () => {
    expect(sortieExtractionValide({ ...SORTIE_VALIDE, technique: {} })).toEqual({ ok: true });
  });

  it('tous les compartiments de la liste blanche sont acceptés', () => {
    for (const bucket of ALLOWED_BUCKETS) {
      const sortie = {
        ...SORTIE_VALIDE,
        vignettes: [{ bucket, cle: 'u-1/rush/v.jpg', seconde: 1 }],
      };
      expect(sortieExtractionValide(sortie), bucket).toEqual({ ok: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('La durée est MESURÉE — jamais nulle, jamais aberrante', () => {
  const refuse = (duree: unknown) => expect(
    sortieExtractionValide({ ...SORTIE_VALIDE, dureeSecondes: duree }),
  ).toEqual({ ok: false, champ: 'dureeSecondes' });

  it('zéro est refusé : « 0 seconde » se lit comme « vide »', () => refuse(0));
  it('une durée négative est refusée', () => refuse(-1));
  it('`null` est refusé : c est un échec, pas un succès', () => refuse(null));
  it('une chaîne, même numérique, est refusée', () => refuse('42'));
  it('NaN et Infinity sont refusés', () => { refuse(NaN); refuse(Infinity); });
  it('au-delà de 24 h, c est un en-tête mal lu', () => refuse(DUREE_MAX + 1));
  it('exactement 24 h passe encore', () => {
    expect(sortieExtractionValide({ ...SORTIE_VALIDE, dureeSecondes: DUREE_MAX, vignettes: [] }))
      .toEqual({ ok: true });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Les vignettes sont des CLÉS d objet, et rien d autre', () => {
  const refuseVignettes = (vignettes: unknown) => expect(
    sortieExtractionValide({ ...SORTIE_VALIDE, vignettes }),
  ).toEqual({ ok: false, champ: 'vignettes' });

  it('une URL http n est pas une clé', () => refuseVignettes([
    { bucket: 'media', cle: 'https://minio.studiio.pro/media/u-1/v.jpg', seconde: 1 },
  ]));

  it('une URL s3 n est pas une clé non plus', () => refuseVignettes([
    { bucket: 'media', cle: 's3://media/u-1/v.jpg', seconde: 1 },
  ]));

  it('`..` est refusé — `A/../B/x` désigne l espace de B', () => refuseVignettes([
    { bucket: 'media', cle: 'u-1/../u-2/v.jpg', seconde: 1 },
  ]));

  it('un compartiment hors liste blanche est refusé', () => refuseVignettes([
    { bucket: 'rushes-prives', cle: 'u-1/v.jpg', seconde: 1 },
  ]));

  it('un compartiment vide est refusé', () => refuseVignettes([
    { bucket: '', cle: 'u-1/v.jpg', seconde: 1 },
  ]));

  it('une clé vide est refusée', () => refuseVignettes([
    { bucket: 'media', cle: '   ', seconde: 1 },
  ]));

  it('neuf vignettes dépassent le plafond', () => refuseVignettes(
    [0, 4, 8, 12, 16, 20, 24, 28, 32].map(VIGNETTE),
  ));

  it('une vignette au-delà de la durée mesurée ne désigne rien', () => refuseVignettes(
    [VIGNETTE(0), VIGNETTE(99)],
  ));

  it('deux vignettes à la même seconde sont la même image, comptée deux fois', () => refuseVignettes(
    [VIGNETTE(3), VIGNETTE(3)],
  ));

  it('des vignettes dans le désordre sont refusées', () => refuseVignettes(
    [VIGNETTE(12), VIGNETTE(3)],
  ));

  it('une seconde négative est refusée', () => refuseVignettes([
    { bucket: 'media', cle: 'u-1/v.jpg', seconde: -1 },
  ]));

  it('un objet n est pas une liste de vignettes', () => refuseVignettes({ 0: VIGNETTE(1) }));

  it('aucune URL ne survit nulle part dans la sortie', () => {
    const brut = JSON.stringify(SORTIE_VALIDE);
    expect(brut).not.toContain('://');
    expect(brut).not.toContain('..');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('`technique` porte des mesures, pas des chemins ni des URL', () => {
  const refuseTechnique = (technique: unknown) => expect(
    sortieExtractionValide({ ...SORTIE_VALIDE, technique }),
  ).toEqual({ ok: false, champ: 'technique' });

  it('un tableau n est pas un objet JSON acceptable', () => refuseTechnique([1, 2]));
  it('une chaîne non plus', () => refuseTechnique('1080x1920'));
  it('un chemin temporaire du serveur est refusé', () => refuseTechnique({
    source: '/tmp/rush-8f3a/plan.mp4',
  }));
  it('un chemin utilisateur du serveur est refusé', () => refuseTechnique({
    source: '/Users/ci/work/plan.mp4',
  }));
  it('une URL, même signée, est refusée', () => refuseTechnique({
    source: 'https://minio.studiio.pro/media/u-1/plan.mp4?X-Amz-Signature=abc',
  }));
  it('`null` vaut objet vide, comme partout ailleurs dans le contrat', () => {
    expect(sortieExtractionValide({ ...SORTIE_VALIDE, technique: null })).toEqual({ ok: true });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Une forme aberrante ne fait pas tomber la validation', () => {
  for (const [nom, valeur] of [
    ['null', null], ['undefined', undefined], ['un nombre', 7],
    ['une chaîne', 'ok'], ['un tableau', []],
  ] as Array<[string, unknown]>) {
    it(`${nom} est refusé proprement`, () => {
      expect(sortieExtractionValide(valeur)).toEqual({ ok: false, champ: 'sortie' });
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le vocabulaire d échec est fermé et tenable', () => {
  it('quatre motifs, et quatre seulement', () => {
    expect(MOTIFS_EXTRACTION).toEqual([
      'format_illisible', 'extraction_impossible', 'timeout', 'objet_introuvable',
    ]);
    expect(new Set(MOTIFS_EXTRACTION).size).toBe(MOTIFS_EXTRACTION.length);
  });

  it('chaque motif tient dans la colonne `motif_echec`', () => {
    // `MOTIF_ECHEC_MAX` vient du CHECK de la migration. Un motif plus long
    // serait refusé par la base au moment d'écrire l'échec — un échec qui
    // échoue à s'enregistrer est la pire des deux pannes.
    for (const motif of MOTIFS_EXTRACTION) {
      expect(motif.length, motif).toBeLessThanOrEqual(MOTIF_ECHEC_MAX);
      // Jeton stable, lisible par une machine : pas de phrase, pas d'accent,
      // pas de détail variable qui empêcherait de regrouper les échecs.
      expect(motif, motif).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Tout ce que l extraction produit est INTERDIT au navigateur', () => {
  /**
   * Le pont entre les deux lots.
   *
   * `CHAMPS_INTERDITS_ANALYSE` a été écrit par M3-B1 pour une route qui
   * n'existait pas encore. Maintenant que M3-B2 produit réellement ces
   * champs, la question devient vérifiable : chaque champ déduit par le
   * serveur figure-t-il bien dans la liste que la route refusera ?
   *
   * Un champ produit ici et absent de là-bas, c'est un champ qu'un navigateur
   * pourrait proposer lui-même — et l'analyse ne serait plus un fait mesuré,
   * mais une déclaration du client.
   */
  it('durée, technique et vignettes sont dans la liste des champs refusés', () => {
    for (const champ of Object.keys(SORTIE_VALIDE)) {
      expect(CHAMPS_INTERDITS_ANALYSE as readonly string[], champ).toContain(champ);
    }
  });

  it('leurs orthographes `snake_case` y sont aussi — un client ne doit pas passer par l autre', () => {
    for (const champ of ['duree_secondes', 'technique', 'vignettes']) {
      expect(CHAMPS_INTERDITS_ANALYSE as readonly string[], champ).toContain(champ);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Après intégration seulement
// ───────────────────────────────────────────────────────────────────────────

const MODULE_EXTRACTION = 'src/lib/autopilot/analyse/extraction.ts';
const moteurPresent = existsSync(join(process.cwd(), MODULE_EXTRACTION));

/**
 * Le specificateur est CONSTRUIT, et l'import porte `@vite-ignore`.
 *
 * Écrit en clair, `import('@/lib/autopilot/analyse/extraction')` est résolu
 * par Vite à la TRANSFORMATION du fichier — c'est-à-dire bien avant que
 * `skipIf` ait son mot à dire. Tant que le module manque, le fichier entier
 * échoue alors à charger, et les trente-neuf tests ci-dessus ne tournent
 * pas : un bloc mis de côté qui emporte tout le reste avec lui. Constaté,
 * pas supposé — c'était la première rédaction.
 */
const specMoteur = ['..', 'lib', 'autopilot', 'analyse', 'extraction'].join('/');
const chargerMoteur = async (): Promise<Record<string, unknown>> => (
  import(/* @vite-ignore */ specMoteur) as Promise<Record<string, unknown>>
);

describe.skipIf(!moteurPresent)('Le moteur réel respecte ce contrat', () => {
  it('il expose le même vocabulaire d échec, sans en ajouter ni en retirer', async () => {
    const moteur = await chargerMoteur();
    // Le nom de la constante est une HYPOTHÈSE sur le module d'en face : si
    // elle s'appelle autrement, corriger ici plutôt que d'assouplir le test.
    const motifs = moteur.MOTIFS_EXTRACTION as readonly string[] | undefined;
    expect(
      motifs,
      `${MODULE_EXTRACTION} doit exporter MOTIFS_EXTRACTION — le vocabulaire `
      + 'd échec ne doit exister qu à un seul endroit',
    ).toBeDefined();
    expect([...(motifs ?? [])].sort()).toEqual([...MOTIFS_EXTRACTION].sort());
  });

  it('il n expose aucune fonction qui rendrait le rush entier', async () => {
    const moteur = await chargerMoteur();
    for (const interdit of ['telechargerRush', 'lireRushEntier', 'rushEnBuffer']) {
      expect(moteur[interdit], interdit).toBeUndefined();
    }
  });
});
