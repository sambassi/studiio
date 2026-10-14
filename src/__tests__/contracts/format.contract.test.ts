/**
 * CONTRAT — C-FORMAT (docs/product-contracts/video-generation.md).
 *
 * Un projet a UN format (9:16, 1:1 ou 16:9) : Créer, l'Autopilote, le montage
 * de rushes et le Calendrier l'écrivent et le relisent par
 * `src/lib/format/projet.ts`, jamais par une table ou un ratio recopié.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import {
  PROJECT_VIDEO_FORMATS, PROJECT_VIDEO_FORMAT_DEFAUT, dimensionsDuFormat, dimensionsDuPost,
  formatDuPost, formatRenduFacturation, metadataFormat, ratioCss, type ProjectVideoFormat,
} from '@/lib/format/projet';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';
import { creerBrouillonPlanification, type RenduEcran } from '@/lib/autopilot/analyse/rendu-passerelle';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { preparePosts, toPostRow } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { montageFrame, montageSize } from '@/app/dashboard/calendar/page';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';

const RACINE = resolve(__dirname, '../../..');
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf-8');
const ratioNum = (css: unknown) => {
  const [a, b] = String(css).split('/').map((v) => Number(v.trim()));
  return a / b;
};

/** Ce que `POST /api/posts` insère réellement (défaut de colonne « reel »). */
const commePosteParApi = (corps: Record<string, unknown>) => ({
  format: (corps.format as string | undefined) || 'reel',
  metadata: corps.metadata,
});

/** Cadre du lecteur plein écran du Calendrier, tel que la page le calcule. */
const cadreCalendrier = (post: { format?: string | null; metadata?: unknown }) => {
  const f = formatDuPost(post);
  return montageFrame(dimensionsDuPost(post), formatRenduFacturation(f));
};

describe('C-FORMAT — aller-retour écriture → lecture', () => {
  for (const f of PROJECT_VIDEO_FORMATS) {
    it(`${f} : metadataFormat → formatDuPost rend ${f}`, () => {
      const m = metadataFormat(f);
      const post = { format: m.format, metadata: m };
      expect(formatDuPost(post)).toBe(f);
      expect(m.videoFormat).toBe(f);
      expect(m.videoSize).toEqual({ w: VIDEO_SIZE[f].w, h: VIDEO_SIZE[f].h });
      expect(dimensionsDuPost(post)).toEqual(dimensionsDuFormat(f));
    });
    it(`${f} : le cadre du Calendrier porte le ratio du format`, () => {
      const m = metadataFormat(f);
      const cadre = cadreCalendrier({ format: m.format, metadata: m });
      const { w, h } = dimensionsDuFormat(f);
      expect(ratioNum(cadre.style.aspectRatio)).toBeCloseTo(w / h, 6);
      expect(ratioNum(ratioCss(f))).toBeCloseTo(w / h, 6);
    });
  }

  it('facturation inchangée : 9:16 → reel, carré et paysage → tv', () => {
    expect(formatRenduFacturation('9:16')).toBe('reel');
    expect(formatRenduFacturation('1:1')).toBe('tv');
    expect(formatRenduFacturation('16:9')).toBe('tv');
  });

  it('défaut d’un projet sans format : le vertical', () => {
    expect(PROJECT_VIDEO_FORMAT_DEFAUT).toBe('9:16');
    expect(formatDuPost({})).toBe('9:16');
    expect(formatDuPost(null)).toBe('9:16');
  });
});

