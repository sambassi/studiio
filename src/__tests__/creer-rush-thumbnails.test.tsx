/**
 * CREER_PREMIUM_3F — UN RUSH LISIBLE A UNE IMAGE.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CE QUI ÉTAIT CONFONDU
 * ───────────────────────────────────────────────────────────────────────────
 *
 * La carte affichait une pellicule grise pour `rush-ALPHA.mp4` et
 * `rush-BRAVO.mp4`. Ce n'était pas un défaut d'affichage : `rush_analyses
 * .vignettes` valait `[]`, et la carte a RAISON de ne pas demander une image
 * dont elle sait qu'elle n'existe pas — sans cela, un 404 par rush et par
 * montage du composant.
 *
 * Le défaut est un cran plus haut : « l'analyse n'a produit aucune image » a
 * été traité comme « ce média n'a pas d'image ». Ce sont deux choses
 * différentes. Le rush est là, mesuré, lisible dans le stockage ; il manquait
 * seulement un chemin pour aller chercher une frame.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * L'ORDRE DES SOURCES, ET POURQUOI IL COMPTE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. la vignette de l'analyse quand elle existe — déjà produite, déjà payée ;
 * 2. sinon l'aperçu du rush, extrait UNE fois côté serveur puis relu ;
 * 3. la pellicule seulement pour ce qu'elle décrit honnêtement : un média
 *    qu'on ne sait vraiment pas illustrer.
 *
 * Inverser 1 et 2 ferait refaire du travail déjà fait, par rush et par écran.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Rush } from '@/lib/autopilot/tournage/contrat';

const BandeRushes = (await import('@/components/creer/BandeRushes')).default;
const {
  cleApercuRush, secondeApercu, FRACTION_APERCU, SECONDE_APERCU_DEFAUT, TYPE_APERCU,
} = await import('@/lib/autopilot/analyse/vignette-rush');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const BANDE = sansProse(lire('src/components/creer/BandeRushes.tsx'));
const MODULE = sansProse(lire('src/lib/autopilot/analyse/vignette-rush.ts'));
const ROUTE = sansProse(lire('src/app/api/autopilot/rushes/[id]/apercu/route.ts'));

const U = 'user-42';
const rush = (id: string, nom: string): Rush => ({
  id,
  shootSessionId: 'session-1',
  userId: U,
  bucket: 'media',
  cleObjet: `${U}/rushes/${nom}`,
  nomOrigine: nom,
  contentType: 'video/mp4',
  tailleOctets: 1_000_000,
  dureeSecondes: 10,
  rang: 0,
  etat: 'pret',
  metadata: {},
  createdAt: '2026-09-09T10:00:00.000Z',
  updatedAt: '2026-09-09T10:00:00.000Z',
} as Rush);

const ALPHA = rush('r-alpha', 'rush-ALPHA.mp4');
const BRAVO = rush('r-bravo', 'rush-BRAVO.mp4');

const rendre = (analyses: Record<string, unknown>) => render(
  <BandeRushes
    rushes={[ALPHA, BRAVO]}
    analyses={analyses as never}
    selection={null}
    onSelectionner={() => {}}
    onVoirAnalyse={() => {}}
    onReanalyser={() => {}}
    onAjouterFichiers={() => {}}
    envois={[]}
  />,
);

const images = (c: HTMLElement) => [...c.querySelectorAll('img')].map((i) => i.getAttribute('src'));

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La carte a toujours une image à demander', () => {
  it('1.1 ⚠️ UNE ANALYSE SANS VIGNETTE N’EST PLUS UNE PELLICULE', () => {
    /* LE DÉFAUT EXACT : `vignettes: 0` produisait `image = null`, donc la
       pellicule, pour un rush parfaitement lisible. */
    const { container } = rendre({
      'r-alpha': { id: 'a-alpha', etat: 'reussie', vignettes: 0 },
      'r-bravo': { id: 'a-bravo', etat: 'reussie', vignettes: 0 },
    });
    expect(images(container)).toEqual([
      '/api/autopilot/rushes/r-alpha/apercu',
      '/api/autopilot/rushes/r-bravo/apercu',
    ]);
  });

  it('1.2 un rush SANS analyse du tout a lui aussi son aperçu', () => {
    // « Pas encore analysé » ne veut pas dire « pas illustrable ».
    const { container } = rendre({ 'r-alpha': null, 'r-bravo': null });
    expect(images(container)).toEqual([
      '/api/autopilot/rushes/r-alpha/apercu',
      '/api/autopilot/rushes/r-bravo/apercu',
    ]);
  });

  it('1.3 ⚠️ LA VIGNETTE D’ANALYSE RESTE PRIORITAIRE', () => {
    /* Elle est déjà produite et déjà écrite : repasser par une extraction
       ferait payer deux fois la même image, par rush et par écran. */
    const { container } = rendre({
      'r-alpha': { id: 'a-alpha', etat: 'reussie', vignettes: 8 },
      'r-bravo': { id: 'a-bravo', etat: 'reussie', vignettes: 8 },
    });
    expect(images(container)).toEqual([
      '/api/autopilot/analyses/a-alpha/vignettes/0',
      '/api/autopilot/analyses/a-bravo/vignettes/0',
    ]);
  });

  it('1.4 un nombre de vignettes inconnu garde le comportement d’avant', () => {
    // `undefined` = la source ne le dit pas : on tente l'analyse, comme avant.
    const { container } = rendre({
      'r-alpha': { id: 'a-alpha', etat: 'reussie' },
      'r-bravo': { id: 'a-bravo', etat: 'reussie' },
    });
    expect(images(container)[0]).toBe('/api/autopilot/analyses/a-alpha/vignettes/0');
  });

  it('1.5 chaque rush demande SON image, jamais celle du voisin', () => {
    const { container } = rendre({ 'r-alpha': null, 'r-bravo': null });
    const src = images(container);
    expect(new Set(src).size).toBe(src.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Pas de tempête réseau', () => {
  it('2.1 ⚠️ UN ÉCHEC N’EST DEMANDÉ QU’UNE FOIS', () => {
    /* `sansImage` est le frein : sans lui, un rush réellement impossible à
       illustrer coûterait une requête à chaque rendu de la bande. */
    expect(BANDE).toContain('sansImage[r.id]');
    expect(BANDE).toContain('setSansImage');
  });

  it('2.2 une seule requête d’image par carte', () => {
    // Une seule `src` calculée, pas une cascade de tentatives dans le DOM.
    const { container } = rendre({ 'r-alpha': null, 'r-bravo': null });
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('2.3 ⚠️ LA MINIATURE N’EST PAS LE LECTEUR', () => {
    // Une image statique ; aucun `<video>` ne se met à charger le rush.
    const { container } = rendre({ 'r-alpha': null, 'r-bravo': null });
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. L’extraction, côté serveur et une seule fois', () => {
  it('3.1 ⚠️ LA CLÉ EST DÉTERMINISTE — C’EST TOUT LE CACHE', () => {
    /* Deux appels calculent la même clé : le second trouve l'objet et ne
       relance pas ffmpeg. Ni table, ni migration, ni mémoire de processus. */
    expect(cleApercuRush(U, 'r-alpha')).toBe(`${U}/rush/r-alpha/apercu.jpg`);
    expect(cleApercuRush(U, 'r-alpha')).toBe(cleApercuRush(U, 'r-alpha'));
  });

  it('3.2 la clé porte le compte, comme partout ailleurs', () => {
    // Le préfixe PROUVE la propriété, il ne la suppose pas.
    expect(cleApercuRush(U, 'r-alpha').startsWith(`${U}/`)).toBe(true);
    expect(cleApercuRush('autre', 'r-alpha')).not.toBe(cleApercuRush(U, 'r-alpha'));
  });

  it('3.3 la route sonde AVANT de produire', () => {
    expect(ROUTE).toContain('await apercuDejaLa(cle)');
    expect(ROUTE).toContain('produireApercuRush');
  });

  it('3.4 ⚠️ PAS LA PREMIÈRE IMAGE — ELLE EST SOUVENT NOIRE', () => {
    /* Un fondu, un clap, une seconde de noir : la carte afficherait un
       rectangle sombre, à peine mieux que la pellicule remplacée. */
    expect(secondeApercu(10)).toBe(10 * FRACTION_APERCU);
    expect(secondeApercu(10)).toBeGreaterThan(0);
    expect(FRACTION_APERCU).toBeGreaterThan(0);
    expect(FRACTION_APERCU).toBeLessThan(1);
  });

  it('3.5 une durée inconnue ou absurde ne produit pas une position invalide', () => {
    for (const d of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(secondeApercu(d as number | null)).toBe(SECONDE_APERCU_DEFAUT);
    }
  });

  it('3.6 la position reste dans la durée du rush', () => {
    expect(secondeApercu(0.4)).toBeLessThanOrEqual(0.4);
  });

  it('3.7 ⚠️ `-ss` AVANT `-i` : UN FRAGMENT, PAS LE RUSH ENTIER', () => {
    /* Après `-i`, ffmpeg décoderait depuis la première image et
       téléchargerait tout le rush pour rendre une seule vignette. */
    const ss = MODULE.indexOf("'-ss'");
    const entree = MODULE.indexOf("'-i', url");
    expect(ss).toBeGreaterThan(-1);
    expect(ss).toBeLessThan(entree);
  });

  it('3.8 une seule image est extraite', () => {
    expect(MODULE).toContain("'-frames:v', '1'");
  });

  it('3.9 aucune génération côté navigateur', () => {
    // Le rush ne descend jamais dans l'onglet pour être peint sur un canvas.
    expect(BANDE).not.toMatch(/canvas|createObjectURL|captureStream/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La route ne laisse rien passer', () => {
  it('4.1 la propriété AVANT le stockage', () => {
    /* Interroger MinIO sur la clé d'un tiers, même pour refuser ensuite,
       ferait de cette route un révélateur d'existence. */
    // L'APPEL, pas l'import : la ligne `import` cite le nom bien avant.
    const proprio = ROUTE.indexOf('lireRush(userId');
    const stockage = ROUTE.indexOf('await apercuDejaLa(cle)');
    expect(proprio).toBeGreaterThan(-1);
    expect(proprio).toBeLessThan(stockage);
  });

  it('4.2 ⚠️ NI COMPARTIMENT NI CLÉ NE VIENNENT DU NAVIGATEUR', () => {
    // Un identifiant, et rien d'autre : il n'y a pas de clé à valider,
    // parce qu'aucune clé ne peut entrer.
    expect(ROUTE).not.toMatch(/searchParams|req\.json\(\)|params\.(bucket|cle)/);
  });

  it('4.3 rush inconnu et rush d’autrui rendent la même réponse', () => {
    // Un 403 sur le rush d'un tiers confirmerait son existence.
    expect(ROUTE).toContain('if (!rush) return introuvable()');
    expect(ROUTE).toContain("status: 404");
  });

  it('4.4 le type est décidé, jamais lu sur l’objet', () => {
    /* Un fichier déposé par un autre chemin ne doit pas pouvoir se faire
       servir en HTML depuis notre origine. */
    expect(TYPE_APERCU).toBe('image/jpeg');
    expect(ROUTE).toContain("'Content-Type': TYPE_APERCU");
    expect(ROUTE).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(ROUTE).toContain("default-src 'none'");
  });

  it('4.5 la réponse n’est pas mise en cache par un intermédiaire', () => {
    // Elle dépend de la session : un cache partagé la servirait à un tiers.
    expect(ROUTE).toContain("'Cache-Control': 'private, no-store, max-age=0'");
  });

  it('4.6 ⚠️ AUCUNE URL SIGNÉE NE FUIT DANS UN MESSAGE', () => {
    // La sortie de ffmpeg porte l'URL signée ; `masquerUrls` la retire, et le
    // détail va au journal serveur, jamais à l'écran.
    expect(MODULE).toContain('masquerUrls(r.stderr)');
    expect(ROUTE).not.toMatch(/presigned|signeur/i);
  });

  it('4.7 l’analyse n’est pas réécrite par l’affichage', () => {
    /* Écrire dans `rush_analyses.vignettes` ferait dire à une analyse qu'elle
       a produit une image qu'elle n'a pas produite, et fausserait le bilan qui
       distingue une panne d'une absence normale. */
    expect(MODULE).not.toMatch(/rush_analyses|from\('rush_analyses'\)/);
    expect(ROUTE).not.toMatch(/rush_analyses/);
  });
});
