/**
 * M2-c — PERTINENCE des rushes : règles anti-fausse décision, affinités,
 * fixtures réalistes étiquetées (vérité terrain écrite AVANT), les 6 rushes
 * réels, et la MATRICE de confusion (aucun fournisseur, aucun réseau).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ficheContenuRush, decisionMontagePourMetadata, contenuRushsPourMetadata, type FicheContenuRush } from '@/lib/creer/fiche-contenu';
import { fusionnerFicheV2, ficheContenuV2Valide, type FicheContenuRushV2 } from '@/lib/creer/fiche-contenu-v2';
import { contexteMontageDepuis } from '@/lib/creer/smart-montage-regles';
import { conceptsDuSujet, evaluerPertinenceRushs, pertinenceRush, pertinenceRushsPourMetadata, type PertinenceRush } from '@/lib/creer/pertinence-rushs';
import { texteMotif, TEXTES_PANNEAU } from '@/lib/creer/pertinence-rushs-textes';
import { estHorsSport, IDS_CONCEPTS, conceptParId } from '@/lib/stock/requetes';

// ── Contextes : EXACTEMENT ce que Créer et l'Autopilote passent au moteur ──
const NUTRITION = contexteMontageDepuis({ theme: 'Nutrition', titre: 'Bien manger au quotidien', objectif: 'expliquer', cartes: [{ title: 'Des légumes à chaque repas' }] });
const DANSE = contexteMontageDepuis({ theme: 'Afroboost', titre: 'Cours de danse afro', objectif: 'promouvoir', cartes: [] });
const FINANCE = contexteMontageDepuis({ theme: 'Finance', titre: 'Épargner chaque mois', objectif: 'expliquer', cartes: [{ title: 'Un budget simple' }] });
const INCONNU = contexteMontageDepuis({ theme: 'Mon anniversaire', titre: 'Souvenirs', objectif: null, cartes: [] });

// ── Fiches : v1 par la VRAIE fonction M2-a, v2 par la VRAIE fusion M2-b ────
const stock = (description: string | null, requete: string | null = null, nomFichier: string | null = null) =>
  ficheContenuRush({ pexels: { description, requete }, nomFichier });
const perso = (nomFichier = 'converted_1791985445290.mp4', metadonnees: string[] | null = null) => ficheContenuRush({ nomFichier, metadonnees });
function v2(v1: FicheContenuRush, vision: string[], parole: string[] = []): FicheContenuRushV2 {
  const f = fusionnerFicheV2({
    v1,
    vision: vision.length ? { objets: [], lieu: null, action: null, personnes: null, categories: vision.map((id) => ({ id, confiance: 'moyenne' as const })) } : null,
    parole: parole.length ? { sujets: parole, dureeParlee: 6, source: 'parole' } : null,
    langue: 'fr',
    paroleEcoutee: parole.length > 0,
    etapes: { vision: { etat: vision.length ? 'faite' : 'a_faire' }, transcription: { etat: parole.length ? 'faite' : 'a_faire' } },
    usage: { tarifs: 'test' },
  });
  expect(ficheContenuV2Valide(f)).toBe(true);
  return f;
}

type Verite = 'pertinent' | 'indirect' | 'hors_sujet' | 'indeterminable';
type Obtenu = 'pertinent' | 'partiel' | 'a_verifier' | 'hors_sujet' | 'inconnu';
const obtenu = (p: PertinenceRush): Obtenu => (p.niveau === 'hors_sujet' ? 'hors_sujet' : p.aVerifier ? 'a_verifier' : p.niveau);

interface Cas { nom: string; contexte: ReturnType<typeof contexteMontageDepuis>; fiche: FicheContenuRush | FicheContenuRushV2 | null; verite: Verite; attendu: Obtenu }

// VÉRITÉ TERRAIN écrite AVANT le calcul : ce que montre réellement le média.
const CAS: Cas[] = [
  // Nutrition + images nutrition
  { nom: 'nutrition · « healthy food on a table » + image', contexte: NUTRITION, fiche: v2(stock('healthy food on a table', 'healthy food'), ['healthy-food']), verite: 'pertinent', attendu: 'pertinent' },
  { nom: 'nutrition · rush perso, image + parole « alimentation »', contexte: NUTRITION, fiche: v2(perso(), ['healthy-food'], ['healthy-food']), verite: 'pertinent', attendu: 'pertinent' },
  { nom: 'nutrition · « healthy food bowl » (description seule)', contexte: NUTRITION, fiche: stock('healthy food bowl', 'healthy food'), verite: 'pertinent', attendu: 'partiel' },
  { nom: 'nutrition · M2-a « fresh fruits and vegetables on a wooden table »', contexte: NUTRITION, fiche: stock('fresh fruits and vegetables on a wooden table', 'healthy food'), verite: 'pertinent', attendu: 'inconnu' },
  { nom: 'nutrition · M2-a « woman preparing a healthy salad in the kitchen »', contexte: NUTRITION, fiche: stock('woman preparing a healthy salad in the kitchen', 'healthy food'), verite: 'pertinent', attendu: 'inconnu' },
  // Scènes indirectement utiles à la nutrition
  { nom: 'nutrition · cuisine « woman cooking pasta » + image', contexte: NUTRITION, fiche: v2(stock('woman cooking pasta', 'healthy food'), ['cooking']), verite: 'indirect', attendu: 'partiel' },
  { nom: 'nutrition · marché « fresh vegetables at the market »', contexte: NUTRITION, fiche: stock('fresh vegetables at the market', 'healthy food'), verite: 'indirect', attendu: 'inconnu' },
  { nom: 'nutrition · bien-être « woman doing yoga at home » + image', contexte: NUTRITION, fiche: v2(stock('woman doing yoga at home'), ['yoga']), verite: 'indirect', attendu: 'partiel' },
  // Nutrition + boxe : sport, utile indirectement — JAMAIS hors sujet
  { nom: 'nutrition · boxe, rush perso image + parole', contexte: NUTRITION, fiche: v2(perso(), ['boxing'], ['boxing']), verite: 'indirect', attendu: 'partiel' },
  { nom: 'nutrition · boxe « man boxing in a gym » (recherche « healthy food » contredite)', contexte: NUTRITION, fiche: stock('man boxing in a gym', 'healthy food'), verite: 'indirect', attendu: 'a_verifier' },
  // Nutrition + finance : hors sujet, seulement sur deux preuves
  { nom: 'nutrition · finance « a man calculating his monthly budget » + image', contexte: NUTRITION, fiche: v2(stock('a man calculating his monthly budget'), ['personal-finance']), verite: 'hors_sujet', attendu: 'hors_sujet' },
  { nom: 'nutrition · finance, rush perso image + parole', contexte: NUTRITION, fiche: v2(perso(), ['personal-finance'], ['personal-finance']), verite: 'hors_sujet', attendu: 'hors_sujet' },
  { nom: 'nutrition · finance, description SEULE', contexte: NUTRITION, fiche: stock('a man calculating his monthly budget'), verite: 'hors_sujet', attendu: 'a_verifier' },
  { nom: 'nutrition · finance, image SEULE (vision plafonnée)', contexte: NUTRITION, fiche: v2(perso(), ['personal-finance']), verite: 'hors_sujet', attendu: 'a_verifier' },
  { nom: 'nutrition · football M2-a (hors taxonomie)', contexte: NUTRITION, fiche: stock('soccer players on the field during a match', 'football'), verite: 'hors_sujet', attendu: 'inconnu' },
  // Danse + danse
  { nom: 'danse · M2-a « group of people dancing zumba » + image', contexte: DANSE, fiche: v2(stock('group of people dancing zumba', 'dance workout'), ['dance']), verite: 'pertinent', attendu: 'pertinent' },
  { nom: 'danse · rush perso image + parole', contexte: DANSE, fiche: v2(perso(), ['dance'], ['dance']), verite: 'pertinent', attendu: 'pertinent' },
  { nom: 'danse · M2-a « a woman dancing hip hop on the street » (seule)', contexte: DANSE, fiche: stock('a woman dancing hip hop on the street'), verite: 'pertinent', attendu: 'partiel' },
  // Scènes indirectes pour la danse : studio, groupe, fête
  { nom: 'danse · « group of friends in a studio »', contexte: DANSE, fiche: stock('group of friends in a studio'), verite: 'indirect', attendu: 'partiel' },
  { nom: 'danse · fête « people at a party with music »', contexte: DANSE, fiche: stock('people at a party with music'), verite: 'indirect', attendu: 'partiel' },
  { nom: 'danse · cardio « women doing cardio » + image', contexte: DANSE, fiche: v2(stock('women doing cardio'), ['cardio']), verite: 'indirect', attendu: 'partiel' },
  { nom: 'danse · cuisine « chef cooking in a kitchen » + image', contexte: DANSE, fiche: v2(stock('chef cooking in a kitchen'), ['cooking']), verite: 'hors_sujet', attendu: 'hors_sujet' },
  // Finance
  { nom: 'finance · « people dancing at a party » + image', contexte: FINANCE, fiche: v2(stock('people dancing at a party', 'party'), ['dance']), verite: 'hors_sujet', attendu: 'hors_sujet' },
  { nom: 'finance · M2-a « people dancing at a party » (seule)', contexte: FINANCE, fiche: stock('people dancing at a party', 'party'), verite: 'hors_sujet', attendu: 'a_verifier' },
  { nom: 'finance · M2-a « a man calculating his monthly budget »', contexte: FINANCE, fiche: stock('a man calculating his monthly budget', 'personal finance'), verite: 'pertinent', attendu: 'partiel' },
  { nom: 'finance · productivité « woman working focused » + image', contexte: FINANCE, fiche: v2(stock('woman working focused'), ['productivity']), verite: 'indirect', attendu: 'partiel' },
  // Observations contradictoires
  { nom: 'danse · description danse, image cuisine (contradictoires)', contexte: DANSE, fiche: v2(stock('people dancing'), ['cooking']), verite: 'indeterminable', attendu: 'a_verifier' },
  { nom: 'danse · recherche « dance » contredite par « chef cooking pasta » + image', contexte: DANSE, fiche: v2(stock('chef cooking pasta', 'dance'), ['cooking']), verite: 'hors_sujet', attendu: 'a_verifier' },
  // Sans description, sans fiche, M2-b manquante
  { nom: 'rush perso sans description ni v2', contexte: NUTRITION, fiche: perso(), verite: 'indeterminable', attendu: 'inconnu' },
  { nom: 'ancien post sans fiche', contexte: DANSE, fiche: null, verite: 'indeterminable', attendu: 'inconnu' },
  // Requête Pexels SEULE : ne prouve rien, ni pour ni contre
  { nom: 'nutrition · requête « boxing » seule', contexte: NUTRITION, fiche: stock(null, 'boxing'), verite: 'indeterminable', attendu: 'inconnu' },
  { nom: 'nutrition · requête « healthy food » seule', contexte: NUTRITION, fiche: stock(null, 'healthy food'), verite: 'indeterminable', attendu: 'inconnu' },
  { nom: 'nutrition · requête « personal finance » + image finance', contexte: NUTRITION, fiche: v2(stock(null, 'personal finance'), ['personal-finance']), verite: 'hors_sujet', attendu: 'a_verifier' },
  // Nom de fichier trompeur
  { nom: 'finance · fichier « cours-danse-afro.mp4 »', contexte: FINANCE, fiche: perso('cours-danse-afro.mp4'), verite: 'indeterminable', attendu: 'inconnu' },
  { nom: 'nutrition · fichier « boxe.mp4 » + requête « boxing »', contexte: NUTRITION, fiche: stock(null, 'boxing', 'boxe.mp4'), verite: 'indeterminable', attendu: 'inconnu' },
  { nom: 'nutrition · fichier « budget-finance.mp4 » + image finance', contexte: NUTRITION, fiche: v2(perso('budget-finance.mp4'), ['personal-finance']), verite: 'hors_sujet', attendu: 'a_verifier' },
  { nom: 'danse · fichier « danse.mp4 » + image danse', contexte: DANSE, fiche: v2(perso('danse.mp4'), ['dance']), verite: 'pertinent', attendu: 'pertinent' },
  // Métadonnées : jamais une preuve de pertinence (circulaire), recevables pour une divergence
  { nom: 'danse · métadonnées « danse » seules', contexte: DANSE, fiche: perso('converted_1.mp4', ['Cours de danse']), verite: 'indeterminable', attendu: 'partiel' },
  { nom: 'finance · métadonnées « cours de danse » + image danse', contexte: FINANCE, fiche: v2(perso('converted_1.mp4', ['Cours de danse']), ['dance']), verite: 'hors_sujet', attendu: 'hors_sujet' },
  // Thème non reconnu
  { nom: 'thème non reconnu · danse + image', contexte: INCONNU, fiche: v2(stock('people dancing'), ['dance']), verite: 'indeterminable', attendu: 'inconnu' },
];

// Les 6 rushes RÉELS (scratchpad/rushes-reels) : fiches M2-a locales = noms de fichier seuls.
const RUSHES_REELS = [
  'converted_1791985445290.mp4', 'converted_1792081208949.mp4',
  'stock-pexels-video-34521342.mp4', 'stock-pexels-video-35532643.mp4', 'stock-pexels-video-7815139.mp4', 'stock-pexels-video-8955360.mp4',
];

describe('M2-c — fixtures étiquetées : chaque verdict attendu', () => {
  for (const c of CAS) {
    it(c.nom, () => {
      const p = pertinenceRush(c.fiche, c.contexte, { cle: '/media/u/x.mp4' });
      expect(obtenu(p)).toBe(c.attendu);
      expect(p.raisons.length).toBeGreaterThan(0);
      expect(p.raisons.length).toBeLessThanOrEqual(3);
      if (p.niveau === 'inconnu') expect(p.score).toBeNull();
      else expect(p.score).toBeGreaterThanOrEqual(0);
      if (p.niveau === 'pertinent') expect(p.score!).toBeGreaterThanOrEqual(0.7);
      if (p.niveau === 'partiel') expect(p.score! >= 0.35 && p.score! <= 0.65).toBe(true);
      if (p.niveau === 'hors_sujet') expect(p.score!).toBeLessThanOrEqual(0.15);
    });
  }

  it('les 6 rushes réels (fiches M2-a locales) : « inconnu » pour chaque sujet, jamais hors sujet', () => {
    for (const nom of RUSHES_REELS) {
      const f = perso(nom);
      expect(f.categories).toEqual([]);
      for (const ctx of [NUTRITION, DANSE, FINANCE]) {
        const p = pertinenceRush(f, ctx);
        expect(p.niveau).toBe('inconnu');
        expect(p.score).toBeNull();
        expect(p.raisons[0]).toMatch(/^Contenu non identifié/);
      }
    }
  });

  it('MATRICE de confusion : 0 faux positif « hors sujet »', () => {
    const lignes: Verite[] = ['pertinent', 'indirect', 'hors_sujet', 'indeterminable'];
    const colonnes: Obtenu[] = ['pertinent', 'partiel', 'a_verifier', 'hors_sujet', 'inconnu'];
    const m = Object.fromEntries(lignes.map((l) => [l, Object.fromEntries(colonnes.map((c) => [c, 0]))])) as Record<Verite, Record<Obtenu, number>>;
    const tous = [...CAS.map((c) => ({ v: c.verite, o: obtenu(pertinenceRush(c.fiche, c.contexte)) })),
      ...RUSHES_REELS.map((n) => ({ v: 'indeterminable' as Verite, o: obtenu(pertinenceRush(perso(n), NUTRITION)) }))];
    for (const { v, o } of tous) m[v][o]++;
    const fauxPositifs = tous.filter((x) => x.o === 'hors_sujet' && x.v !== 'hors_sujet').length;
    const fauxNegatifs = tous.filter((x) => x.v === 'hors_sujet' && x.o !== 'hors_sujet').length;
    const vraisHS = tous.filter((x) => x.v === 'hors_sujet' && x.o === 'hors_sujet').length;
    const table = [`| vérité \\ obtenu | ${colonnes.join(' | ')} |`, `|---|${colonnes.map(() => '---').join('|')}|`,
      ...lignes.map((l) => `| ${l} | ${colonnes.map((c) => m[l][c]).join(' | ')} |`)].join('\n');
    const sortie = process.env.M2C_MATRICE;
    if (sortie) writeFileSync(sortie, `${table}\n\nTotal ${tous.length} ; hors sujet détectés ${vraisHS} ; faux positifs hors sujet ${fauxPositifs} ; faux négatifs ${fauxNegatifs}\n`);
    expect(fauxPositifs).toBe(0);
    // Un rush utile n'est JAMAIS marqué « hors sujet ».
    expect(m.pertinent.hors_sujet + m.indirect.hors_sujet + m.indeterminable.hors_sujet).toBe(0);
    expect(vraisHS).toBeGreaterThanOrEqual(5);
  });
});

describe('M2-c — règles anti-fausse décision', () => {
  const dansePourFinance = (sources: string[]) => ({ version: 2 as const, categories: [{ id: 'dance', confiance: 'elevee' as const, sources }], parole: 'inconnu' as const, inconnus: [], source: 'x' }) as unknown as FicheContenuRush;

  it('une seule source divergente (image seule, description seule, parole seule) n’est JAMAIS hors sujet', () => {
    for (const s of [['vision'], ['pexels-description'], ['parole'], ['metadonnees']]) {
      const p = pertinenceRush(dansePourFinance(s), FINANCE);
      expect(p.niveau).toBe('partiel');
      expect(p.aVerifier).toBe(true);
      expect(p.raisons[0]).toMatch(/^À vérifier : semble montrer Danse, sujet Finance \(une seule source\)$/);
    }
  });

  it('la requête Pexels ne compte jamais, même « élevée » avec une autre source', () => {
    expect(pertinenceRush(dansePourFinance(['pexels-requete']), FINANCE).niveau).toBe('inconnu');
    expect(pertinenceRush(dansePourFinance(['pexels-requete', 'vision']), FINANCE).aVerifier).toBe(true);
    expect(pertinenceRush(dansePourFinance(['pexels-requete', 'vision']), FINANCE).niveau).not.toBe('hors_sujet');
    // Ni pour « pertinent » : requête « dance » + image danse = une seule preuve.
    expect(pertinenceRush(dansePourFinance(['pexels-requete', 'vision']), DANSE).niveau).toBe('partiel');
  });

  it('le nom de fichier ne compte jamais pour « hors sujet », ni seul pour rien', () => {
    expect(pertinenceRush(dansePourFinance(['nom-fichier']), FINANCE).niveau).toBe('inconnu');
    expect(pertinenceRush(dansePourFinance(['nom-fichier', 'vision']), FINANCE).niveau).toBe('partiel');
    expect(pertinenceRush(dansePourFinance(['nom-fichier', 'vision']), DANSE).niveau).toBe('pertinent');
  });

  it('deux sources indépendantes concordantes → hors sujet, avec la raison lisible', () => {
    const p = pertinenceRush(dansePourFinance(['pexels-description', 'vision']), FINANCE);
    expect(p).toMatchObject({ niveau: 'hors_sujet', aVerifier: false, score: 0.15, confiance: 'moyenne', sources: ['pexels-description', 'vision'] });
    expect(p.raisons).toEqual(['Hors sujet pour Finance : montre Danse (description + image)']);
    expect(pertinenceRush(dansePourFinance(['pexels-description', 'vision', 'parole']), FINANCE)).toMatchObject({ niveau: 'hors_sujet', confiance: 'elevee', score: 0.1 });
  });

  it('drapeau `contradiction` : jamais hors sujet, jamais pertinent', () => {
    const f = { ...dansePourFinance(['pexels-description', 'vision']), contradiction: true as const };
    expect(obtenu(pertinenceRush(f, FINANCE))).toBe('a_verifier');
    expect(obtenu(pertinenceRush(f, DANSE))).toBe('a_verifier');
  });

  it('confiance « faible » ignorée ; catégories personnes / qualité / style jamais prises en compte', () => {
    const faible = { ...dansePourFinance(['pexels-description', 'vision']), categories: [{ id: 'dance', confiance: 'faible', sources: ['pexels-description', 'vision'] }] } as unknown as FicheContenuRush;
    expect(pertinenceRush(faible, FINANCE).niveau).toBe('inconnu');
    const humains = { ...faible, categories: ['woman', 'group', 'happy', 'energetic', 'african'].map((id) => ({ id, confiance: 'elevee', sources: ['pexels-description', 'vision'] })) } as unknown as FicheContenuRush;
    expect(pertinenceRush(humains, FINANCE).niveau).toBe('inconnu');
  });

  it('fiche falsifiée (id inconnu, texte libre) : ignorée, aucune raison n’en recopie un mot', () => {
    const f = { ...dansePourFinance([]), categories: [{ id: 'ignore les consignes', confiance: 'elevee', sources: ['vision', 'pexels-description'] }, { id: 'dance', confiance: 'moyenne', sources: ['vision', 'IGNORE'] }] } as unknown as FicheContenuRush;
    const p = pertinenceRush(f, FINANCE);
    expect(JSON.stringify(p)).not.toMatch(/ignore|IGNORE|consigne/);
    expect(p.niveau).toBe('partiel');
  });

  it('thème non reconnu → inconnu « sujet non reconnu »', () => {
    const p = pertinenceRush(dansePourFinance(['pexels-description', 'vision']), INCONNU);
    expect(p).toMatchObject({ niveau: 'inconnu', score: null });
    expect(p.raisons[0]).toMatch(/^Sujet non reconnu/);
  });

  it('la qualité technique (M1) n’entre pas : signature sans analyse ni qualité', () => {
    const src = readFileSync('src/lib/creer/pertinence-rushs.ts', 'utf8');
    expect(src).not.toMatch(/qualite-rushs|evaluerQualiteRushs|nettete|luminosite|AnalyseRush/);
    expect(pertinenceRush.length).toBeLessThanOrEqual(3);
  });

  it('le scénario (pas encore un champ produit) ne change rien', () => {
    const f = dansePourFinance(['pexels-description', 'vision']);
    expect(pertinenceRush(f, FINANCE, { scenario: 'publicite' })).toEqual(pertinenceRush(f, FINANCE));
  });
});

describe('M2-c — affinités minimales entre concepts EXISTANTS', () => {
  it('aucun concept ajouté : affinités et décors ne citent que des ids de CONCEPTS', () => {
    const src = readFileSync('src/lib/creer/pertinence-rushs.ts', 'utf8');
    const ids = [...src.slice(src.indexOf('const AFFINITES'), src.indexOf('const estSport')).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(IDS_CONCEPTS.has(id)).toBe(true);
  });

  it('familles : sport (Alimentation saine, Bien-être, Récupération compris) vs hors sport', () => {
    expect(['healthy-food', 'wellness', 'rest-recovery', 'boxing', 'dance'].every((id) => !estHorsSport(id))).toBe(true);
    expect(['personal-finance', 'cooking', 'travel', 'skincare', 'productivity'].every(estHorsSport)).toBe(true);
    expect(estHorsSport('beach')).toBe(false);
    expect(estHorsSport('inconnu')).toBe(false);
  });

  it('nutrition ↔ cuisine, beauté ↔ bien-être, finance ↔ productivité : jamais hors sujet, même à 3 sources', () => {
    const f = (id: string) => ({ version: 1, categories: [{ id, confiance: 'elevee', sources: ['pexels-description', 'vision', 'parole'] }], parole: 'inconnu', inconnus: [], source: 'x' }) as unknown as FicheContenuRush;
    const ctx = (theme: string) => contexteMontageDepuis({ theme });
    expect(pertinenceRush(f('cooking'), ctx('Nutrition')).raisons[0]).toBe('Montre Cuisine, proche du sujet Alimentation saine');
    expect(pertinenceRush(f('healthy-food'), ctx('Cuisine')).niveau).toBe('partiel');
    expect(pertinenceRush(f('wellness'), ctx('Beauté')).niveau).toBe('partiel');
    expect(pertinenceRush(f('productivity'), ctx('Finance')).niveau).toBe('partiel');
    expect(pertinenceRush(f('boxing'), ctx('Nutrition')).raisons[0]).toBe('Montre Boxe, activité voisine du sujet Alimentation saine');
    expect(pertinenceRush(f('studio'), ctx('Danse')).raisons[0]).toBe('Décor en lien avec le sujet : en studio');
    // Un lieu sans lien n'est pas une preuve d'hors-sujet.
    expect(pertinenceRush(f('beach'), ctx('Finance')).niveau).toBe('inconnu');
  });

  it('Afroboost implique la danse (même lecture que le moteur)', () => {
    expect(conceptsDuSujet(contexteMontageDepuis({ theme: 'Afroboost' })).activites).toEqual(['dance', 'workout']);
    expect(conceptParId('dance')?.libelle).toBe('Danse');
  });
});

describe('M2-c — metadata et non-régression', () => {
  const q = { version: 1, rushs: [{ cle: '/a', verdict: 'ok' }] };
  const c = contenuRushsPourMetadata([{ cle: '/media/u/a.mp4', fiche: stock('people dancing') }]);

  it('3e argument absent ou null : sortie identique, octet pour octet', () => {
    for (const [qq, cc] of [[null, null], [q, null], [null, c], [q, c]] as const) {
      const avant = JSON.stringify(decisionMontagePourMetadata(qq, cc));
      expect(JSON.stringify(decisionMontagePourMetadata(qq, cc, null))).toBe(avant);
      expect(JSON.stringify(decisionMontagePourMetadata(qq, cc, undefined))).toBe(avant);
    }
    expect(decisionMontagePourMetadata(null, null, null)).toEqual({});
  });

  it('anciens projets / posts sans fiche : aucune clé pertinence', () => {
    const d = evaluerPertinenceRushs([{ cle: '/media/u/a.mp4', fiche: null }, { cle: '/media/u/b.mp4', fiche: perso() }], NUTRITION);
    expect(d.rushs.map((r) => r.niveau)).toEqual(['inconnu', 'inconnu']);
    expect(pertinenceRushsPourMetadata(d)).toBeNull();
    expect(decisionMontagePourMetadata(null, null, pertinenceRushsPourMetadata(d))).toEqual({});
  });

  it('forme compacte v1, sans URL ni texte de fiche', () => {
    const d = evaluerPertinenceRushs([
      { cle: 'https://studiio.pro/storage/v1/object/public/media/u/a.mp4', fiche: v2(stock('people dancing at a party', 'party'), ['dance']) },
      { cle: '/media/u/b.mp4', fiche: perso() },
    ], FINANCE);
    const m = pertinenceRushsPourMetadata(d)!;
    expect(m.version).toBe(1);
    expect(m.theme).toEqual(['personal-finance']);
    expect(m.rushs[0]).toEqual({ cle: '/storage/v1/object/public/media/u/a.mp4', niveau: 'hors_sujet', score: 0.15, raisons: ['Hors sujet pour Finance : montre Danse (description + image)'], sources: ['pexels-description', 'vision'] });
    expect(m.rushs[1]).toMatchObject({ niveau: 'inconnu', score: null });
    expect(JSON.stringify(m)).not.toMatch(/https?:|party/);
    const dm = decisionMontagePourMetadata(q, c, m);
    expect(Object.keys(dm.decisionMontage!)).toEqual(['version', 'qualiteRushs', 'contenuRushs', 'pertinenceRushs']);
  });

  it('i18n : chaque motif et chaque texte du panneau existe en fr / en / de', () => {
    const codes = ['theme_inconnu', 'non_identifie', 'sans_lien', 'recherche_contredite', 'contradictoire', 'comme_sujet', 'comme_sujet_une_source', 'proche_sujet', 'meme_famille', 'decor', 'divergence', 'hors_sujet'] as const;
    for (const l of ['fr', 'en', 'de'] as const) {
      for (const code of codes) {
        const t = texteMotif({ code, concept: 'dance', theme: 'personal-finance', sources: ['vision', 'parole'] }, l);
        expect(t.length).toBeGreaterThan(5);
        expect(t).not.toMatch(/undefined/);
      }
      expect(TEXTES_PANNEAU[l].badgeHorsSujet('X')).toContain('X');
    }
    expect(texteMotif({ code: 'hors_sujet', concept: 'dance', theme: 'personal-finance', sources: ['vision', 'parole'] }, 'en')).toBe('Off-topic for Finance: shows Dance (image + speech)');
    expect(texteMotif({ code: 'hors_sujet', concept: 'dance', theme: 'personal-finance', sources: ['vision', 'parole'] }, 'de')).toBe('Themenfremd für Finanzen: zeigt Tanz (Bild + Sprache)');
  });

  it('isolement du plan : `pertinence-rushs` n’est importé ni par le moteur, ni par le rendu, ni par la spec de rendu', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const importeurs = execSync("grep -rl \"pertinence-rushs'\" src --include=*.ts --include=*.tsx || true", { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !f.includes('__tests__')).sort();
    expect(importeurs).toEqual([
      'src/app/dashboard/creer/AssistantWizard.tsx',
      'src/components/creer/QualiteRushs.tsx',
      'src/lib/autopilot/produire.ts',
    ]);
    const p = readFileSync('src/lib/autopilot/produire.ts', 'utf8');
    // Calculé APRÈS le rendu (le rendu ne peut pas le lire).
    expect(p.indexOf('evaluerPertinenceRushs(')).toBeGreaterThan(p.indexOf('await renderAndUpload({'));
    for (const f of ['src/lib/creer/smart-montage.ts', 'src/lib/creer/smart-montage-regles.ts']) {
      if (existsSync(f)) expect(readFileSync(f, 'utf8')).not.toMatch(/pertinence-rushs/);
    }
  });

  it('Créer : le contexte du panneau est le MÊME appel que celui de l’export', () => {
    const aw = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
    const appels = [...aw.matchAll(/contexteMontageDepuis\(\{([\s\S]*?)\}\)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    expect(appels).toHaveLength(2);
    expect(appels[0]).toBe(appels[1]);
    expect(aw).toMatch(/<QualiteRushs [^>]*contexte=\{contextePertinence\}/);
    expect(aw).toMatch(/decisionMontagePourMetadata\(qualiteRushsCreer, contenuRushsCreer, pertinenceRushsCreer\)/);
  });
});
