/**
 * A_0b — UN RUSH BRUT PEUT ENTRER DANS L'AUTOMATISATION.
 *
 * ---------------------------------------------------------------------------
 * CE QUE A_0 NE FAISAIT PAS ENCORE
 * ---------------------------------------------------------------------------
 *
 * A_0 avait ouvert la porte entre le cron et le moteur M3, mais le rush devait
 * arriver DÉJÀ analysé et DÉJÀ pourvu de candidats. Autrement dit : la
 * production automatique s'arrêtait à ce qu'un humain avait bien voulu
 * préparer à la main. Ce n'était pas encore un Autopilote.
 *
 * La cause était structurelle : l'orchestration de l'analyse (640 lignes) et
 * celle des candidats (200 lignes) vivaient DANS leurs routes HTTP, derrière
 * `auth()`. Seule une session pouvait les déclencher.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : qu'il n'existe qu'UNE
 * implémentation. Une extraction qui laisserait la route sur l'ancien code et
 * le cron sur une copie divergerait au premier correctif — et le bug
 * n'apparaîtrait que d'un côté, ce qui est la pire façon de le découvrir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const ORCH_ANALYSE = lire('src/lib/autopilot/analyse/analyse-orchestration.ts');
const ORCH_CANDIDATS = lire('src/lib/autopilot/analyse/candidat-orchestration.ts');
const ROUTE_ANALYSE = lire('src/app/api/autopilot/rushes/[id]/analyse/route.ts');
const ROUTE_CANDIDATS = lire('src/app/api/autopilot/analyses/[id]/candidats/route.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const BANQUE = lire('src/lib/autopilot/automatique/rush-banque.ts');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Une seule implémentation, pas deux', () => {
  it('1.1 la route d’analyse APPELLE le service, elle ne le refait pas', () => {
    expect(ROUTE_ANALYSE).toContain('executerAnalyseRush');
    // Le corps a bel et bien quitté la route : plus de moteur ici.
    expect(sansProse(ROUTE_ANALYSE)).not.toContain('chargerMoteurExtraction');
    expect(sansProse(ROUTE_ANALYSE)).not.toContain('chargerMoteurVisuel');
  });

  it('1.2 la route des candidats APPELLE le service', () => {
    expect(ROUTE_CANDIDATS).toContain('genererCandidatsPourAnalyse');
    expect(sansProse(ROUTE_CANDIDATS)).not.toContain('chargerMoteurCandidats');
  });

  it('1.3 le cron appelle EXACTEMENT les mêmes fonctions', () => {
    expect(CHAINE).toContain('executerAnalyseRush');
    expect(CHAINE).toContain('genererCandidatsPourAnalyse');
  });

  it('1.4 le moteur d’analyse n’est appelé que d’un seul endroit', () => {
    const partout = [ORCH_ANALYSE, ROUTE_ANALYSE, CHAINE].map(sansProse).join('\n');
    expect((partout.match(/chargerMoteurExtraction\(/g) ?? []).length).toBe(1);
  });

  it('1.5 le moteur de candidats non plus', () => {
    const partout = [ORCH_CANDIDATS, ROUTE_CANDIDATS, CHAINE].map(sansProse).join('\n');
    expect((partout.match(/chargerMoteurCandidats\(/g) ?? []).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les services sont appelables sans session', () => {
  it('2.1 aucune dépendance HTTP dans les deux modules extraits', () => {
    /* ⚠️ LA PROPRIÉTÉ QUI REND TOUT LE LOT POSSIBLE. Une seule arête vers
       `auth()` ou `next/headers` referait silencieusement la prison dont ce
       lot sort — et le cron recommencerait à ignorer les rushes bruts. */
    for (const [nom, src] of [['analyse', ORCH_ANALYSE], ['candidats', ORCH_CANDIDATS]] as const) {
      for (const interdit of ['next/server', 'next/headers', '@/lib/auth', 'auth()',
        'cookies(', 'NextRequest', 'NextResponse']) {
        expect(sansProse(src), `${nom} : ${interdit}`).not.toContain(interdit);
      }
    }
  });

  it('2.2 les deux services prennent `userId` en premier paramètre', () => {
    expect(ORCH_ANALYSE).toContain('executerAnalyseRush(\n  userId: string');
    expect(ORCH_CANDIDATS).toContain('genererCandidatsPourAnalyse(\n  userId: string');
  });

  it('2.3 les routes, elles, résolvent toujours l’utilisateur connecté', () => {
    // ⚠️ AUCUN CONTOURNEMENT D'AUTH : la route continue de faire `auth()`,
    // et transmet le `userId` obtenu. Seul le cron, déjà autorisé par son
    // secret, appelle le service directement.
    expect(ROUTE_ANALYSE).toContain('auth()');
    expect(ROUTE_CANDIDATS).toContain('auth()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le déménagement n’a rien réécrit', () => {
  it('3.1 les statuts HTTP ont suivi, à l’identique', () => {
    // 23 sorties dans l'analyse, 14 dans les candidats : elles portent le
    // sens (409 déjà en cours, 429 pas de place, 503 socle absent, 201 fait).
    expect((ORCH_ANALYSE.match(/return reponse\(/g) ?? []).length).toBe(23);
    expect((ORCH_CANDIDATS.match(/return reponse\(/g) ?? []).length).toBe(14);
  });

  it('3.2 l’en-tête `Retry-After` a survécu à l’extraction', () => {
    // Un 429 sans consigne de relance ne dit pas quand revenir.
    expect(ORCH_ANALYSE).toContain("'Retry-After'");
  });

  it('3.3 la route rhabille le résultat sans le retoucher', () => {
    expect(ROUTE_ANALYSE).toContain('NextResponse.json(r.corps');
    expect(ROUTE_CANDIDATS).toContain('NextResponse.json(r.corps, { status: r.statut })');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Un rush brut entre dans l’automatisation', () => {
  it('4.1 la banque rend aussi un rush sans analyse', () => {
    expect(BANQUE).toContain('analysisId: string | null');
    expect(BANQUE).toContain('bruts.push');
  });

  it('4.2 mais un rush DÉJÀ prêt passe devant', () => {
    /* ⚠️ SANS CET ORDRE, un compte disposant de dix rushes analysés paierait
       quand même un fournisseur à chaque cycle. */
    const pret = BANQUE.indexOf('return {\n      rushId: rush.id,');
    const brut = BANQUE.indexOf('return bruts[0]');
    expect(pret).toBeGreaterThan(-1);
    expect(brut).toBeGreaterThan(pret);
  });

  it('4.3 la chaîne prépare avant de monter', () => {
    /* ⚠️ L'ORDRE DES APPELS DANS `monterAvecM3`, PAS LEUR POSITION DANS LE
       FICHIER. La première rédaction comparait deux `indexOf` sur tout le
       module : elle a cassé quand A_7d a EXTRAIT la découpe des clips dans
       `preparerJeuClips` — une fonction déclarée plus haut, appelée au même
       endroit, pour le même résultat. Le test mesurait la mise en page, pas
       l'invariant. Celui-ci est : dans le corps de `monterAvecM3`, la
       préparation vient avant la matière. */
    const corps = CHAINE.slice(CHAINE.indexOf('export async function monterAvecM3('));
    const prep = corps.indexOf('await preparerRush(');
    const clips = corps.indexOf('await preparerJeuClips(');
    expect(prep).toBeGreaterThan(-1);
    expect(clips).toBeGreaterThan(prep);
    /* Et `preparerJeuClips` est bien ce qui matérialise : sans cette ligne,
       renommer la fonction sans rien appeler passerait. */
    expect(CHAINE.slice(CHAINE.indexOf('export async function preparerJeuClips(')))
      .toContain('materialiserSet({');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Aucun fournisseur n’est rappelé pour rien', () => {
  it('5.1 l’analyse commence par une lecture', () => {
    const bloc = CHAINE.slice(CHAINE.indexOf('async function preparerRush('));
    const lecture = bloc.indexOf('lireDerniereAnalyse(userId, rushId)');
    const appel = bloc.indexOf('executerAnalyseRush(userId, rushId, rush)');
    expect(lecture).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(lecture);
  });

  it('5.2 les candidats aussi', () => {
    const bloc = CHAINE.slice(CHAINE.indexOf('async function preparerRush('));
    const lecture = bloc.indexOf('lireDerniereGeneration(userId, idAnalyse)');
    const appel = bloc.indexOf('genererCandidatsPourAnalyse(userId, idAnalyse)');
    expect(lecture).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(lecture);
  });

  it('5.3 une analyse RÉUSSIE est réutilisée telle quelle', () => {
    expect(CHAINE).toContain("if (analyse?.etat === 'reussie') {");
  });

  it('5.4 un jeu de candidats RÉUSSI est réutilisé tel quel', () => {
    expect(CHAINE).toContain("if (generation?.etat === 'reussie') {");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Rien n’est doublé quand un travail est en vol', () => {
  it('6.1 une analyse active n’en déclenche pas une seconde', () => {
    /* La base l'interdirait de toute façon (`rush_analyses_active_unique`,
       qui rend 409) — mais s'y heurter ferait remonter un ÉCHEC là où il n'y
       a qu'une attente. */
    expect(CHAINE).toContain('analyseActive(analyse.etat)');
    expect(CHAINE).toContain("motif: 'analyse_en_cours'");
  });

  it('6.2 une génération active non plus', () => {
    expect(CHAINE).toContain("generation.etat === 'en_attente' || generation.etat === 'en_cours'");
    expect(CHAINE).toContain("motif: 'candidats_en_cours'");
  });

  it('6.3 un 409 ou un 429 devient « ignoré », jamais « échoué »', () => {
    expect((CHAINE.match(/r\.statut === 409 \|\| r\.statut === 429/g) ?? []).length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Un échec arrête la chaîne, proprement', () => {
  it('7.1 une analyse échouée ne mène pas aux candidats', () => {
    const bloc = CHAINE.slice(CHAINE.indexOf('async function preparerRush('));
    const echec = bloc.indexOf("motif: 'analyse_echouee'");
    const candidats = bloc.indexOf('let idCandidats');
    expect(echec).toBeGreaterThan(-1);
    expect(candidats).toBeGreaterThan(echec);
    // ⚠️ C'EST UN `return`, PAS UN DRAPEAU. La sortie est immédiate : rien ne
    // continue derrière, et aucune variable ne peut être oubliée en chemin.
    expect(bloc.slice(echec - 200, echec)).toMatch(/return\s/);
  });

  it('7.2 des candidats échoués ne mènent pas au montage', () => {
    expect(CHAINE).toContain("motif: 'candidats_echoues'");
    const bloc = CHAINE.slice(CHAINE.indexOf('async function preparerRush('));
    const i = bloc.indexOf("motif: 'candidats_echoues'");
    expect(bloc.slice(i - 200, i)).toMatch(/return\s/);
  });

  it('7.3 et la chaîne s’arrête dès que la préparation refuse', () => {
    expect(CHAINE).toContain("if ('sorte' in pret) return pret;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Le moteur éditorial n’a pas bougé', () => {
  it('8.1 Sonnet, les signaux et le contrat restent où ils étaient', () => {
    // L'extraction est un déménagement d'ORCHESTRATION. Aucun algorithme,
    // aucun prompt, aucun modèle n'entre ni ne sort de ces modules.
    for (const interdit of ['claude-', 'anthropic', 'prompt', 'temperature']) {
      expect(sansProse(ORCH_CANDIDATS).toLowerCase(), interdit)
        .not.toContain(interdit.toLowerCase());
    }
    expect(ORCH_CANDIDATS).toContain('chargerMoteurCandidats');
  });

  it('8.2 les correctifs qualité tiennent toujours', () => {
    expect(lire('src/lib/autopilot/analyse/coupe-contrat.ts')).toContain("'m3e-v4'");
    expect(lire('src/lib/autopilot/analyse/rendu.ts'))
      .toContain('couperSilenceInitialMusique');
  });

  it('8.3 le mode review et l’absence de publication tiennent', () => {
    /* ⚠️ LE STATUT N'EST PAS ÉCRIT DANS LE CRON, et c'est mieux ainsi : il
       vient de `toPostRow`, qui appelle `statusForMode`. La branche M3 passe
       par la MÊME fonction que la branche gabarit — donc `review` → `draft`,
       et rien ne peut se publier par une branche oubliée. */
    const cron = lire('src/app/api/cron/autopilot/route.ts');
    expect(cron).toContain('toPostRow(');
    expect(lire('src/lib/autopilot/engine.ts')).toContain('statusForMode');
    expect(sansProse(CHAINE)).not.toContain('/api/social/publish');
  });
});
