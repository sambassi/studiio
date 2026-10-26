/**
 * CINEMA IA — l'EXECUTEUR d'un travail de production.
 *
 * Il fait, hors requete, ce que la route `produire` faisait en bloquant le
 * navigateur : voix, rendu scene par scene, recollage. Ce qui change, c'est
 * que RIEN n'est garde dans la memoire du processus :
 *
 *   - chaque scene terminee est un OBJET durable, nomme par l'empreinte de ce
 *     qui l'a produite (`…/scenes/<scene>-<empreinte>.mp4`). Reprendre apres
 *     une coupure, ou regenerer une scene, c'est la meme question : « cet
 *     objet existe-t-il pour l'empreinte COURANTE ? ». Oui = reutilise, non =
 *     rendu. Une scene modifiee change d'empreinte, donc de cle : elle est la
 *     SEULE a etre refaite, et l'ancienne n'est jamais servie pour la
 *     nouvelle.
 *   - la progression est ecrite dans la ligne du travail a chaque scene ;
 *   - un BAIL est renouvele pendant le travail (et par un battement de coeur
 *     pendant une longue scene). Si l'executeur meurt, le bail expire et un
 *     autre reprend — au prochain `noter`, l'ancien (s'il vit encore) voit son
 *     jeton refuse et s'arrete.
 *
 * ⚠️ LES MEDIAS PRIVES NE PASSENT JAMAIS PAR `public/`. Ils sont copies dans
 * un dossier de travail du serveur (`var/cinema/travail/<travail>/public`),
 * que Remotion recoit comme `publicDir`. Le dossier est efface a la fin.
 *
 * ⚠️ AUCUN FOURNISSEUR PAYANT, AUCUN DEBIT. Le devis est calcule et confronte
 * au PLAFOND SERVEUR avant le premier octet de travail ; un tarif inconnu est
 * refuse, jamais traite comme nul. Ce module n'importe ni `lib/credits` ni
 * Stripe — un test le verifie sur le code source.
 */
import path from 'path';
import { mkdir, rm } from 'fs/promises';
import type { SceneCinema } from '@/lib/cinema/types';
import { dureeScene } from '@/lib/cinema/types';
import { empreinteScene, hash, scelleScene } from '@/lib/cinema/empreinte';
import { inscrireCout } from '@/lib/cinema/couts';
import { evaluerProduction } from '@/lib/cinema/travaux/plafond';
import { monterFilm, montageDeScene } from '@/lib/cinema/montage';
import { ajusterDureesSurVoix, synthetiserFilm } from '@/lib/cinema/voix';
import { concatener, controlerMp4, dureesDesVoix, preparerRendu, type ControleMp4, type TacheRendu } from '@/lib/cinema/rendu-local';
import { fichierDuMedia, mediasManquants } from '@/lib/cinema/medias';
import { ErreurMediasManquants } from '@/lib/cinema/atelier';
import { cleFilmMp4, cleMedia, cleScene } from '@/lib/cinema/stockage/cles';
import { modifierFilm, type DepotFilms } from '@/lib/cinema/stockage/depot-films';
import type { StockageObjets } from '@/lib/cinema/stockage/objets';
import type { DepotTravaux } from '@/lib/cinema/travaux/depot-travaux';
import {
  BAIL_S, pourcent, type EtatSceneTravail, type ProgressionTravail, type ResultatTravail, type Travail,
} from '@/lib/cinema/travaux/types';

/** Ce qui touche Chromium, ffmpeg et la voix : substituable, car lent et externe. */
export interface MoteursProduction {
  synthetiser: typeof synthetiserFilm;
  mesurerVoix: typeof dureesDesVoix;
  preparerRendu: typeof preparerRendu;
  concatener: typeof concatener;
  controler: typeof controlerMp4;
}

export const MOTEURS_REELS: MoteursProduction = {
  synthetiser: synthetiserFilm,
  mesurerVoix: dureesDesVoix,
  preparerRendu,
  concatener,
  controler: controlerMp4,
};

export interface DependancesExecuteur {
  films: DepotFilms;
  travaux: DepotTravaux;
  objets: StockageObjets;
  moteurs: MoteursProduction;
  /** Racine du projet (`remotion/index.tsx`). */
  racine: string;
  /** Parent des dossiers de travail (`var/cinema/travail`). */
  dossierTravail: string;
  /** Plafond de depense par film, cote serveur, en USD. */
  plafondUsd: number;
  bailS?: number;
  maintenant?: () => Date;
}

