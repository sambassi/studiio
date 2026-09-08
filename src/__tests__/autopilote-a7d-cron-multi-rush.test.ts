/**
 * A_7d3 — L'AUTOPILOTE ASSEMBLE PLUSIEURS RUSHES, ET NE PUBLIE RIEN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX GARANTIES, ET ELLES NE SE RESSEMBLENT PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. CRÉER N'EST PAS PUBLIER. L'automatique produit une vidéo et s'arrête.
 *      Aucun appel vers un réseau social, aucun planificateur de publication.
 *      Cette frontière est la seule qui protège quelqu'un de voir paraître,
 *      sous son nom, une vidéo qu'il n'a jamais regardée.
 *   2. LE MONO-RUSH NE BOUGE PAS. Un compte à un seul rush éligible parcourt
 *      exactement le code d'hier — et tous ses rendus déjà produits restent
 *      trouvables.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CRON = lire('src/app/api/cron/autopilot/route.ts');
const CRON_CODE = sansProse(CRON);
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const CHAINE_CODE = sansProse(CHAINE);
const BANQUE = sansProse(lire('src/lib/autopilot/automatique/rush-banque.ts'));

describe('A_7d3 — le verrou avant tout travail coûteux', () => {
  it('le créneau A_0c est réclamé AVANT le montage', () => {
    /* ⚠️ LE PLACER PLUS BAS LAISSERAIT LE DOUBLON PAYER L'ANALYSE avant de
       découvrir qu'il n'avait pas la main. */
    const claim = CRON_CODE.indexOf('await reclamerCreneau(');
    const choix = CRON_CODE.indexOf('await choisirRushesMontables(');
    const montage = CRON_CODE.indexOf('await monterAvecM3(');
    expect(claim).toBeGreaterThan(-1);
    expect(choix).toBeGreaterThan(claim);
    expect(montage).toBeGreaterThan(claim);
  });

  it('sans verrou, aucun cycle ne produit', () => {
    expect(CRON_CODE).toContain("creneau.issue !== 'reclame'");
    expect(CRON).toContain('ON NE PRODUIT PAS SANS VERROU');
  });
});

describe('A_7d3 — la sélection automatique', () => {
  it('le plafond vient d A_7b, jamais d une seconde constante', () => {
    expect(CRON_CODE).toContain('maxRushesAutomatique(montage.dureeSecondes)');
    expect(CRON_CODE).not.toMatch(/max:\s*\d/);
  });

  it('la graine est canonique — aucun tirage au sort, aucune horloge', () => {
    /* Un cron qui rejoue le même créneau doit redemander EXACTEMENT les mêmes
       rushes, sans quoi `lirePlanIdentique` ne retrouverait rien et chaque
       réessai serait refacturé. */
    expect(CRON_CODE).toContain('graine: `${userId}|${jeton}|');
    expect(BANQUE).not.toContain('Math.random');
    expect(BANQUE).not.toContain('Date.now');
  });

  it('le classement est celui d A_7b, pas une seconde implémentation', () => {
    expect(BANQUE).toContain('classerRushesEligibles');
    /* Deux classements divergeraient, et l'automatique choisirait autrement
       que ce que les tests d'A_7b prouvent. */
    expect(BANQUE).not.toContain('penaliteSourceRecente');
    expect(BANQUE).not.toContain('POIDS_RECENCE_SOURCE');
  });

  it('le rush principal reste choisi par le chemin historique', () => {
    /* Un compte à un seul rush éligible doit continuer de parcourir le chemin
       mono-rush, celui dont tous les rendus sont en base. */
    expect(BANQUE).toContain('const principal = await choisirRushMontable(userId, evites)');
    expect(BANQUE).toContain("if (!principal || options.max <= 1) return { principal, supplementaires: [] }");
  });

  it('les rushes déjà montés dans le cycle sont évités', () => {
    expect(CRON_CODE).toContain('rushesM3Utilises');
  });
});

describe('A_7d3 — la chaîne, et ce qu elle ne change pas', () => {
  it('sans rushes supplémentaires, le chemin mono-rush est intact', () => {
    /* ⚠️ LA BRANCHE MULTI EST GARDÉE PAR UNE LISTE NON VIDE. Vide, aucune
       ligne nouvelle ne s'exécute : ni import, ni planification, ni RPC. */
    expect(CHAINE_CODE).toContain('const autres = (d.rushIdsSupplementaires ?? [])');
    expect(CHAINE_CODE).toContain('if (autres.length > 0) {');
  });

  it('le rush principal ne peut pas se compter deux fois', () => {
    expect(CHAINE_CODE).toContain(".filter((id) => id !== d.rushId)");
  });

  it('une source unique RETOMBE sur le mono, elle n échoue pas', () => {
    /* Lui donner une empreinte le ferait basculer sous l'index multi-rush
       d'A_7M et rendrait introuvables des MP4 déjà produits. */
    expect(CHAINE_CODE).toContain("multi.motif !== 'source_unique'");
  });

  it('une panne de persistance ne se contourne pas en montant un seul rush', () => {
    expect(CHAINE_CODE).toContain("return echec('plan_impossible', multi.motif)");
  });

  it('le plan multi-rush est déjà écrit — aucune seconde écriture', () => {
    expect(CHAINE_CODE).toContain('if (planMulti) {');
    expect(CHAINE_CODE).toContain('planMulti?.id ?? null');
  });

  it('sans plan, aucun rendu — la garde est explicite', () => {
    /* Rendre sous un identifiant nul ferait écrire un post pointant vers rien. */
    expect(CHAINE_CODE).toContain("if (planId === null) return echec('plan_impossible'");
  });

  it('le RENDU n a pas été touché : une seule chaîne M3-H', () => {
    /* Un plan multi-rush est un plan. M3-H sait le rendre depuis A_7c ; lui
       donner un second chemin aurait donné deux façons de rendre. */
    expect((CHAINE_CODE.match(/rendreMontage\(/g) ?? []).length).toBeLessThanOrEqual(1);
    expect((CHAINE_CODE.match(/lireRenduReussiIdentique\(/g) ?? []).length)
      .toBeLessThanOrEqual(2);
  });
});

describe('A_7d3 — créer n est pas publier', () => {
  it('le cron ne touche aucun service de publication', () => {
    /* ⚠️ LA SEULE FRONTIÈRE qui protège quelqu'un de voir paraître, sous son
       nom, une vidéo qu'il n'a jamais regardée. */
    for (const interdit of [
      'publierSur', 'publishToInstagram', 'social/publish',
      '/api/social', 'graph.facebook', 'tiktokapis', 'googleapis.com/youtube',
    ]) {
      expect(CRON, `le cron ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('la chaîne non plus', () => {
    for (const interdit of ['social/publish', '@/lib/social', 'publierPost']) {
      expect(CHAINE, `la chaîne ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('le post créé n est pas marqué publié', () => {
    /* Il entre dans le calendrier pour être RELU. */
    expect(CRON_CODE).toContain('toPostRow(');
    expect(CRON_CODE).not.toMatch(/statut:\s*'publie'/);
    expect(CRON_CODE).not.toMatch(/status:\s*'published'/);
  });

  it('un montage à quatre rushes reste UNE vidéo facturée une fois', () => {
    /* Facturer par source ferait payer quatre fois le même rendu. */
    const orchestre = sansProse(lire('src/lib/autopilot/automatique/multi-rush.ts'));
    expect(orchestre).not.toContain('@/lib/credits');
    expect(orchestre).not.toContain('debiter');
  });
});
