// @vitest-environment node
/**
 * M3-D1 — LA MESURE AUDIO LOCALE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un seul défaut compte vraiment ici, et c'est le MENSONGE : écrire
 * `present: false` sur un rush qui porte une piste sonore mais dont la mesure
 * a échoué. Il ne se verrait nulle part — l'analyse resterait `reussie`, la
 * colonne serait remplie — et il ferait sauter la transcription de M3-D2 sans
 * que personne ne sache pourquoi. Les tests les plus importants de ce fichier
 * sont donc ceux qui séparent « pas de piste » de « mesure impossible ».
 *
 * Vient ensuite ce qui entre en base : `rush_analyses.audio` est rendue au
 * navigateur, elle ne doit contenir que des nombres finis et un vocabulaire
 * fermé — jamais une URL, une clé de stockage ou un fragment de `stderr`.
 *
 * ⚠️ AUCUNE IA, AUCUN RÉSEAU, AUCUN FFMPEG RÉEL. Le lancement de processus
 * est doublé ; les échantillons de `stderr` sont des sorties RÉELLES de
 * ffmpeg, relevées sur des fichiers de test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Le stockage et le lancement de processus, doublés
// ───────────────────────────────────────────────────────────────────────────
const URL_SIGNEE = 'http://studiio-minio:9000/media/u-m3d1/rush/a.mp4?X-Amz-Signature=deadbeef';

let signeurCasse = false;

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  signeurInterne: () => (signeurCasse ? null : {
    presignedGetObject: async () => URL_SIGNEE,
  }),
}));

const lancerDouble = vi.fn();

vi.mock('@/lib/autopilot/analyse/extraction', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  lancer: (...args: unknown[]) => lancerDouble(...args),
}));

import {
  mesurerAudio, argumentsMesure, lireSilences, lireNiveaux,
  TIMEOUT_AUDIO_MS, BUDGET_AUDIO_MS,
} from '@/lib/autopilot/analyse/audio';
import {
  audioPourBase, audioAbsent, audioIndisponible, normaliserSilences,
  SILENCES_MAX, SEUIL_SILENCE_DB, SILENCE_MIN_SECONDES, MOTIFS_AUDIO,
  ETATS_MESURE_AUDIO, OUTIL_AUDIO,
} from '@/lib/autopilot/analyse/audio-contrat';
import {
  reinitialiserCapacite, prendrePlaceAudio, passesAudioEnCours,
  MAX_AUDIO_SIMULTANEES, RETRY_APRES_SECONDES,
} from '@/lib/autopilot/analyse/capacite';
import { BUDGET_EXTRACTION_MS } from '@/lib/autopilot/analyse/extraction';
import { TIMEOUT_VISUEL_MS } from '@/lib/autopilot/analyse/visuel';
import { ETAPES_ANALYSE } from '@/lib/autopilot/analyse/contrat';

const SOURCE_ROUTE = resolve(
  process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts',
);
const SOURCE_ROUTE_M3C = resolve(
  process.cwd(), 'src/app/api/autopilot/analyses/[id]/candidats/route.ts',
);
const SOURCE_AUDIO = resolve(process.cwd(), 'src/lib/autopilot/analyse/audio.ts');
const SOURCE_CONTRAT = resolve(process.cwd(), 'src/lib/autopilot/analyse/audio-contrat.ts');

const ENTREE = {
  bucket: 'media',
  cleObjet: 'u-m3d1/rush/a.mp4',
  userId: 'u-m3d1',
  dureeSecondes: 38.165,
  pisteAttendue: true as boolean | null,
};

/** Une sortie de processus réussie, `stderr` donné. */
function sortieOk(stderr: string) {
  return {
    code: 0, codeSysteme: null, signal: null,
    stdout: Buffer.alloc(0), stderr, timeout: false, introuvable: false,
  };
}

/**
 * Un `stderr` de ffmpeg tel qu'il l'écrit vraiment.
 *
 * Relevé sur `ffmpeg -af silencedetect=noise=-35dB:d=0.4,volumedetect -f null -`,
 * y compris la ligne `n_samples: 0` que `volumedetect` écrit à la
 * CONFIGURATION du filtre, avant tout flux — c'est précisément celle qu'un
 * lecteur naïf confondrait avec le bilan.
 */