/** Le bail a ete repris : cet executeur n'a plus le droit d'ecrire. */
export class BailPerdu extends Error { constructor() { super('bail perdu'); this.name = 'BailPerdu'; } }
/** L'utilisateur a demande l'arret. */
export class ArretDemande extends Error { constructor() { super('arret demande'); this.name = 'ArretDemande'; } }
/** Le devis depasse le plafond, ou son tarif est inconnu. */
export class PlafondDepasse extends Error { constructor(m: string) { super(m); this.name = 'PlafondDepasse'; } }

export type IssueExecution = 'termine' | 'echec' | 'annule' | 'bail_perdu' | 'non_prenable';

function referenceCourte(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Efface UN dossier de travail, jamais autre chose : le chemin est verifie sous la base. */
async function effacerDossier(base: string, dossier: string): Promise<void> {
  const b = path.resolve(base) + path.sep;
  const d = path.resolve(dossier);
  if (!d.startsWith(b) || d === path.resolve(base)) return;
  await rm(d, { recursive: true, force: true }).catch(() => {});
}

export async function executerTravail(travailId: string, proprietaire: string, dep: DependancesExecuteur): Promise<IssueExecution> {
  const bailS = dep.bailS ?? BAIL_S;
  const maintenant = dep.maintenant ?? (() => new Date());

  const pris = await dep.travaux.reclamer(travailId, bailS, maintenant());
  if (!pris || pris.proprietaire !== proprietaire) return 'non_prenable';
  const jeton = pris.tentatives;

  // Un dossier PAR PRISE : un executeur dont le bail a ete repris ne partage
  // ni fichiers ni nettoyage avec celui qui l'a remplace.
  const dossier = path.join(dep.dossierTravail, `${pris.id}-${jeton}`);
  let progression: ProgressionTravail = { ...pris.progression, scenes: { ...pris.progression.scenes } };
  let perdu = false;
  let arret = false;

  /** Publie la progression ; leve si le bail est perdu ou l'arret demande. */
  const publier = async (patch: Partial<Pick<ProgressionTravail, 'etape' | 'message'>> = {}, sceneEtats: Record<string, EtatSceneTravail> = {}) => {
    progression = { ...progression, ...patch, scenes: { ...progression.scenes, ...sceneEtats } };
    progression.pourcent = pourcent(progression);
    const r = await dep.travaux.noter(pris.id, jeton, progression, bailS);
    if (r.perdu) { perdu = true; throw new BailPerdu(); }
    if (r.annulation) { arret = true; throw new ArretDemande(); }
  };

  // Battement de coeur : une scene longue ne doit pas laisser le bail expirer.
  const battement = setInterval(() => {
    dep.travaux.noter(pris.id, jeton, progression, bailS)
      .then((r) => { if (r.perdu) perdu = true; if (r.annulation) arret = true; })
      .catch(() => { /* un battement manque n'est pas une erreur : le suivant, ou la fin, tranchera */ });
  }, Math.max(1000, Math.floor((bailS * 1000) / 3)));
  battement.unref?.();
  const verifier = () => { if (perdu) throw new BailPerdu(); if (arret) throw new ArretDemande(); };

  try {
    // ── Preparation ───────────────────────────────────────────────────────
    const lu = await dep.films.lire(pris.filmId, proprietaire);
    if (!lu) throw new Error('film introuvable');
    const filmInitial = lu.film;
    await publier({ etape: 'preparation', message: 'Preparation' });

    const empreintes = new Map<string, string>(filmInitial.scenes.map((s) => [s.id, empreinteScene(s, filmInitial.personnages)]));
    const cleDeScene = (s: SceneCinema): string => {
      const c = cleScene(proprietaire, filmInitial.id, s.id, empreintes.get(s.id)!);
      if (!c) throw new Error(`cle de scene refusee (${s.id})`);
      return c;
    };

    // Ce qu'il faut refaire, et ce que ca couterait — AVANT tout travail.
    // Pas d'objet pour l'empreinte COURANTE = pas de film, quoi que dise le
    // champ `empreinte` de la scene ; une scene demandee est refaite.
    const evaluation = await evaluerProduction({
      film: filmInitial, proprietaire, objets: dep.objets, demandees: pris.scenesDemandees, plafondUsd: dep.plafondUsd,
    });
    const aProduire = new Set(evaluation.aProduire);
    const reutilisees = evaluation.reutilisees;
    const devis = evaluation.devis;
    for (const id of reutilisees) progression.scenes[id] = 'reutilisee';
    if (!evaluation.verification.autorise) throw new PlafondDepasse(evaluation.verification.motif ?? 'plafond de depenses atteint');

    // ── Medias : copies PRIVEES vers le dossier de travail ───────────────
    const racinePublique = path.join(dossier, 'public');
    await mkdir(racinePublique, { recursive: true });
    await publier({ etape: 'preparation', message: 'Recuperation des medias' });

    const manquants: Array<{ sceneId: string; planId: string; url: string; motif: string }> = [];
    for (const scene of filmInitial.scenes.filter((s) => aProduire.has(s.id))) {
      for (const plan of scene.plans) {
        if (!plan.media) continue;
        const cle = cleMedia(proprietaire, filmInitial.id, plan.media.url);
        if (!cle) { manquants.push({ sceneId: scene.id, planId: plan.id, url: plan.media.url, motif: 'chemin refuse' }); continue; }
        const cible = fichierDuMedia(racinePublique, plan.media.url);
        const ok = await dep.objets.telechargerVers(cle, cible);
        if (!ok) manquants.push({ sceneId: scene.id, planId: plan.id, url: plan.media.url, motif: 'objet introuvable' });
        verifier();
      }
    }
    // Un media declare et absent ARRETE le travail : jamais remplace par une carte.
    const sur = await mediasManquants(
      { scenes: filmInitial.scenes.filter((s) => aProduire.has(s.id)) }, racinePublique,
    );
    for (const m of sur) if (!manquants.some((x) => x.planId === m.planId)) manquants.push(m);
    if (manquants.length) throw new ErreurMediasManquants(manquants);

    // ── Voix ──────────────────────────────────────────────────────────────
    await publier({ etape: 'voix', message: 'Voix des repliques' });
    const avertissements: string[] = [];
    let film = filmInitial;
    let voix: Record<string, string> = {};
    if (aProduire.size) {
      const synth = await dep.moteurs.synthetiser(filmInitial, {
        racinePublique, dossierRelatif: path.posix.join('cinema', filmInitial.id), scenes: [...aProduire],
      });
      voix = synth.voix;
      for (const e of synth.echecs) avertissements.push(`voix absente pour le plan ${e.planId} : ${e.motif}`);
      if (synth.motifRepli) avertissements.push(`voix produites par le moteur « ${synth.moteur} » : ${synth.motifRepli}`);
      // Les durees suivent la parole mesuree — jamais l'inverse.
      film = ajusterDureesSurVoix(filmInitial, await dep.moteurs.mesurerVoix(synth.details));
    }
    verifier();

    // ── Rendu scene par scene ────────────────────────────────────────────
    const montage = monterFilm(film, voix);
    const rendues: string[] = [];
    const fichiers: string[] = [];
    const dossierScenes = path.join(dossier, 'scenes');
    await mkdir(dossierScenes, { recursive: true });
    let rendre: ((t: TacheRendu) => Promise<ControleMp4>) | null = null;

    await publier({ etape: 'rendu', message: aProduire.size ? 'Rendu des scenes' : 'Tout est deja produit' });

    for (const scene of film.scenes) {
      const local = path.join(dossierScenes, `${scene.id}.mp4`);
      fichiers.push(local);
      if (!aProduire.has(scene.id)) continue;       // reutilisee : recuperee a l'assemblage

      verifier();
      const sous = montageDeScene(montage, scene.id);
      if (!sous) { avertissements.push(`scene ${scene.id} sans plan, ignoree`); continue; }
      await publier({ etape: 'rendu', message: `Rendu de la scene « ${scene.titre} »` }, { [scene.id]: 'en_cours' });

      rendre ??= await dep.moteurs.preparerRendu({ racine: dep.racine, publicDir: racinePublique });
      await rendre({ montage: sous, sortie: local });
      // Deposee AVANT d'etre annoncee faite : une scene annoncee est une scene durable.
      await dep.objets.deposerFichier(cleDeScene(scene), local, 'video/mp4');
      rendues.push(scene.id);
      await publier({ etape: 'rendu', message: null }, { [scene.id]: 'faite' });
    }

    // ── Assemblage ────────────────────────────────────────────────────────
    await publier({ etape: 'assemblage', message: 'Assemblage du film' });
    for (const scene of film.scenes) {
      const local = path.join(dossierScenes, `${scene.id}.mp4`);
      if (rendues.includes(scene.id)) continue;
      if (!aProduire.has(scene.id)) {
        const ok = await dep.objets.telechargerVers(cleDeScene(scene), local);
        if (!ok) throw new Error(`scene ${scene.id} annoncee reutilisable mais absente du stockage`);
      } else {
        throw new Error(`scene ${scene.id} sans rendu`);
      }
      verifier();
    }
    const filmLocal = path.join(dossier, 'film.mp4');
    const controle: ControleMp4 = fichiers.length === 1
      ? await (async () => { await dep.moteurs.concatener(fichiers, filmLocal); return dep.moteurs.controler(filmLocal); })()
      : await dep.moteurs.concatener(fichiers, filmLocal);

    const empreinteFilm = hash([film.format, ...film.scenes.map((s) => `${s.id}:${empreintes.get(s.id)}`)].join('|'));
    const cleMp4 = cleFilmMp4(proprietaire, filmInitial.id, empreinteFilm);
    if (!cleMp4) throw new Error('cle de film refusee');
    await dep.objets.deposerFichier(cleMp4, filmLocal, 'video/mp4');
    verifier();

    // ── Scellage : seulement ce qui n'a pas bouge pendant le travail ────
    const produites = new Set(rendues);
    await modifierFilm(dep.films, filmInitial.id, proprietaire, (courant) => ({
      ...courant,
      scenes: courant.scenes.map((s) => {
        const empreinteTravail = empreintes.get(s.id);
        if (!empreinteTravail) return s;
        // Modifiee pendant le travail : elle reste « a reproduire », c'est exact.
        if (empreinteScene(s, courant.personnages) !== empreinteTravail) return s;
        const ajustee = film.scenes.find((x) => x.id === s.id);
        const base = produites.has(s.id) && ajustee ? { ...s, plans: ajustee.plans } : s;
        const scellee = scelleScene(base, courant.personnages);
        return produites.has(s.id) ? inscrireCout(scellee, devis.lignes.find((l) => l.sceneId === s.id)?.usd ?? 0) : scellee;
      }),
    }));

    const resultat: ResultatTravail = {
      cleMp4,
      scenesRendues: rendues,
      scenesReutilisees: reutilisees,
      avertissements,
      dureeS: controle.dureeS ?? dureeScene({ plans: film.scenes.flatMap((s) => s.plans) }),
      octets: controle.octets,
      largeur: controle.largeur,
      hauteur: controle.hauteur,
      codecVideo: controle.codecVideo,
      codecAudio: controle.codecAudio,
      coutUsd: devis.totalUsd ?? 0,
    };
    progression = { ...progression, etape: 'termine', message: null, pourcent: 100 };
    const ok = await dep.travaux.terminer(pris.id, jeton, resultat, progression);
    return ok ? 'termine' : 'bail_perdu';
  } catch (e) {
    if (e instanceof BailPerdu || perdu) return 'bail_perdu';
    if (e instanceof ArretDemande || arret) {
      // Les scenes deja rendues restent durables : un nouveau travail les reprendra.
      await dep.travaux.annuler(pris.id, jeton).catch(() => {});
      return 'annule';
    }
    const reference = referenceCourte();
    // Le detail (stderr de Remotion, chemins du serveur) reste dans le journal ;
    // la ligne du travail ne porte qu'une phrase et un numero.
    console.error(`[cinema/travail] ${reference} —`, e instanceof Error ? (e.stack ?? e.message) : e);
    let message: string;
    if (e instanceof ErreurMediasManquants) message = `media introuvable pour ${e.manquants.length} plan(s) : ${e.manquants.map((m) => m.planId).join(', ')}`;
    else if (e instanceof PlafondDepasse) message = e.message;
    else message = `echec de production (reference ${reference})`;
    // Ecriture refusee (jeton perime) = un autre executeur a repris : ce n'est pas un echec du travail.
    const ecrit = await dep.travaux.echouer(pris.id, jeton, message, reference).catch(() => false);
    return ecrit ? 'echec' : 'bail_perdu';
  } finally {
    clearInterval(battement);
    await effacerDossier(dep.dossierTravail, dossier);
  }
}

export type { Travail };
