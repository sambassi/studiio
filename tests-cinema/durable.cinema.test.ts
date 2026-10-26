/**
 * CINEMA IA — LOT 4 : la production DURABLE, avec Remotion, ffmpeg et la voix
 * REELS et de vrais medias.
 *
 * Les depots de films et de travaux sont en memoire (la base reelle est
 * prouvee par `tests-pg/cinema-ia.pg.test.ts`) ; les OBJETS vivent sur le
 * disque, hors de `public/`, derriere la meme interface que MinIO. Ce banc
 * prouve ce qu'aucun test unitaire ne peut prouver :
 *
 *   - le MP4 sort de l'executeur, depuis des medias PRIVES recuperes dans le
 *     stockage, sans qu'un seul fichier d'un film ne touche `public/` ;
 *   - ce qu'on voit a l'ecran vient bien des medias (couleur mesuree) ;
 *   - relancer ne refait rien ; modifier une scene n'en refait qu'une ;
 *   - un executeur qui meurt en plein rendu : un autre reprend, la scene
 *     terminee n'est pas refaite, le film final est complet et valide.
 *
 *   npm run test:cinema
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { importerMedia, fichierDuMedia, remplacerMedia } from '@/lib/cinema/medias';
import { monterFilm } from '@/lib/cinema/montage';
import { controlerMp4 } from '@/lib/cinema/rendu-local';
import { appliquerPatch } from '@/lib/cinema/patch';
import { cleMedia } from '@/lib/cinema/stockage/cles';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { objetsDossier } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { MOTEURS_REELS, executerTravail, type DependancesExecuteur, type MoteursProduction } from '@/lib/cinema/travaux/executeur';
import { BAIL_S, cleTravail } from '@/lib/cinema/travaux/types';
import { couleurMoyenne, dominante, fixturesMedias } from './fixtures-medias';

const PROJET = path.resolve(__dirname, '..');
const USER = '11111111-1111-4111-8111-111111111111';
const HISTOIRE = [
  'Nina entre dans la salle avant le lever du jour.',
  'Le tatami est encore froid et personne ne parle.',
  'Marco la regarde sans bouger.',
  'Nina sait que le combat a deja commence.',
  'Marco avance et le silence se brise.',
  'Le jour se leve sur la salle vide.',
].join(' ');

/** Bundles Remotion laisses dans le temporaire du systeme (la fuite corrigee au lot « economie »). */
const compterBundlesTmp = async () => (await readdir(tmpdir())).filter((n) => n.startsWith('remotion-webpack-bundle-')).length;