function stderrFfmpeg(silences: Array<[number, number | null]>, moyenne = -22.0, crete = -18.1) {
  const lignes = ['[Parsed_volumedetect_1 @ 0x1] n_samples: 0'];
  for (const [debut, fin] of silences) {
    lignes.push(`[Parsed_silencedetect_0 @ 0x2] silence_start: ${debut}`);
    if (fin !== null) {
      lignes.push(
        `[Parsed_silencedetect_0 @ 0x2] silence_end: ${fin} | silence_duration: ${fin - debut}`,
      );
    }
  }
  lignes.push('[Parsed_volumedetect_1 @ 0x3] n_samples: 220500');
  lignes.push(`[Parsed_volumedetect_1 @ 0x3] mean_volume: ${moyenne} dB`);
  lignes.push(`[Parsed_volumedetect_1 @ 0x3] max_volume: ${crete} dB`);
  return lignes.join('\n');
}

beforeEach(() => {
  reinitialiserCapacite();
  lancerDouble.mockReset();
  signeurCasse = false;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-2. Piste présente, piste absente — deux issues, jamais confondues', () => {
  it('une piste présente et lisible donne une mesure', async () => {
    lancerDouble.mockResolvedValue(sortieOk(stderrFfmpeg([[10, 12]])));

    const m = await mesurerAudio(ENTREE);

    expect(m.present).toBe(true);
    expect(m.etatMesure).toBe('mesuree');
    expect(m.motif).toBeNull();
    expect(m.silences).toEqual([{ debutSecondes: 10, finSecondes: 12 }]);
    expect(m.niveau).toEqual({ moyenneDb: -22, creteDb: -18.1 });
    expect(m.mesure).toEqual({
      outil: OUTIL_AUDIO, seuilDb: SEUIL_SILENCE_DB, silenceMinSecondes: SILENCE_MIN_SECONDES,
    });
  });

  it('aucune piste : `present: false`, et AUCUN travail engagé', async () => {
    const m = await mesurerAudio({ ...ENTREE, pisteAttendue: false });

    expect(m.present).toBe(false);
    expect(m.etatMesure).toBe('absente');
    expect(m.motif).toBeNull();
    // Ni processus, ni place prise : un rush muet ne doit rien coûter.
    expect(lancerDouble).not.toHaveBeenCalled();
    expect(passesAudioEnCours()).toBe(0);
  });

  it('les trois états et les six motifs sont un vocabulaire FERMÉ', () => {
    expect(ETATS_MESURE_AUDIO).toEqual(['mesuree', 'absente', 'indisponible']);
    expect(MOTIFS_AUDIO).toEqual([
      'cle_hors_perimetre', 'stockage_injoignable', 'outil_absent',
      'audio_illisible', 'timeout', 'capacite_saturee',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('3-8. Ce qui entre en base est borné, trié, fini', () => {
  it('3. les silences sont triés et les chevauchements fusionnés', () => {
    const s = normaliserSilences([
      { debutSecondes: 20, finSecondes: 22 },
      { debutSecondes: 5, finSecondes: 9 },
      { debutSecondes: 7, finSecondes: 11 },
    ], 30);
    // Deux détections qui se recouvrent décrivent UN silence : les garder
    // toutes deux compterait deux fois le même.
    expect(s).toEqual([
      { debutSecondes: 5, finSecondes: 11 },
      { debutSecondes: 20, finSecondes: 22 },
    ]);
  });

  it('3bis. les instants sont arrondis à trois décimales, comme la durée', () => {
    const s = normaliserSilences([{ debutSecondes: 1.9999551, finSecondes: 3.0000681 }], 38.165);
    expect(s).toEqual([{ debutSecondes: 2, finSecondes: 3 }]);
  });

  it('4. un silence qui commence à 0 est conservé tel quel', async () => {
    lancerDouble.mockResolvedValue(sortieOk(stderrFfmpeg([[0, 3]])));
    const m = await mesurerAudio({ ...ENTREE, dureeSecondes: 3 });
    expect(m.silences).toEqual([{ debutSecondes: 0, finSecondes: 3 }]);
  });

  it('5. un `silence_start` sans fin est CLOS sur la durée, pas jeté', async () => {
    // ffmpeg ferme lui-même un silence courant jusqu'à l'EOF — mais c'est une
    // propriété du binaire, pas une décision de notre code. Le silence final
    // est justement celui où une coupe est la plus facile : le perdre serait
    // perdre le plus utile.
    lancerDouble.mockResolvedValue(sortieOk(stderrFfmpeg([[30, null]])));
    const m = await mesurerAudio(ENTREE);
    expect(m.silences).toEqual([{ debutSecondes: 30, finSecondes: 38.165 }]);
  });

  it('6. la liste est plafonnée à cent, après tri', () => {
    const brut = Array.from({ length: 400 }, (_, i) => ({
      debutSecondes: 400 - i, finSecondes: 400 - i + 0.5,
    }));
    const s = normaliserSilences(brut, 1000);
    expect(s).toHaveLength(SILENCES_MAX);
    // Plafonner AVANT de trier rendrait « les cent premiers » vide de sens.
    expect(s[0].debutSecondes).toBe(1);
    expect(s[SILENCES_MAX - 1].debutSecondes).toBe(100);
  });

  it('6bis. cinq cents silences dans `stderr` ne débordent pas le contrat', async () => {
    const paires: Array<[number, number]> = Array.from(
      { length: 500 }, (_, i) => [i * 0.1, i * 0.1 + 0.05],
    );
    lancerDouble.mockResolvedValue(sortieOk(stderrFfmpeg(paires)));
    const m = await mesurerAudio({ ...ENTREE, dureeSecondes: 60 });
    expect(m.silences.length).toBeLessThanOrEqual(SILENCES_MAX);
  });

  it('7. un silence vide ou inversé est refusé, et les bornes sont respectées', () => {
    const s = normaliserSilences([
      { debutSecondes: 5, finSecondes: 5 },      // vide
      { debutSecondes: 9, finSecondes: 4 },      // inversé
      { debutSecondes: -3, finSecondes: 2 },     // début avant le rush
      { debutSecondes: 36, finSecondes: 99 },    // fin après le rush
    ], 38.165);
    expect(s).toEqual([
      { debutSecondes: 0, finSecondes: 2 },
      { debutSecondes: 36, finSecondes: 38.165 },
    ]);
    for (const x of s) {
      expect(x.debutSecondes).toBeGreaterThanOrEqual(0);
      expect(x.debutSecondes).toBeLessThan(x.finSecondes);
      expect(x.finSecondes).toBeLessThanOrEqual(38.165);
    }
  });

  it('8. `NaN` et `±Infinity` ne franchissent jamais le contrat', () => {
    expect(normaliserSilences([
      { debutSecondes: Number.NaN, finSecondes: 3 },
      { debutSecondes: 1, finSecondes: Number.POSITIVE_INFINITY },
      { debutSecondes: Number.NEGATIVE_INFINITY, finSecondes: 2 },
      { debutSecondes: '2', finSecondes: '4' },
    ], 10)).toEqual([{ debutSecondes: 2, finSecondes: 4 }]);

    const brut = audioPourBase({
      ...audioAbsent(Number.NaN),
      niveau: { moyenneDb: Number.NEGATIVE_INFINITY, creteDb: Number.NaN },
    });
    expect(brut.dureeSecondes).toBeNull();
    expect(brut.niveau).toEqual({ moyenneDb: null, creteDb: null });
    expect(JSON.parse(JSON.stringify(brut))).toEqual(brut);
  });

  it('8bis. `-inf dBFS` d’une piste muette devient `null`, pas `-Infinity`', () => {
    // Sortie réelle de ffmpeg sur un fichier totalement silencieux.
    const n = lireNiveaux('[Parsed_volumedetect_1 @ 0x3] max_volume: -inf dB');
    expect(n).toEqual({ moyenneDb: null, creteDb: null });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('9. Une panne de mesure NE DIT JAMAIS « pas de son »', () => {
  const pannes: Array<[string, Record<string, unknown>, string]> = [
    ['ffmpeg absent', { introuvable: true, code: null }, 'outil_absent'],
    ['ffmpeg tué au délai', { timeout: true, code: null }, 'timeout'],
    ['fichier illisible', { code: 1 }, 'audio_illisible'],
  ];

  for (const [nom, patch, motif] of pannes) {
    it(`${nom} → \`indisponible\` / ${motif}, et \`present\` RESTE \`true\``, async () => {
      lancerDouble.mockResolvedValue({ ...sortieOk(''), ...patch });
      const m = await mesurerAudio(ENTREE);
      expect(m.etatMesure).toBe('indisponible');
      expect(m.motif).toBe(motif);
      // LE test du lot : `false` ferait passer un rush parlé pour muet.
      expect(m.present).not.toBe(false);
      expect(m.present).toBe(true);
      expect(m.silences).toEqual([]);
    });
  }

  it('piste INCONNUE et mesure impossible → `present: null`, jamais `false`', async () => {
    lancerDouble.mockResolvedValue({ ...sortieOk(''), code: 1 });
    const m = await mesurerAudio({ ...ENTREE, pisteAttendue: null });
    expect(m.present).toBeNull();
    expect(m.etatMesure).toBe('indisponible');
  });

  it('un stockage non configuré ne fait pas mentir la mesure', async () => {
    signeurCasse = true;
    const m = await mesurerAudio(ENTREE);
    expect(m.motif).toBe('stockage_injoignable');
    expect(m.present).toBe(true);
    expect(lancerDouble).not.toHaveBeenCalled();
  });

  it('une clé hors du préfixe utilisateur est refusée AVANT tout accès', async () => {
    for (const cle of ['autre/rush/a.mp4', 'u-m3d1/../autre/a.mp4', 'https://ailleurs/a.mp4']) {
      const m = await mesurerAudio({ ...ENTREE, cleObjet: cle });
      expect(m.motif).toBe('cle_hors_perimetre');
      expect(m.present).toBe(true);
    }
    const b = await mesurerAudio({ ...ENTREE, bucket: 'inconnu' });
    expect(b.motif).toBe('cle_hors_perimetre');
    expect(lancerDouble).not.toHaveBeenCalled();
  });

  it('un motif ne survit pas à un état qui n’est pas `indisponible`', () => {
    // Un motif traîné sur une mesure réussie ferait lire un échec là où il n'y
    // en a pas.
    const brut = audioPourBase({ ...audioAbsent(10), motif: 'timeout' as never });
    expect(brut.motif).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('10. Rien de signé, rien de stocké, rien de brut n’entre en base', () => {
  it('l’objet écrit ne contient ni URL, ni clé, ni compartiment, ni `stderr`', async () => {
    // Un `stderr` qui contient TOUT ce qui ne doit pas fuir.
    lancerDouble.mockResolvedValue(sortieOk(
      `${stderrFfmpeg([[1, 2]])}\n`
      + `Input #0, mov, from '${URL_SIGNEE}':\n`
      + '  media/u-m3d1/rush/a.mp4  X-Amz-Credential=studiio\n',
    ));

    const brut = audioPourBase(await mesurerAudio(ENTREE));
    const texte = JSON.stringify(brut);

    expect(texte).not.toMatch(/:\/\//);
    expect(texte).not.toContain('X-Amz');
    expect(texte).not.toContain('studiio-minio');
    expect(texte).not.toContain('media');
    expect(texte).not.toContain('u-m3d1');
    expect(texte).not.toContain('silence_start');
    expect(texte).not.toContain('ffmpeg -');
  });

  it('les clés de l’objet sont exactement celles du contrat, et rien de plus', () => {
    const brut = audioPourBase(audioIndisponible('timeout', 12.5, true));
    expect(Object.keys(brut).sort()).toEqual(
      ['dureeSecondes', 'etatMesure', 'mesure', 'motif', 'niveau', 'present', 'silences'],
    );
    expect(Object.keys(brut.niveau as object).sort()).toEqual(['creteDb', 'moyenneDb']);
    expect(Object.keys(brut.mesure as object).sort())
      .toEqual(['outil', 'seuilDb', 'silenceMinSecondes']);
  });

  it('la passe ne produit AUCUN fichier et n’ouvre que http/https', () => {
    const args = argumentsMesure(URL_SIGNEE);
    // `-f null -` : la sortie décodée part au trou noir. Aucun WAV, aucun
    // objet MinIO, donc rien à supprimer dans un `finally`.
    expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
    // La porte SSRF qu'ouvrirait un fichier reconnu comme playlist HLS.
    expect(args).toContain('-protocol_whitelist');
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('http,https,tcp,tls');
    // Aucune image décodée, et la piste explicitement désignée.
    expect(args).toContain('-vn');
    expect(args).toContain('0:a:0');
    expect(args.join(' ')).toContain(
      `silencedetect=noise=${SEUIL_SILENCE_DB}dB:d=${SILENCE_MIN_SECONDES},volumedetect`,
    );
    // Aucun ré-encodage : la mesure travaille sur le flux décodé tel quel.
    expect(args).not.toContain('-ar');
    expect(args).not.toContain('-ac');

    const source = readFileSync(SOURCE_AUDIO, 'utf8');
    expect(source).not.toMatch(/writeFile|createWriteStream|mkdtemp|tmpdir|putObject/);
  });

  it('la fin de `stderr` n’est PAS ce qu’on garde : les premiers silences comptent', async () => {
    // `lancer` tronque par défaut aux 8000 derniers caractères. Ici `stderr`
    // EST la mesure : garder la fin perdrait les silences du DÉBUT du rush,
    // sans que rien ne le signale.
    lancerDouble.mockResolvedValue(sortieOk(stderrFfmpeg([[1, 2]])));
    await mesurerAudio(ENTREE);
    const opts = lancerDouble.mock.calls[0][2] as { stderrMax?: number; timeoutMs: number };
    expect(opts.stderrMax).toBeGreaterThan(8000);
    expect(opts.timeoutMs).toBe(TIMEOUT_AUDIO_MS);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('11-13. Le pipeline : l’audio s’écrit AVANT la clôture, et n’efface rien', () => {
  const route = readFileSync(SOURCE_ROUTE, 'utf8');

  it('12. AUCUNE écriture de `reussie` n’est atteinte sans mesure audio', () => {
    const clotures = [...route.matchAll(/etat: 'reussie'/g)].map((m) => m.index ?? -1);
    // Deux, et deux seulement : avec fournisseur visuel, et sans.
    expect(clotures).toHaveLength(2);

    for (const fin of clotures) {
      const avant = route.slice(0, fin);
      const mesure = avant.lastIndexOf('mesureAudioPourCloture(');
      // La mesure existe avant cette clôture…
      expect(mesure).toBeGreaterThan(-1);
      // …et aucune AUTRE clôture ne s'est glissée entre les deux, ce qui
      // voudrait dire que celle-ci réutilise la mesure d'un autre chemin.
      expect(avant.slice(mesure).includes("etat: 'reussie'")).toBe(false);
    }
  });

  it('12bis. les deux clôtures portent bien `audio`', () => {
    expect(route).toContain("{ etat: 'reussie', audio }");
    expect(route).toMatch(/etat: 'reussie',\s*\n\s*audio,/);
  });

  it('11+13. la clôture visuelle conserve tout ce que M3-B4 avait produit', () => {
    const bloc = route.slice(route.indexOf('const clot = await majAnalyse'));
    for (const champ of [
      'resume:', 'textesVisibles:', 'qualite:', 'usage:',
      'extraction: FOURNISSEUR_EXTRACTION', 'modele: visuel.modele',
    ]) {
      expect(bloc).toContain(champ);
    }
    // `majAnalyse` REMPLACE la carte des fournisseurs : écrire `{ visuel }`
    // seul effacerait la trace de ffmpeg.
    expect(bloc).toContain('fournisseurs: {');
  });

  it('la mesure ne peut pas faire échouer une analyse', () => {
    const bloc = route.slice(
      route.indexOf('async function mesureAudioPourCloture'),
      route.indexOf('async function executerAnalyse'),
    );
    // Aucune sortie d'échec dans le helper : ni réponse HTTP, ni `echouee`.
    expect(bloc).not.toContain('NextResponse');
    expect(bloc).not.toContain('echouee');
    expect(bloc).toContain('catch');
  });

  it('`etape` n’est pas touchée : le vocabulaire de la base reste celui de M3-B1', () => {
    // Ajouter « audio » à `etape` ou à `fournisseurs` demanderait une
    // migration, que ce lot n'a pas.
    expect(ETAPES_ANALYSE).toEqual(['extraction', 'visuel', 'transcription']);
    expect(route).not.toMatch(/etape: 'audio'/);
    expect(route).not.toMatch(/fournisseurs: \{[^}]*audio:/s);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('14. M3-C n’est pas touché', () => {
  it('la route des candidats exige toujours une analyse `reussie`', () => {
    const m3c = readFileSync(SOURCE_ROUTE_M3C, 'utf8');
    expect(m3c).toContain("analyse.etat !== 'reussie'");
    expect(m3c).toContain('analyse_non_reussie');
    // M3-D1 n'a aucune raison d'apparaître dans le chemin des candidats.
    expect(m3c).not.toContain('audio');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('15-16. Rien d’externe, rien de facturé, rien à migrer', () => {
  const sources = [readFileSync(SOURCE_AUDIO, 'utf8'), readFileSync(SOURCE_CONTRAT, 'utf8')];

  it('15. aucun fournisseur d’IA, aucun appel réseau sortant', () => {
    for (const s of sources) {
      expect(s).not.toMatch(/anthropic|openai|groq|replicate|deepgram|whisper/i);
      expect(s).not.toMatch(/\bfetch\s*\(/);
      expect(s).not.toMatch(/process\.env/);
    }
  });

  it('15bis. aucun débit de crédits sur ce chemin', () => {
    for (const s of [...sources, readFileSync(SOURCE_ROUTE, 'utf8')]) {
      expect(s).not.toContain('@/lib/credits');
      expect(s).not.toContain('debiter_credits');
    }
  });

  it('16. la mesure n’écrit que dans une colonne qui existe déjà', () => {
    // `rush_analyses.audio` est créée par la migration de M3-B1, avec un
    // défaut `{}`. M3-D1 n'ajoute ni table, ni colonne, ni valeur d'énumération.
    const migration = readFileSync(
      resolve(process.cwd(), 'migrations/2026-09-01-rush-analyses.sql'), 'utf8',
    );
    expect(migration).toContain('audio      jsonb not null default');
    expect(migration).toContain("etape in ('extraction', 'visuel', 'transcription')");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('La capacité, et le budget qu’elle annonce', () => {
  it('une seule passe audio à la fois, et un refus n’est PAS un échec', async () => {
    expect(MAX_AUDIO_SIMULTANEES).toBe(1);
    const prise = prendrePlaceAudio();
    expect(prise).not.toBeNull();
    expect(prendrePlaceAudio()).toBeNull();

    const m = await mesurerAudio(ENTREE);
    expect(m.etatMesure).toBe('indisponible');
    expect(m.motif).toBe('capacite_saturee');
    expect(m.present).toBe(true);
    expect(lancerDouble).not.toHaveBeenCalled();

    prise!.liberer();
    expect(passesAudioEnCours()).toBe(0);
  });

  it('la place est rendue même quand la mesure échoue', async () => {
    lancerDouble.mockResolvedValue({ ...sortieOk(''), code: 1 });
    await mesurerAudio(ENTREE);
    expect(passesAudioEnCours()).toBe(0);
  });

  it('la place audio est SÉPARÉE de la place d’extraction', () => {
    // Un compteur commun ferait refuser la mesure audio d'une analyse par la
    // place que cette même analyse détient déjà.
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/capacite.ts'), 'utf8',
    );
    expect(source).toContain('let audioEnCours = 0;');
  });

  it('la somme des trois budgets tient sous le `Retry-After` annoncé', () => {
    // Si le pire cas dépassait l'en-tête, le client reviendrait pile pour se
    // faire refuser de nouveau, et compterait ce refus comme une panne.
    expect(BUDGET_EXTRACTION_MS + TIMEOUT_VISUEL_MS + BUDGET_AUDIO_MS)
      .toBeLessThanOrEqual(RETRY_APRES_SECONDES * 1000);
    expect(readFileSync(SOURCE_ROUTE, 'utf8'))
      .toContain(`export const maxDuration = ${RETRY_APRES_SECONDES}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('La lecture de `stderr`, sur des sorties réelles de ffmpeg', () => {
  it('les débuts et les fins sont appariés par leur ORDRE, pas par ligne', () => {
    // ffmpeg écrit `silence_start:` puis, plus loin, `silence_end:` — deux
    // lignes séparées. Une regex qui exigerait les deux ensemble ne trouverait
    // jamais rien.
    const s = lireSilences(stderrFfmpeg([[1, 2], [5, 6.5]]), 10);
    expect(s).toEqual([
      { debutSecondes: 1, finSecondes: 2 },
      { debutSecondes: 5, finSecondes: 6.5 },
    ]);
  });

  it('`n_samples: 0` de la configuration du filtre n’est pas lu comme un bilan', () => {
    const n = lireNiveaux(stderrFfmpeg([], -30.5, -6.2));
    expect(n).toEqual({ moyenneDb: -30.5, creteDb: -6.2 });
  });

  it('un `stderr` vide ne rend ni silence, ni niveau — et ne lève pas', () => {
    expect(lireSilences('', 10)).toEqual([]);
    expect(lireNiveaux('')).toEqual({ moyenneDb: null, creteDb: null });
  });
});
