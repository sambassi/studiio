/**
 * CINEMA IA — un film SANS RÉPLIQUE ENTRE GUILLEMETS touche quand même le service de voix.
 *
 * Vérification demandée après le premier test réel (Edge TTS inaccessible, MP4 non
 * obtenu) : « un film sans dialogue peut-il s'exporter sans service vocal ? » L'hypothèse
 * initiale (aucune réplique citée ⇒ aucun appel TTS) est FAUSSE — vérifiée ici en
 * EXÉCUTANT réellement le scénario local, pas en le supposant.
 *
 * `scenario.ts` (`decouperHistoire`) pose un `dialogue` sur CHAQUE plan généré à partir
 * d'une phrase, qu'elle soit citée (`genre: 'replique'`) ou non (`genre: 'narration'`,
 * `texte` = la phrase elle-même). Seul le tout premier plan d'ensemble de chaque scène a
 * `dialogue: null`. Autrement dit : au-delà d'une simple ambiance filmée sans texte, TOUT
 * film généré par Cinema IA a des plans à voix — « sans dialogue » (sans guillemets) ne
 * veut pas dire « sans voix », parce que la narration EST elle aussi synthétisée.
 *
 * Conséquence directe, vérifiée côté exécuteur (`travaux/executeur.ts:265-267`) : UN SEUL
 * échec de voix (narration ou réplique) bloque la production ENTIÈRE (`VoixIndisponible`).
 * Si Edge TTS est injoignable depuis le serveur, quasi aucun film réel ne peut produire de
 * MP4 aujourd'hui — pas seulement ceux avec des répliques citées.
 */
import { describe, it, expect } from 'vitest';
import { preparerFilm } from '@/lib/cinema/atelier';

// Aucune phrase entre guillemets.
const HISTOIRE_SANS_REPLIQUE_CITEE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Le jour se leve sur la salle vide.',
].join(' ');

describe('« sans dialogue » (sans guillemets) ne veut pas dire « sans voix »', () => {
  const film = () => preparerFilm({
    titre: 'Avant le jour (sans replique citee)', histoire: HISTOIRE_SANS_REPLIQUE_CITEE,
    personnages: [{ nom: 'Nina', role: 'protagoniste', description: 'veste rouge' }],
    idFilm: 'film-sans-replique-citee-test', format: '16:9', qualite: 'standard', nbScenes: 3,
  });

  it('une phrase SANS guillemets devient quand même un plan « narration » à voix, jamais un plan silencieux', () => {
    const plans = film().scenes.flatMap((s) => s.plans);
    const narres = plans.filter((p) => p.dialogue?.genre === 'narration');
    expect(narres.length).toBeGreaterThan(0);
    for (const p of narres) {
      expect(p.dialogue!.texte.trim().length).toBeGreaterThan(0);
      expect(p.dialogue!.personnageId).toBeNull(); // le narrateur, jamais un personnage
    }
  });

  it('seul le plan d’ensemble d’ouverture de chaque scène reste silencieux — tout le reste exige une voix', () => {
    const f = film();
    for (const scene of f.scenes) {
      const [ouverture, ...suite] = scene.plans;
      expect(ouverture.dialogue).toBeNull();
      expect(suite.length).toBeGreaterThan(0);
      for (const p of suite) expect(p.dialogue?.texte?.trim()).toBeTruthy();
    }
  });
});

/**
 * RÉGRESSION — « Edge TTS inaccessible » bloquait toute la chaîne : `setMetadata()` ouvre
 * le WebSocket et peut ne JAMAIS répondre depuis une adresse serveur (constaté le 2026-10-26,
 * même cause documentée et déjà corrigée côté Autopilote — `lib/autopilot/voice.ts`,
 * `TTS_TIMEOUT_MS`). Les délais existants (`DELAI_FLUX_MS`) ne protégeaient que les
 * évènements du FLUX, posés APRÈS `setMetadata()` — donc jamais armés si c'est elle qui pend.
 *
 * ⚠️ PREUVE STATIQUE. Un test dynamique devrait simuler un `setMetadata` qui ne résout
 * jamais, avec des horloges simulées traversant une vraie `Promise.race` : fragile, pour la
 * même raison documentée dans `cinema-generation-reelle.test.ts`.
 */
describe('la connexion Edge TTS ne peut plus pendre indéfiniment', () => {
  it('`setMetadata` est enveloppé dans un délai dur, avant tout évènement de flux', async () => {
    const fs = await import('fs');
    const code = fs.readFileSync('src/lib/cinema/voix.ts', 'utf-8');
    const bloc = code.slice(code.indexOf('export async function synthetiser('), code.indexOf('export async function synthetiserSysteme'));
    expect(bloc).toMatch(/Promise\.race\(\[\s*tts\.setMetadata\(/);
    expect(bloc).toContain('DELAI_CONNEXION_MS');
    expect(bloc).toContain('connexion jamais etablie');
  });
});
