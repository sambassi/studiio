/**
 * LOT PC-4 — LE MANUEL ET L'AUTONOME NE SE MELANGENT PLUS.
 *
 * ---------------------------------------------------------------------------
 * LE DEFAUT QU'ON FERME
 * ---------------------------------------------------------------------------
 *
 * Deux blocs vivaient au milieu du parcours de creation manuelle — la banque
 * de rushes et « Vos affiches » — alors qu'ils ne servent QU'A l'Autopilote
 * autonome. Preuve statique : `lib/autopilot/poster.ts` n'a qu'un appelant
 * applicatif, `/api/cron/autopilot`. « Creer ma video » ne l'appelle jamais.
 *
 * Poses entre l'objectif et le bouton, ils se lisaient pourtant comme deux
 * etapes obligatoires. L'utilisateur qui veut juste faire une video les
 * traversait sans savoir qu'ils ne le concernaient pas.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ DEMENAGES, PAS SUPPRIMES
 * ---------------------------------------------------------------------------
 *
 * Memes composants, meme `config`, meme format. Le cron doit continuer a les
 * lire exactement comme avant : ces tests le verifient sur le code du cron,
 * pas sur une intention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

const PANNEAU = lire('src/components/creer/AutopilotPanel.tsx');

/** Le corps du panneau, une fois retire tout ce qui vit dans le tiroir. */
function corpsSansTiroir(source: string): string {
  const debut = source.indexOf('avance={(');
  expect(debut).toBeGreaterThan(-1);
  // Le tiroir se termine au `montageDefaut=` qui suit la prop `avance`.
  const fin = source.indexOf('montageDefaut=', debut);
  expect(fin).toBeGreaterThan(debut);
  return source.slice(0, debut) + source.slice(fin);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le parcours manuel ne porte plus les réglages autonomes', () => {
  it('1.1 « Vos affiches » a quitté le corps du panneau', () => {
    const corps = corpsSansTiroir(PANNEAU);
    // ⚠️ LES COMMANDES, PAS TOUTE MENTION. `config.posterMode` reste lu au
    // recapitulatif de l'etape 6, qui resume la configuration de l'Autopilote
    // AUTONOME — c'est sa place, et l'y interdire aurait fait echouer un test
    // pour une lecture parfaitement legitime. Ce qui devait quitter le
    // parcours, ce sont les CONTROLES : les tuiles et les ecritures.
    expect(corps).not.toContain('data-autopilot-poster-mode');
    expect(corps).not.toContain('enregistrer({ posterMode');
    expect(corps).not.toContain('posterUrls: [...config.posterUrls');
  });

  it('1.2 la banque de rushes a quitté le corps du panneau', () => {
    const corps = corpsSansTiroir(PANNEAU);
    expect(corps).not.toContain("setLibOpen('rush')");
  });

  it('1.3 et les deux sont bel et bien DANS le tiroir', () => {
    const debut = PANNEAU.indexOf('avance={(');
    const fin = PANNEAU.indexOf('montageDefaut=', debut);
    const tiroir = PANNEAU.slice(debut, fin);
    expect(tiroir).toContain('data-autonome-rushes');
    expect(tiroir).toContain('data-autonome-affiches');
    expect(tiroir).toContain('data-autopilot-poster-mode');
    expect(tiroir).toContain("setLibOpen('rush')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le tiroir dit à quoi il sert', () => {
  it('2.1 un titre nomme l’Autopilote autonome', () => {
    expect(PANNEAU).toContain('data-autonome-titre');
    expect(PANNEAU).toContain('Autopilote autonome');
  });

  it('2.2 et une phrase courte lève l’ambiguïté', () => {
    // ⚠️ PAS DE FAUSSE PROMESSE. Sans cette phrase, on croit que l'affiche
    // choisie ici sera collee sur la video qu'on est en train de faire.
    expect(PANNEAU).toContain('créations automatiques');
    expect(PANNEAU).toMatch(/ne s’en sert pas|ne s'en sert pas/);
  });

  it('2.3 le tiroir reste replié : il s’ouvre sur un geste', () => {
    // `SessionsTournagePanel` ne monte le contenu du tiroir que sur clic ;
    // le bouton existe, l'etat par defaut est ferme.
    const sessions = lire('src/components/creer/SessionsTournagePanel.tsx');
    expect(sessions).toContain("useState<'analyse' | 'avance' | null>(null)");
    expect(sessions).toContain('data-ouvrir-avance');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Rien n’est perdu pour l’Autopilote autonome', () => {
  it('3.1 le cron lit toujours la banque de rushes et les affiches', () => {
    const cron = lire('src/app/api/cron/autopilot/route.ts');
    expect(cron).toContain('rushUrls');
    expect(cron).toContain('posterUrls');
  });

  it('3.2 `poster.ts` n’a toujours qu’un appelant applicatif : le cron', () => {
    // ⚠️ C'EST LA PREUVE QUE CES REGLAGES NE SERVENT PAS AU MANUEL. Si un
    // jour la chaine manuelle s'en servait, ce test tomberait — et il faudrait
    // les ramener dans le parcours.
    const cron = lire('src/app/api/cron/autopilot/route.ts');
    expect(cron).toMatch(/autopilot\/poster|from '@\/lib\/autopilot\/poster'/);
    const chaine = lire('src/lib/autopilot/analyse/chaine-passerelle.ts');
    expect(chaine).not.toContain('poster');
  });

  it('3.3 le format de `config` n’a pas bougé', () => {
    const regles = lire('src/lib/autopilot/rules.ts');
    expect(regles).toContain('posterUrls');
    expect(regles).toContain('rushUrls');
    expect(regles).toContain('posterMode');
  });

  it('3.4 aucune écriture n’a été retirée du panneau', () => {
    // Les deux blocs enregistrent toujours par la meme porte.
    expect(PANNEAU).toContain('enregistrer({ posterMode: m })');
    expect(PANNEAU).toContain('posterUrls: [...config.posterUrls, url]');
    expect(PANNEAU).toContain('rushUrls: [...config.rushUrls, url]');
  });
});
