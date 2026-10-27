/**
 * CINEMA IA — l'APERCU : voix + durees alignees, sans Chromium ni minutes.
 *
 * C'est `rendre: false` de l'ancienne route `produire`. Il ne coute que la
 * synthese des repliques (gratuite) : les voix deja produites sont reprises
 * du stockage, nommees par ce qu'elles disent — modifier une replique change
 * sa cle, donc la voix n'est JAMAIS une ancienne.
 */
import path from 'path';
import { mkdir } from 'fs/promises';
import type { Film } from '@/lib/cinema/types';
import { empreinteScene, hash } from '@/lib/cinema/empreinte';
import { devisFilm, type DevisFilm } from '@/lib/cinema/couts';
import { monterFilm, type MontageFilm } from '@/lib/cinema/montage';
import { ajusterDureesSurVoix, synthetiserFilm, voixDuPlan, type MoteurVoix } from '@/lib/cinema/voix';
import { dureesDesVoix } from '@/lib/cinema/rendu-local';
import { cleMedia, cleScene, cleVoix } from '@/lib/cinema/stockage/cles';
import type { StockageObjets } from '@/lib/cinema/stockage/objets';

export interface ApercuFilm {
  film: Film;
  montage: MontageFilm;
  devis: DevisFilm;
  scenesAProduire: string[];
  /** planId → empreinte de la voix : de quoi fabriquer l'URL de lecture. */
  voix: Map<string, string>;
  moteur: MoteurVoix;
  voixProduites: number;
  avertissements: string[];
}

export const empreinteVoix = (film: Film, planId: string): string | null => {
  const plan = film.scenes.flatMap((s) => s.plans).find((p) => p.id === planId);
  const texte = plan?.dialogue?.texte?.trim();
  if (!plan || !texte) return null;
  return hash(`${texte}\n${voixDuPlan(film, plan.dialogue?.personnageId ?? null)}`);
};

export async function preparerApercu(args: {
  film: Film; proprietaire: string; objets: StockageObjets; racinePublique: string; moteurVoix?: MoteurVoix;
  mesurer?: typeof dureesDesVoix; synthetiser?: typeof synthetiserFilm;
}): Promise<ApercuFilm> {
  const { film, proprietaire, objets, racinePublique } = args;
  const avertissements: string[] = [];
  const dossierVoix = path.join(racinePublique, 'cinema', film.id);
  await mkdir(dossierVoix, { recursive: true });

  // Ce qu'il faut produire : pas d'objet de scene pour l'empreinte COURANTE.
  const aProduire: string[] = [];
  for (const s of film.scenes) {
    const cle = cleScene(proprietaire, film.id, s.id, empreinteScene(s, film.personnages));
    if (!cle || !(await objets.existe(cle))) aProduire.push(s.id);
  }

  // Les medias declares et absents sont SIGNALES (jamais remplaces en
  // silence). On interroge le stockage, on ne telecharge rien : un apercu ne
  // lit pas les rushes.
  for (const scene of film.scenes) for (const plan of scene.plans) {
    if (!plan.media) continue;
    const cle = cleMedia(proprietaire, film.id, plan.media.url);
    if (!cle) avertissements.push(`media introuvable (plan ${plan.id}) : ${plan.media.url} — chemin refuse`);
    else if (!(await objets.existe(cle))) avertissements.push(`media introuvable (plan ${plan.id}) : ${plan.media.url} — objet introuvable`);
  }

  // Reprendre les voix deja stockees, synthetiser les autres, deposer les neuves.
  const voix = new Map<string, string>();
  const attendues: Array<{ planId: string; cle: string; empreinte: string }> = [];
  for (const plan of film.scenes.flatMap((s) => s.plans)) {
    const e = empreinteVoix(film, plan.id);
    if (!e) continue;
    const cle = cleVoix(proprietaire, film.id, plan.id, e);
    if (cle) attendues.push({ planId: plan.id, cle, empreinte: e });
  }
  const dejaLa = new Set<string>();
  for (const a of attendues) {
    if (await objets.telechargerVers(a.cle, path.join(dossierVoix, `${a.planId}.mp3`))) dejaLa.add(a.planId);
  }

  const synth = await (args.synthetiser ?? synthetiserFilm)(film, {
    racinePublique, dossierRelatif: path.posix.join('cinema', film.id), moteur: args.moteurVoix,
  });
  for (const e of synth.echecs) avertissements.push(`voix absente pour le plan ${e.planId} : ${e.motif}`);
  if (synth.motifRepli) avertissements.push(`voix produites par le moteur « ${synth.moteur} » : ${synth.motifRepli}`);

  for (const d of synth.details) {
    const a = attendues.find((x) => x.planId === d.planId);
    if (!a) continue;
    if (!dejaLa.has(d.planId)) await objets.deposerFichier(a.cle, d.fichier, 'audio/mpeg');
    voix.set(d.planId, a.empreinte);
  }

  const ajuste = ajusterDureesSurVoix(film, await (args.mesurer ?? dureesDesVoix)(synth.details));
  return {
    film: ajuste,
    montage: monterFilm(ajuste, synth.voix),
    devis: devisFilm(film, aProduire),
    scenesAProduire: aProduire,
    voix,
    moteur: synth.moteur,
    voixProduites: synth.details.length - dejaLa.size,
    avertissements,
  };
}
