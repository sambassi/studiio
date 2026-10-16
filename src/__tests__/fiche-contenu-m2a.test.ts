/**
 * M2-a — Fiche de contenu d'un rush : fonction PURE, sans IA, sans réseau.
 * Les attributions Pexels ci-dessous sont des FIXTURES au format réel de
 * `attributionPourStockage` (slug de page, description = `motsDuSlug`,
 * requête anglaise envoyée au moteur) — aucune image inventée.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import {
  ficheContenuRush,
  ficheContenuValide,
  completerParole,
  motsDuNomFichier,
  paroleDepuisEnergie,
  libelleContenu,
  contenuRushsPourMetadata,
  decisionMontagePourMetadata,
} from '@/lib/creer/fiche-contenu';
import { conceptsReconnus, conceptsDe, IDS_CONCEPTS } from '@/lib/stock/requetes';
import { planMontage, type AnalyseRush } from '@/lib/creer/smart-montage';

const cat = (f: ReturnType<typeof ficheContenuRush>, id: string) => f.categories.find((c) => c.id === id);
const SILENCE = Array.from({ length: 20 }, () => 0);

describe('sources Pexels', () => {
  it('description explicite seule → catégorie de la taxonomie, confiance MOYENNE (une seule source)', () => {
    const f = ficheContenuRush({ pexels: { description: 'a man calculating his budget at home' } });
    expect(cat(f, 'personal-finance')).toEqual({ id: 'personal-finance', confiance: 'moyenne', sources: ['pexels-description'] });
    expect(cat(f, 'man')?.confiance).toBe('moyenne');
    expect(cat(f, 'home')?.confiance).toBe('moyenne');
    // « budget » est un nom, pas un verbe : l'action reste inconnue.
    expect(f.inconnus).toEqual(['objets', 'action'])
    expect(f.source).toBe("d'après description Pexels");
  });

  it('sans description mais URL de page avec slug (imports d’avant M2-a) → même lecture', () => {
    const f = ficheContenuRush({ pexels: { sourceUrl: 'https://www.pexels.com/video/women-dancing-in-a-studio-8955360/' } });
    expect(f.categories.map((c) => [c.id, c.confiance])).toEqual([['dance', 'moyenne'], ['studio', 'moyenne']]);
    expect(f.categories.every((c) => c.sources.join() === 'pexels-description')).toBe(true);
  });

  it('URL sans slug (`/video/<id>/`) ou hors pexels.com → aucune description inventée', () => {
    expect(ficheContenuRush({ pexels: { sourceUrl: 'https://www.pexels.com/video/8955360/' } }).categories).toEqual([]);
    expect(ficheContenuRush({ pexels: { sourceUrl: 'https://evil.test/video/women-dancing-1/' } }).categories).toEqual([]);
  });

  it('requête seule → moyenne (ce qu’on cherchait, pas ce que montre le média)', () => {
    const f = ficheContenuRush({ pexels: { requete: 'healthy food' } });
    expect(f.categories).toEqual([
      { id: 'healthy-food', confiance: 'moyenne', sources: ['pexels-requete'] },
      { id: 'cooking', confiance: 'moyenne', sources: ['pexels-requete'] }, // « food » : mot français du concept Cuisine
    ]);
    // Une recherche n'établit rien : tout reste inconnu.
    expect(f.inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
  });

  it('deux sources concordantes → élevée ; discordantes → la recherche contredite tombe à faible', () => {
    const concord = ficheContenuRush({ pexels: { description: 'a woman eating healthy at home', requete: 'healthy food' } });
    expect(cat(concord, 'healthy-food')).toEqual({ id: 'healthy-food', confiance: 'elevee', sources: ['pexels-description', 'pexels-requete'] });
    // « fruits » est un mot FRANÇAIS de la taxonomie : jamais lu dans un titre anglais.
    expect(cat(ficheContenuRush({ pexels: { description: 'fresh fruits on a table', requete: 'healthy food' } }), 'healthy-food')?.confiance).toBe('moyenne');
    const discord = ficheContenuRush({ pexels: { description: 'group of people dancing', requete: 'personal finance' } });
    expect(cat(discord, 'dance')?.confiance).toBe('moyenne');
    expect(cat(discord, 'personal-finance')).toEqual({ id: 'personal-finance', confiance: 'faible', sources: ['pexels-requete'] });
    expect(discord.contradiction).toBe(true);
    // Description muette sur l'activité : la recherche n'est pas contredite.
    const muette = ficheContenuRush({ pexels: { description: 'woman sitting at a table', requete: 'personal finance' } });
    expect(cat(muette, 'personal-finance')?.confiance).toBe('moyenne');
  });
});

describe('nom de fichier', () => {
  it('nom parlant → indices, confiance faible au maximum', () => {
    const f = ficheContenuRush({ nomFichier: '1791985445290-cours-de-danse-plage.mp4' });
    expect(f.categories.map((c) => [c.id, c.confiance])).toEqual([['group', 'faible'], ['dance', 'faible'], ['beach', 'faible']]);
    expect(f.categories.every((c) => c.sources.join() === 'nom-fichier')).toBe(true);
    // Faible seul n'établit rien : tout reste inconnu.
    expect(f.inconnus).toEqual(['objets', 'lieu', 'action', 'personnes']);
  });

  it.each([
    'converted_1791985445290.mp4', 'converted_1792081208949.mp4', 'stock-pexels-video-34521342.mp4',
    '3f2b8c1e-9a4d-4e7f-8b1a-2c3d4e5f6a7b.mp4', 'IMG_1234.MOV', 'VID_20260101_123456.mp4', 'PXL_20261003_101010123.mp4',
    'DSC0042.mp4', 'video.mp4', 'rush 3.mp4', 'Screen Recording 2026-10-01 at 10.00.00.mov', '1791985445290-IMG_1234.mp4',
  ])('nom non fiable %s → aucun indice', (nom) => {
    expect(motsDuNomFichier(nom)).toBe('');
    expect(ficheContenuRush({ nomFichier: nom }).categories).toEqual([]);
  });

  it('identifiant d’appareil collé à un mot : seul le mot compte', () => {
    expect(motsDuNomFichier('IMG_1234_yoga.mp4')).toBe('yoga');
  });
});

describe('métadonnées, aucun indice, concordance entre familles', () => {
  it('métadonnées enregistrées seules → moyenne', () => {
    const f = ficheContenuRush({ metadonnees: ['Cours de yoga du samedi'] });
    expect(cat(f, 'yoga')).toEqual({ id: 'yoga', confiance: 'moyenne', sources: ['metadonnees'] });
  });
  it('nom de fichier + requête concordants → élevée', () => {
    const f = ficheContenuRush({ nomFichier: 'recette-salade.mp4', pexels: { requete: 'healthy food' } });
    expect(cat(f, 'healthy-food')).toEqual({ id: 'healthy-food', confiance: 'elevee', sources: ['pexels-requete', 'nom-fichier'] });
  });
  it('rush personnel sans indice → categories [], tout inconnu', () => {
    for (const f of [ficheContenuRush({ nomFichier: 'converted_1791985445290.mp4' }), ficheContenuRush({}), ficheContenuRush(null)]) {
      expect(f).toEqual({ version: 1, categories: [], parole: 'inconnu', inconnus: ['objets', 'lieu', 'action', 'personnes'], source: 'aucun indice fiable' });
      expect(libelleContenu(f)).toBe('Contenu : inconnu');
    }
  });
  it('aucune catégorie hors de la taxonomie fermée', () => {
    const f = ficheContenuRush({ pexels: { description: 'soccer players kicking a ball on a football field', requete: 'football' }, nomFichier: 'match-foot.mp4' });
    expect(f.categories).toEqual([]); // le football n'existe pas dans CONCEPTS : rien d'inventé
    expect(f.source).toBe('rien de reconnu dans : description Pexels, recherche Pexels, nom du fichier');
    for (const c of ficheContenuRush({ pexels: { description: 'a woman dancing at the beach with headphones' } }).categories) expect(IDS_CONCEPTS.has(c.id)).toBe(true);
  });
});

describe('parole (énergie audio déjà mesurée)', () => {
  it('muet de bout en bout → improbable ; son présent → inconnu (RMS ne sépare pas voix et musique)', () => {
    expect(paroleDepuisEnergie(SILENCE)).toBe('improbable');
    expect(paroleDepuisEnergie([0, 0.5, 0.6, 0.4, 0.5])).toBe('inconnu');
    expect(paroleDepuisEnergie([0, 0])).toBe('inconnu'); // trop peu d'échantillons
    expect(paroleDepuisEnergie(null)).toBe('inconnu');
    expect(ficheContenuRush({ energieAudio: SILENCE }).source).toBe("d'après énergie audio");
  });
  it('completerParole : en mémoire, seulement si la fiche ne savait pas', () => {
    const f = ficheContenuRush({ pexels: { description: 'woman doing yoga' } });
    const c = completerParole(f, SILENCE);
    expect(c.parole).toBe('improbable');
    expect(c.categories).toBe(f.categories);
    expect(f.parole).toBe('inconnu'); // pas de mutation
    expect(completerParole(c, [0.5, 0.5, 0.5])).toBe(c);
    expect(c.source).toBe("d'après description Pexels, énergie audio");
    const mixte = completerParole(ficheContenuRush({ pexels: { description: 'woman doing yoga', requete: 'soccer' } }), SILENCE);
    expect(mixte.source).toBe("d'après description Pexels, énergie audio · rien de reconnu dans : recherche Pexels");
  });
});

describe('validation, libellé, métadonnées', () => {
  it('ficheContenuValide : la forme v1 seulement, énumérations fermées', () => {
    const f = ficheContenuRush({ pexels: { description: 'woman doing yoga' } });
    expect(ficheContenuValide(f)).toBe(true);
    expect(ficheContenuValide({ ...f, version: 2 })).toBe(false);
    expect(ficheContenuValide({ ...f, categories: [{ id: 'football', confiance: 'elevee', sources: ['pexels-description'] }] })).toBe(false);
    expect(ficheContenuValide({ ...f, categories: [{ id: 'yoga', confiance: 'certaine', sources: ['pexels-description'] }] })).toBe(false);
    expect(ficheContenuValide({ ...f, parole: 'oui' })).toBe(false);
    expect(ficheContenuValide({ ...f, inconnus: ['visage'] })).toBe(false);
    expect(ficheContenuValide(null)).toBe(false);
  });
  it('libellé discret', () => {
    expect(libelleContenu(ficheContenuRush({ pexels: { requete: 'healthy food' } }))).toBe("Contenu : Alimentation saine (moyenne, d'après recherche Pexels)");
  });
  it('contenuRushsPourMetadata : null si rien d’informatif ; jamais d’URL ni de texte fournisseur', () => {
    const vide = ficheContenuRush({ nomFichier: 'converted_1.mp4' });
    expect(contenuRushsPourMetadata([{ cle: 'media/u/library/converted_1.mp4', fiche: vide }])).toBeNull();
    const m = contenuRushsPourMetadata([
      { cle: 'media/u/library/converted_1.mp4', fiche: vide },
      { cle: 'https://studiio.pro/x/media/u/library/stock-pexels-video-1.mp4', fiche: ficheContenuRush({ pexels: { description: 'women dancing in a studio' } }) },
      { cle: 'media/u/library/absent.mp4', fiche: null },
    ])!;
    expect(m.version).toBe(1);
    expect(m.rushs).toHaveLength(2);
    expect(JSON.stringify(m)).not.toMatch(/https?:|women|studio d/);
    expect(m.rushs[1]).toEqual({ cle: '/x/media/u/library/stock-pexels-video-1.mp4', categories: [{ id: 'dance', confiance: 'moyenne', sources: ['pexels-description'] }, { id: 'studio', confiance: 'moyenne', sources: ['pexels-description'] }], parole: 'inconnu', inconnus: ['objets'] });
  });
  it('decisionMontagePourMetadata : sans fiche, EXACTEMENT la clé d’avant (M1)', () => {
    const q = { version: 1, rushs: [] };
    expect(decisionMontagePourMetadata(q, null)).toEqual({ decisionMontage: { version: 1, qualiteRushs: q } });
    expect(JSON.stringify(decisionMontagePourMetadata(q, null))).toBe(JSON.stringify({ decisionMontage: { version: 1, qualiteRushs: q } }));
    expect(decisionMontagePourMetadata(null, null)).toEqual({});
    const c = contenuRushsPourMetadata([{ cle: 'k', fiche: ficheContenuRush({ energieAudio: SILENCE }) }]);
    expect(decisionMontagePourMetadata(null, c)).toEqual({ decisionMontage: { version: 1, contenuRushs: c } });
  });
});

describe('taxonomie : conceptsReconnus étend la lecture à l’anglais sans toucher conceptsDe', () => {
  it('français = conceptsDe ; anglais = formes déjà portées par les concepts', () => {
    expect(conceptsReconnus('danse en groupe').map((c) => c.id)).toEqual(conceptsDe('danse en groupe').map((c) => c.en.replace(/\s+/g, '-')));
    expect(conceptsReconnus('people dancing').map((c) => c.id)).toEqual(['dance']);
    expect(conceptsReconnus('an african woman').map((c) => c.id)).toEqual(['african', 'woman']); // aucune implication « danse »
    expect(conceptsReconnus('managing money').map((c) => c.id)).toEqual(['personal-finance']);
  });
});

describe('non-régression : planMontage et analyses intacts', () => {
  const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const rush = (url: string, audio: number): AnalyseRush => ({
    url, duree: 12,
    echantillons: Array.from({ length: 24 }, (_, k) => ({ t: k * 0.5, mouvement: 0.04 + 0.02 * Math.sin(k), luminosite: 0.45, nettete: 0.15, audio })),
  });
  it('calculer des fiches ne mute rien et ne change pas le plan', () => {
    const analyses = [rush('/storage/v1/object/public/media/u/library/stock-pexels-video-1.mp4', 0), rush('/storage/v1/object/public/media/u/library/converted_2.mp4', 0.4)];
    const copie = JSON.parse(JSON.stringify(analyses));
    const avant = hash(planMontage(copie, 10, { contexte: { theme: 'nutrition' } }));
    for (const a of analyses) ficheContenuRush({ nomFichier: a.url, energieAudio: a.echantillons.map((e) => e.audio) });
    expect(analyses).toEqual(copie);
    expect(hash(planMontage(analyses, 10, { contexte: { theme: 'nutrition' } }))).toBe(avant);
  });
  it('smart-montage.ts ne connaît pas les fiches ; le rendu non plus', () => {
    expect(readFileSync('src/lib/creer/smart-montage.ts', 'utf8')).not.toMatch(/fiche-contenu|contenuRushs/);
    for (const f of ['src/lib/autopilot/render.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(/contenuRushs|fiche-contenu/);
  });
});

describe('aucun fournisseur IA dans les fichiers M2-a', () => {
  const FICHIERS = [
    'src/lib/creer/fiche-contenu.ts', 'src/lib/creer/fiche-contenu-serveur.ts', 'src/lib/creer/fiche-contenu-client.ts',
    'src/lib/stock/requetes-memo.ts', 'src/app/api/creer/fiches-contenu/route.ts',
  ];
  it.each(FICHIERS)('%s', (f) => {
    const src = readFileSync(f, 'utf8');
    expect(src).not.toMatch(/anthropic|groq|openai|replicate|elevenlabs|heygen|@\/lib\/ai\/|visuel-anthropic|transcription-groq|api\.pexels\.com/i);
    // Aucun appel réseau sortant hors de notre propre route.
    const fetchs = src.match(/fetch\(([^)]{0,60})/g) ?? [];
    for (const x of fetchs) expect(x).toContain('/api/creer/fiches-contenu');
  });
});