describe('C-FORMAT — montage de rushes (passerelle) : le post porte le format RÉEL du montage', () => {
  const rendu = (largeur: number, hauteur: number): RenduEcran => ({
    id: 'rendu-1', etat: 'termine' as RenduEcran['etat'], etape: null, motif: null,
    video: { dureeSecondes: 30, largeur, hauteur, chemin: '/api/autopilot/rendus-montage/rendu-1/fichier' },
  });
  const poster = async (largeur: number, hauteur: number) => {
    let corps: Record<string, unknown> = {};
    const fetcher = (async (_u: string, init?: RequestInit) => {
      corps = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, post: { id: 'p1' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const issue = await creerBrouillonPlanification(rendu(largeur, hauteur), fetcher);
    expect(issue).toEqual({ sorte: 'creee', postId: 'p1' });
    return corps;
  };

  // Facturation INCHANGÉE (décision produit séparée) : pas de colonne envoyée
  // (`/api/posts` pose « reel » comme avant) et `metadata.format` garde
  // l'ancienne règle hauteur >= largeur.
  const cas: Array<[number, number, ProjectVideoFormat, 'reel' | 'tv']> = [
    [1920, 1080, '16:9', 'tv'],
    [1080, 1080, '1:1', 'reel'],
    [1080, 1920, '9:16', 'reel'],
  ];
  for (const [l, h, f, ancienMetaFormat] of cas) {
    it(`${l}x${h} → videoFormat ${f}, videoSize réel, colonne et metadata.format comme avant`, async () => {
      const corps = await poster(l, h);
      expect(corps.format).toBeUndefined();
      expect(commePosteParApi(corps).format).toBe('reel');
      const meta = corps.metadata as Record<string, unknown>;
      expect(meta.format).toBe(ancienMetaFormat);
      expect(meta.videoFormat).toBe(f);
      expect(meta.videoSize).toEqual({ w: l, h });
      const post = commePosteParApi(corps);
      expect(formatDuPost(post)).toBe(f);
      expect(ratioNum(cadreCalendrier(post).style.aspectRatio)).toBeCloseTo(l / h, 6);
    });
  }

  it('un montage 16:9 n’est JAMAIS joué dans un cadre 9:16 (bug Calendrier)', async () => {
    const post = commePosteParApi(await poster(1920, 1080));
    expect(ratioNum(cadreCalendrier(post).style.aspectRatio)).toBeGreaterThan(1);
    // L'appel historique du Calendrier (`montageFrame(videoSize, format)`)
    // recevait `undefined` + « reel » : cadre 9:16. Le post porte désormais
    // de quoi être bien cadré même par un lecteur ancien.
    const meta = post.metadata as { videoSize?: { w: number; h: number } };
    expect(ratioNum(montageFrame(meta.videoSize, post.format as 'reel' | 'tv').style.aspectRatio)).toBeGreaterThan(1);
  });

  it('carré : la facturation de régénération reste celle d’avant (« reel ») — aucun surcoût par effet de bord', async () => {
    const post = commePosteParApi(await poster(1080, 1080));
    expect(post.format).toBe('reel');
    expect(formatDuPost(post)).toBe('1:1');
  });

  it('dimensions atypiques (720x1280) : format le plus proche, dimensions exactes gardées', async () => {
    const corps = await poster(720, 1280);
    const meta = corps.metadata as Record<string, unknown>;
    expect(meta.videoFormat).toBe('9:16');
    expect(meta.videoSize).toEqual({ w: 720, h: 1280 });
  });
});

describe('C-FORMAT — Autopilote (cron) : post 9:16', () => {
  const cfg: AutopilotConfig = {
    ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: ['https://cdn.test/a.mp4'],
  };
  const p = preparePosts({ config: cfg, topic: 'yoga du matin', count: 1, now: Date.parse('2026-08-04T09:00:00.000Z') })[0];

  it('métadonnées et colonne disent 9:16', () => {
    const metadata = buildAutopilotMetadata({
      post: p, design: buildAutopilotDesign(p), videoUrl: 'https://cdn.test/rendu.mp4', mode: 'review',
    });
    const row = toPostRow({ userId: 'u1', post: p, config: cfg, videoUrl: 'https://cdn.test/rendu.mp4', metadata });
    expect(row.format).toBe('reel');
    expect((row.metadata as Record<string, unknown>).videoFormat).toBe('9:16');
    expect((row.metadata as Record<string, unknown>).videoSize).toEqual(dimensionsDuFormat('9:16'));
    expect(formatDuPost(row)).toBe('9:16');
  });
});

describe('C-FORMAT — anciens posts : affichage identique à avant', () => {
  it('colonne seule « reel » → 9:16, même cadre qu’avant', () => {
    const post = { format: 'reel' };
    expect(formatDuPost(post)).toBe('9:16');
    const avant = montageFrame(undefined, 'reel');
    const apres = cadreCalendrier(post);
    expect(apres.className).toBe(avant.className);
    expect(ratioNum(apres.style.aspectRatio)).toBeCloseTo(ratioNum(avant.style.aspectRatio), 6);
    expect(apres.style.height).toBe(avant.style.height);
  });

  it('colonne seule « tv » → 16:9, même cadre qu’avant', () => {
    const post = { format: 'tv' };
    expect(formatDuPost(post)).toBe('16:9');
    const avant = montageFrame(undefined, 'tv');
    const apres = cadreCalendrier(post);
    expect(apres.className).toBe(avant.className);
    expect(ratioNum(apres.style.aspectRatio)).toBeCloseTo(ratioNum(avant.style.aspectRatio), 6);
  });

  it('videoSize seul (carré Créer, colonne « tv ») → 1:1, même cadre qu’avant', () => {
    const post = { format: 'tv', metadata: { videoSize: { w: 1080, h: 1080 } } };
    expect(formatDuPost(post)).toBe('1:1');
    const avant = montageFrame({ w: 1080, h: 1080 }, 'tv');
    const apres = cadreCalendrier(post);
    expect(apres).toEqual(avant);
  });

  it('videoSize seul, sans colonne → format des dimensions', () => {
    expect(formatDuPost({ metadata: { videoSize: { w: 1920, h: 1080 } } })).toBe('16:9');
  });

  it('ancien montage de rushes (colonne « reel » par défaut, metadata.format « tv ») → 16:9', () => {
    expect(formatDuPost({ format: 'reel', metadata: { format: 'tv' } })).toBe('16:9');
  });

  it('recomposition : mêmes dimensions qu’avant pour les anciens posts', () => {
    expect(montageSize(undefined, 'reel')).toEqual({ width: 1080, height: 1920 });
    expect(montageSize(undefined, 'tv')).toEqual({ width: 1920, height: 1080 });
    expect(montageSize({ w: 1080, h: 1080 }, 'tv')).toEqual({ width: 1080, height: 1080 });
  });
});

describe('C-FORMAT — Créer en modification', () => {
  const valeurs = (f: ProjectVideoFormat) => {
    const m = metadataFormat(f);
    return { videoSize: m.videoSize, videoFormat: m.videoFormat };
  };
  it('format inchangé → aucun champ de format réécrit', () => {
    const envoi = metadataPourEnregistrement({}, valeurs('9:16'), valeurs('9:16'));
    expect(envoi).not.toHaveProperty('videoFormat');
    expect(envoi).not.toHaveProperty('videoSize');
    expect(envoi).not.toHaveProperty('format');
  });
  it('9:16 → 16:9 → videoFormat, videoSize et format suivent ensemble', () => {
    const envoi = metadataPourEnregistrement({}, valeurs('16:9'), valeurs('9:16'));
    expect(envoi).toMatchObject({ videoFormat: '16:9', videoSize: { w: 1920, h: 1080 }, format: 'tv' });
    expect(formatDuPost({ format: 'reel', metadata: envoi })).toBe('16:9');
  });
  it('rouvrir un post : le format relu est celui du post', () => {
    for (const f of PROJECT_VIDEO_FORMATS) {
      const m = metadataFormat(f);
      expect(toWizardDraft({ format: m.format, metadata: m }).format).toBe(f);
    }
    // Ancien post sans videoSize, colonne « tv » : s'ouvre en 16:9 (avant : 9:16 par défaut).
    expect(toWizardDraft({ format: 'tv', metadata: {} }).format).toBe('16:9');
  });
});

describe('C-FORMAT — les lecteurs passent par le module', () => {
  it('le Calendrier dimensionne le lecteur par formatDuPost / dimensionsDuPost', () => {
    const page = lire('src/app/dashboard/calendar/page.tsx');
    expect(page).toMatch(/formatDuPost\(fullPreviewPost\)/);
    expect(page).toMatch(/montageFrame\(dimensionsDuPost\(fullPreviewPost\)/);
    // Le lecteur du montage serveur n'est plus figé en 9:16.
    expect(page).not.toMatch(/aspectRatio: '9 \/ 16'/);
  });
  it('l’assistant n’a plus sa propre table de dimensions', () => {
    const wizard = lire('src/app/dashboard/creer/AssistantWizard.tsx');
    expect(wizard).not.toMatch(/const VIDEO_SIZE = \{/);
    expect(wizard).toMatch(/metadataFormat\(format\)/);
  });
});

/**
 * Garde-fou : pas de NOUVEAU ratio 9:16 ou de 1080x1920 écrit en dur.
 * La liste fige les occurrences légitimes existantes (nombre maximal par
 * fichier) ; un fichier absent de la liste n'en a droit à aucune.
 */
describe('C-FORMAT — aucun 9:16 codé en dur hors liste', () => {
  const MOTIF = /'9 \/ 16'|"9 \/ 16"|'9\/16'|w: 1080, h: 1920|width: 1080, height: 1920/g;
  const AUTORISES: Record<string, number> = {
    'src/lib/creer/designSpec.ts': 1, // LA table
    'src/app/dashboard/avatar/page.tsx': 7, // studio avatar : vidéo fournisseur toujours verticale
    'src/app/dashboard/calendar/page.tsx': 3, // montageFrame (défaut historique) + 2 rebuild HTML legacy, tous sous `formatProjet === '9:16'`
    'src/app/dashboard/infographic/page.tsx': 1, // ancien éditeur
    'src/components/creer/AfficheIA.tsx': 1,
    'src/components/creer/ApercuMedia.tsx': 1,
    'src/components/creer/ApercuMontageListe.tsx': 1,
    'src/components/creer/CropRushModal.tsx': 1,
    'src/components/creer/TransitionMiniPreview.tsx': 1,
    'src/components/ux/ZoneApercu.tsx': 1, // valeur par défaut de la prop `ratio`
    'src/lib/creer/smartGuides.ts': 1,
    'src/lib/ui/lecteur-generation.ts': 1,
  };
  const fichiers = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

  it('chaque fichier reste sous son plafond', () => {
    const depassements: string[] = [];
    for (const abs of fichiers(join(RACINE, 'src'))) {
      const rel = relative(RACINE, abs);
      const n = readFileSync(abs, 'utf-8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .reduce((t, l) => t + (l.match(MOTIF)?.length ?? 0), 0);
      if (n > (AUTORISES[rel] ?? 0)) depassements.push(`${rel}: ${n} > ${AUTORISES[rel] ?? 0}`);
    }
    expect(depassements).toEqual([]);
  });
});
