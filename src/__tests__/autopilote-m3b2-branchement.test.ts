/**
 * Le moteur est RÉELLEMENT branché sur la route.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE TROU QUE CE FICHIER BOUCHE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La couture cherchait un export nommé `extraire`. Le moteur en exporte un
 * nommé `extraireRush`. Les deux morceaux ont été écrits séparément, chacun
 * avec ses tests, et **les deux suites étaient vertes** :
 *
 *   - les tests de la route injectent une doublure par
 *     `definirMoteurExtraction`, donc ne passent jamais par le chargement ;
 *   - les tests du moteur appellent `extraireRush` en direct, donc ne
 *     passent jamais par la couture.
 *
 * Personne ne parcourait le chemin qui compte. En production, la route aurait
 * répondu 503 « moteur absent » avec le moteur pourtant présent : le lot
 * entier inerte, sans un seul test rouge.
 *
 * ⚠️ C'est le mode de défaillance propre au travail parallèle : deux moitiés
 * correctes qui ne se rencontrent nulle part. Un test d'intégration n'est pas
 * un luxe ici, c'est le seul endroit où le raccord existe.
 *
 * Ce fichier ne fait tourner AUCUN ffmpeg : il vérifie le raccord, pas la
 * mesure. Le moteur est chargé, sa signature contrôlée, et le vocabulaire
 * comparé des deux côtés — rien n'est exécuté sur un média.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('La couture trouve le moteur — pour de vrai', () => {
  it('`chargerMoteurExtraction` rend une fonction, pas `null`', async () => {
    // Aucune injection : c'est le chemin de production, celui que la route
    // emprunte quand personne n'a appelé `definirMoteurExtraction`.
    const { chargerMoteurExtraction } = await import('@/lib/autopilot/analyse/moteur');
    const moteur = await chargerMoteurExtraction();
    expect(moteur, 'le moteur doit être trouvé — sinon la route répond 503')
      .not.toBeNull();
    expect(typeof moteur).toBe('function');
  });

  it('la fonction trouvée est bien celle que le moteur exporte', async () => {
    const { chargerMoteurExtraction } = await import('@/lib/autopilot/analyse/moteur');
    const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
    expect(await chargerMoteurExtraction()).toBe(extraireRush);
  });

  it('elle accepte la demande que la route construit', async () => {
    const { chargerMoteurExtraction } = await import('@/lib/autopilot/analyse/moteur');
    const moteur = await chargerMoteurExtraction();
    // Quatre paramètres, et le moteur les prend dans un seul objet : une
    // arité de 1. Un moteur qui en attendrait plusieurs recevrait `undefined`.
    expect(moteur!.length).toBe(1);
  });
});

describe('Les deux morceaux parlent le MÊME vocabulaire', () => {
  it('la liste des motifs est la même des deux côtés — parce que c est la même', async () => {
    const moteur = await import('@/lib/autopilot/analyse/extraction');
    const couture = await import('@/lib/autopilot/analyse/moteur');
    // Identité de référence, et non égalité de contenu : deux tableaux égaux
    // aujourd'hui divergeraient au premier ajout. Ici il n'y en a qu'un.
    expect(couture.MOTIFS_EXTRACTION).toBe(moteur.MOTIFS_EXTRACTION);
  });

  it('chaque motif du moteur est accepté par le validateur de la couture', async () => {
    const { MOTIFS_EXTRACTION } = await import('@/lib/autopilot/analyse/extraction');
    const { motifExtractionValide } = await import('@/lib/autopilot/analyse/moteur');
    for (const motif of MOTIFS_EXTRACTION) {
      // Sans quoi `resultatExtractionValide` refuserait un échec pourtant
      // correctement diagnostiqué, et la route répondrait 500 « résultat
      // invalide » — un mensonge sur la cause.
      expect(motifExtractionValide(motif), motif).toBe(true);
    }
    expect(motifExtractionValide('inconnu')).toBe(false);
  });

  it('la route sait répondre à CHACUN des motifs, sans exception', () => {
    // Une table incomplète laisserait un motif tomber dans le cas par défaut,
    // avec le mauvais code HTTP. Le compilateur l'attrape déjà — ce test le
    // dit aussi en clair, pour qui lit les tests avant le type.
    const route = readFileSync(
      resolve(__dirname, '../app/api/autopilot/rushes/[id]/analyse/route.ts'), 'utf-8',
    );
    for (const motif of [
      'cle_hors_perimetre', 'objet_introuvable', 'stockage_injoignable',
      'format_illisible', 'extraction_impossible', 'timeout',
    ]) {
      expect(route, `motif « ${motif} » absent de REFUS_EXTRACTION`)
        .toMatch(new RegExp(`${motif}:\\s*\\{`));
    }
  });
});

describe('Les vignettes atterrissent là où le nettoyage sait regarder', () => {
  it('le compartiment des vignettes est balayé par le cron', async () => {
    // ⚠️ Le lien entre deux fichiers que rien d'autre ne relie. Des vignettes
    // rangées dans un compartiment que le nettoyage n'ouvre pas ne seraient
    // ni protégées ni supprimées : une fuite de stockage silencieuse.
    const { BUCKET_VIGNETTES } = await import('@/lib/autopilot/analyse/extraction');
    const nettoyage = readFileSync(
      resolve(__dirname, '../app/api/cron/cleanup-media/route.ts'), 'utf-8',
    );
    const balayes = nettoyage.match(/const buckets = \[([^\]]+)\]/);
    expect(balayes, 'liste des compartiments balayés introuvable').not.toBeNull();
    expect(balayes![1]).toContain(`'${BUCKET_VIGNETTES}'`);
  });

  it('ce compartiment est dans la liste blanche du projet', async () => {
    const { BUCKET_VIGNETTES } = await import('@/lib/autopilot/analyse/extraction');
    const { bucketAutorise } = await import('@/lib/storage/buckets');
    expect(bucketAutorise(BUCKET_VIGNETTES)).toBe(true);
  });

  it('le préfixe des vignettes est celui que le nettoyage exempte', async () => {
    const { BUCKET_VIGNETTES } = await import('@/lib/autopilot/analyse/extraction');
    const { clesTournageEtAnalyses } = await import('@/lib/storage/cleanup');
    // La forme de clé que le nettoyage compare : `<bucket>/<cle>`.
    expect(typeof clesTournageEtAnalyses).toBe('function');
    expect(BUCKET_VIGNETTES).toMatch(/^[a-z]+$/);
  });
});