describe('production durable avec medias reels', () => {
  it('produit, montre les medias prives, ne refait rien, ne refait qu\'une scene, reprend apres une mort', async () => {
    const bundlesAvant = await compterBundlesTmp();
    const base = await mkdtemp(path.join(tmpdir(), 'cinema-durable-'));
    const horloge = { t: new Date('2026-10-26T10:00:00Z') };
    try {
      const fixtures = await fixturesMedias();
      const films = depotFilmsMemoire();
      const travaux = depotTravauxMemoire(() => horloge.t);
      const objets = objetsDossier(base);
      const dep: DependancesExecuteur = {
        films, travaux, objets, moteurs: MOTEURS_REELS, racine: PROJET,
        dossierTravail: path.join(base, 'travail'), plafondUsd: 2, maintenant: () => horloge.t,
        // Poste de dev : `os.freemem()` de macOS n'est pas la memoire disponible d'un serveur.
        // Et l'executeur « tue » du scenario d'interruption reste fige DANS CE PROCESSUS, donc son
        // annonce de rendu y resterait : un vrai processus mort emporte son compteur avec lui.
        ressources: { lire: () => ({ rendusEnCours: 0, ramLibreMo: 64_000, cpus: 8 }) },
      };

      const depart = preparerFilm({ titre: 'Avant le jour', histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-banc-durable', format: '16:9', nbScenes: 3 });
      expect(depart.scenes).toHaveLength(3);
      await films.creer(depart, USER);

      // ── Import de vrais medias, comme le fait la route : mesure, puis stockage prive ──
      const importer = async (planId: string, fixture: { nom: string; fichier: string }) => {
        const lu = (await films.lire(depart.id, USER))!.film;
        const tmp = await mkdtemp(path.join(base, 'import-'));
        const r = await importerMedia({ film: lu, planId, nomOrigine: fixture.nom, donnees: await readFile(fixture.fichier), racinePublique: tmp });
        if (!r.ok) throw new Error(r.erreur);
        await objets.deposerFichier(cleMedia(USER, depart.id, r.media.url)!, fichierDuMedia(tmp, r.media.url), 'application/octet-stream');
        await modifierFilm(films, depart.id, USER, (f) => remplacerMedia(f, planId, r.media));
        await rm(tmp, { recursive: true, force: true });
      };
      const planImage = depart.scenes[0].plans[0].id;
      const planVideo = depart.scenes[1].plans[0].id;
      await importer(planImage, fixtures.affiche);
      await importer(planVideo, fixtures.courte);

      const lancer = async (demandees: string[] = []) => {
        const lu = (await films.lire(depart.id, USER))!.film;
        return (await travaux.creerOuRetrouver({ film: lu, proprietaire: USER, cle: cleTravail(lu, demandees), scenesDemandees: demandees, maxActifs: 2 })).travail!;
      };

      // ── 1. Premiere production : tout est a faire ────────────────────────
      const t1 = await lancer();
      expect(await executerTravail(t1.id, USER, dep)).toBe('termine');
      const fin1 = (await travaux.lire(t1.id, USER))!;
      expect(fin1.resultat!.scenesRendues).toHaveLength(3);
      expect(fin1.progression.pourcent).toBe(100);
      expect(fin1.resultat!.coutUsd).toBe(0);
      expect(fin1.resultat!.avertissements.filter((a) => !a.startsWith('voix produites par le moteur'))).toEqual([]);

      // Aucun fichier de film dans public/ : ni media, ni voix, ni MP4.
      await expect(stat(path.join(PROJET, 'public', 'cinema', depart.id))).rejects.toThrow();

      // Le MP4 recupere depuis le stockage est un vrai film.
      const mp4 = path.join(base, 'recupere-1.mp4');
      expect(await objets.telechargerVers(fin1.resultat!.cleMp4!, mp4)).toBe(true);
      const c1 = await controlerMp4(mp4);
      expect(c1.codecVideo).toBe('h264');
      expect(c1.codecAudio).toBeTruthy();                    // les voix sont dans le fichier
      expect([c1.largeur, c1.hauteur]).toEqual([1920, 1080]);
      const filmApres = (await films.lire(depart.id, USER))!.film;
      const montage = monterFilm(filmApres);
      expect(Math.abs((c1.dureeS as number) - montage.dureeS)).toBeLessThan(1.5);

      // Ce qu'on voit vient des medias : couleur mesuree au milieu du plan.
      const milieu = (planId: string) => { const s = montage.segments.find((x) => x.planId === planId)!; return (s.debutS + s.finS) / 2; };
      expect(dominante(await couleurMoyenne(mp4, milieu(planImage)))).toBe('r');     // aube orange
      expect(dominante(await couleurMoyenne(mp4, milieu(planVideo)))).toBe('v');     // tatami vert

      // ── 2. Relance : rien n'est refait ───────────────────────────────────
      const t2 = await lancer();
      expect(await executerTravail(t2.id, USER, dep)).toBe('termine');
      const fin2 = (await travaux.lire(t2.id, USER))!;
      expect(fin2.resultat!.scenesRendues).toEqual([]);
      expect(fin2.resultat!.scenesReutilisees).toHaveLength(3);

      // ── 3. Une scene modifiee : elle seule est refaite ───────────────────
      const cible = depart.scenes[2];
      await modifierFilm(films, depart.id, USER, (f) => appliquerPatch(f, { plans: [{ id: cible.plans[0].id, texte: 'Un plan d\'ensemble tout neuf sur la salle vide' }] }));
      const t3 = await lancer();
      expect(await executerTravail(t3.id, USER, dep)).toBe('termine');
      const fin3 = (await travaux.lire(t3.id, USER))!;
      expect(fin3.resultat!.scenesRendues).toEqual([cible.id]);
      expect(fin3.resultat!.scenesReutilisees).toHaveLength(2);
      const mp43 = path.join(base, 'recupere-3.mp4');
      await objets.telechargerVers(fin3.resultat!.cleMp4!, mp43);
      const c3 = await controlerMp4(mp43);
      expect(c3.codecAudio).toBeTruthy();
      // Les scenes reprises montrent toujours leurs medias dans le film recolle.
      const montage3 = monterFilm((await films.lire(depart.id, USER))!.film);
      const m3 = (planId: string) => { const s = montage3.segments.find((x) => x.planId === planId)!; return (s.debutS + s.finS) / 2; };
      expect(dominante(await couleurMoyenne(mp43, m3(planImage)))).toBe('r');
      expect(dominante(await couleurMoyenne(mp43, m3(planVideo)))).toBe('v');

      // ── 4. Un executeur MEURT en plein rendu ; un autre reprend ──────────
      await modifierFilm(films, depart.id, USER, (f) => ({ ...f, scenes: f.scenes.map((s) => ({ ...s, plans: s.plans.map((p, i) => i ? p : { ...p, description: `${p.description} (v2)` }) })) }));
      let rendus = 0;
      const moteurMortel: MoteursProduction = {
        ...MOTEURS_REELS,
        preparerRendu: async (o) => {
          const rendre = await MOTEURS_REELS.preparerRendu(o);
          return async (t) => {
            rendus += 1;
            if (rendus === 2) await new Promise<void>(() => { /* le processus est mort : jamais de suite */ });
            return rendre(t);
          };
        },
      };
      const t4 = await lancer();
      void executerTravail(t4.id, USER, { ...dep, moteurs: moteurMortel });           // meurt a la 2e scene
      const limite = Date.now() + 600_000;
      while (rendus < 2 && Date.now() < limite) await new Promise((r) => setTimeout(r, 500));
      expect(rendus).toBe(2);                                                          // 1 scene durable, la 2e jamais finie
      expect((await travaux.lire(t4.id, USER))!.statut).toBe('en_cours');

      horloge.t = new Date(horloge.t.getTime() + (BAIL_S + 10) * 1000);                // le bail expire
      expect(await executerTravail(t4.id, USER, dep)).toBe('termine');                 // un autre executeur reprend
      const fin4 = (await travaux.lire(t4.id, USER))!;
      expect(fin4.tentatives).toBe(2);
      expect(fin4.resultat!.scenesReutilisees).toHaveLength(1);                        // la scene rendue avant la mort
      expect(fin4.resultat!.scenesRendues).toHaveLength(2);
      const mp44 = path.join(base, 'recupere-4.mp4');
      await objets.telechargerVers(fin4.resultat!.cleMp4!, mp44);
      const c4 = await controlerMp4(mp44);
      expect(c4.codecAudio).toBeTruthy();
      expect(c4.dureeS).toBeGreaterThan(5);

      // Plusieurs rendus reels (dont un « tue » et repris) : AUCUN bundle ne doit etre reste dans le temporaire.
      const bundlesApres = await compterBundlesTmp();
      console.log('[cinema/durable]', 'bundles Remotion laisses dans tmp :', bundlesApres - bundlesAvant);
      expect(bundlesApres).toBe(bundlesAvant);
      console.log('[cinema/durable]', 'MP4 initial', c1.octets, 'octets', c1.dureeS, 's |', 'apres reprise', c4.octets, 'octets', c4.dureeS, 's');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 1_800_000);
});
