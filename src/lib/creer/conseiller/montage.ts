/**
 * CONSEILLER MONTAGE — rushes, répétitions, rythme. Module PUR.
 *
 * Ne lit que ce que l'analyse a réellement mesuré : saturation (couleur /
 * noir et blanc), luminosité, mouvement, empreinte 8×8 (ressemblance de deux
 * images), temps de la musique. Il ne reconnaît NI visages NI valeurs de plan
 * (large / serré) : ces avertissements-là ne sont pas émis.
 */
import type { RushSegment } from '@/lib/creer/multi-rush';
import { cleSource, REGLES_PROFILS, type AnalyseRush, type EchantillonRush } from '@/lib/creer/smart-montage';
import {
  ecartEmpreinte, ECHELLE_DIFFERENCE, SEUIL_NOIR_BLANC, ECART_AMBIANCE, MEME_SCENE,
} from '@/lib/creer/smart-montage-regles';
import type { Conseil } from '@/lib/creer/conseiller/types';

/**
 * Seuils du conseiller. Ceux qui sont aussi des RÈGLES DE MONTAGE viennent
 * du module partagé (`smart-montage-regles.ts`, `REGLES_PROFILS`) : le
 * conseiller juge le plan avec les mêmes règles que le moteur qui l'a fait.
 */
export const REGLES_MONTAGE = {
  saturationNoirBlanc: SEUIL_NOIR_BLANC,
  ecartAmbiance: ECART_AMBIANCE,
  /** Écart d'empreinte sous lequel deux extraits montrent quasiment la même image. */
  quasiIdentique: 0.08,
  memeSceneEcartS: MEME_SCENE.ecartS,
  memeSceneEmpreinte: MEME_SCENE.empreinte,
  /** Part de la durée venant d'un seul rush au-delà de laquelle on le signale. */
  partDominante: 0.6,
  echelleDifference: ECHELLE_DIFFERENCE,
  /** Mouvement d'un extrait sous cette part de la médiane du montage : plan statique. */
  statiqueRelatif: 0.35,
  /** Distance (s) entre une coupe et un temps de la musique pour la dire « sur le temps ». */
  toleranceBeat: 0.08,
  /** CARDIO_DANCE : premiers plans de l'accroche (s) — la règle du moteur. */
  accrocheMax: REGLES_PROFILS.CARDIO_DANCE.phases.HOOK[1],
} as const;

const PROFILS_DYNAMIQUES = new Set(['CARDIO_DANCE', 'EVENT_IMMERSIVE']);
const r2 = (n: number) => Math.round(n * 100) / 100;
const virgule = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
const moyenne = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
const mediane = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Nom lisible d'un rush (fichier sans horodatage ni extension). */
export function nomRush(url: string): string {
  const f = decodeURIComponent(cleSource(url).split('/').pop() ?? url);
  return f.replace(/^\d{10,}-/, '').replace(/\.[a-z0-9]+$/i, '');
}

function echantillonsDe(a: AnalyseRush, s: number, e: number): EchantillonRush[] {
  const dedans = a.echantillons.filter((x) => x.t >= s && x.t < e);
  if (dedans.length) return dedans;
  const m = (s + e) / 2;
  return [a.echantillons.reduce((p, x) => (Math.abs(x.t - m) < Math.abs(p.t - m) ? x : p), a.echantillons[0])];
}

export interface MesureExtrait {
  index: number;
  rush: string;
  saturation: number | null;
  luminosite: number;
  mouvement: number;
  empreinte: number[] | null;
}

/** Mesures de chaque extrait du plan, relues dans l'analyse de son rush. */
export function mesurerExtraits(plan: ReadonlyArray<RushSegment>, analyses: ReadonlyArray<AnalyseRush>): MesureExtrait[] | null {
  const parCle = new Map(analyses.map((a) => [cleSource(a.url), a]));
  const out: MesureExtrait[] = [];
  for (const [index, seg] of plan.entries()) {
    const a = parCle.get(cleSource(seg.url));
    if (!a || !a.echantillons.length) return null;
    const s = seg.depuis ?? 0;
    const e = seg.jusqua ?? s + (seg.fin - seg.debut);
    const ech = echantillonsDe(a, s, e);
    const sats = ech.map((x) => x.saturation).filter((x): x is number => typeof x === 'number');
    out.push({
      index,
      rush: seg.url,
      saturation: sats.length === ech.length ? moyenne(sats) : null,
      luminosite: moyenne(ech.map((x) => x.luminosite)),
      mouvement: moyenne(ech.map((x) => x.mouvement)),
      empreinte: ech[Math.floor(ech.length / 2)]?.empreinte ?? null,
    });
  }
  return out;
}

/** 0..1 : écart moyen de chaque extrait avec celui qui lui ressemble le plus. */
export function scoreDifferenceVisuelle(m: ReadonlyArray<MesureExtrait>): number | null {
  const avec = m.filter((x) => x.empreinte);
  if (avec.length < 2) return null;
  const mins = avec.map((x) => Math.min(...avec.filter((y) => y !== x).map((y) => ecartEmpreinte(x.empreinte!, y.empreinte!))));
  return r2(Math.min(1, moyenne(mins) / REGLES_MONTAGE.echelleDifference));
}

export function conseilsMontage(input: {
  profil: string;
  plan: ReadonlyArray<RushSegment>;
  analyses: ReadonlyArray<AnalyseRush>;
  /** Temps de la musique dans le temps de la VIDÉO (déjà recalés). */
  rythme?: { beats: number[]; forts: number[] } | null;
}): { conseils: Conseil[]; couleur: boolean; repetition: boolean; rythme: boolean; score: number | null } {
  const R = REGLES_MONTAGE;
  const { profil, plan } = input;
  const out: Conseil[] = [];
  const dynamique = PROFILS_DYNAMIQUES.has(profil);
  const mesures = plan.length >= 2 ? mesurerExtraits(plan, input.analyses) : null;

  // ── COULEUR ↔ NOIR ET BLANC ──
  let couleurMesuree = false;
  if (mesures && mesures.every((m) => m.saturation !== null)) {
    couleurMesuree = true;
    const nb = mesures.map((m) => m.saturation! < R.saturationNoirBlanc);
    const ruptures = nb.slice(1).filter((v, i) => v !== nb[i]).length;
    if (nb.some(Boolean) && nb.some((v) => !v)) {
      const rushesNb = Array.from(new Set(mesures.filter((_, i) => nb[i]).map((m) => nomRush(m.rush))));
      out.push({
        id: 'rushes:noir-blanc',
        section: 'Rushes',
        priorite: dynamique ? 'IMPORTANTE' : 'MOYENNE',
        cible: rushesNb.map((n) => `rush:${n}`).join(','),
        texteActuel: null,
        probleme: `La vidéo passe ${ruptures} fois de la couleur au noir et blanc : ${rushesNb.map((n) => `« ${n} »`).join(' et ')} ${rushesNb.length > 1 ? 'sont' : 'est'} en noir et blanc, le reste en couleur.`,
        conseil: dynamique
          ? 'Pour une vidéo de danse, garde les rushes en couleur : ils portent l\'énergie. Le noir et blanc ne se justifie que s\'il est voulu sur toute la vidéo.'
          : 'Choisis une seule ambiance : tout en couleur, ou tout en noir et blanc si c\'est voulu.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
        mesures: { ruptures, extraitsNoirBlanc: nb.filter(Boolean).length, extraits: nb.length },
      });
    }
  }

  // ── AMBIANCE LUMINEUSE très différente d'un rush à l'autre ──
  if (mesures) {
    const parRush = new Map<string, number[]>();
    mesures.forEach((m) => (parRush.get(m.rush) ?? parRush.set(m.rush, []).get(m.rush)!).push(m.luminosite));
    const lums = Array.from(parRush.entries()).map(([u, l]) => ({ nom: nomRush(u), lum: moyenne(l) }));
    if (lums.length >= 2) {
      const clair = lums.reduce((a, b) => (b.lum > a.lum ? b : a));
      const sombre = lums.reduce((a, b) => (b.lum < a.lum ? b : a));
      if (clair.lum - sombre.lum > R.ecartAmbiance) {
        out.push({
          id: 'rushes:ambiance',
          section: 'Rushes',
          priorite: 'MOYENNE',
          cible: `rush:${sombre.nom},rush:${clair.nom}`,
          texteActuel: null,
          probleme: `« ${clair.nom} » est nettement plus lumineux que « ${sombre.nom} » : on sent le changement d'ambiance à chaque passage de l'un à l'autre.`,
          conseil: 'Rapproche les ambiances (même filtre couleur sur toute la vidéo) ou regroupe les plans de chaque ambiance au lieu de les alterner.',
          propositionReecrite: null,
          placementRecommande: null,
          dureeRecommandee: null,
          mesures: { ecartLuminosite: r2(clair.lum - sombre.lum) },
        });
      }
    }
  }

  // ── RÉPÉTITION : deux extraits qui montrent quasiment la même image ──
  let repetitionMesuree = false;
  let score: number | null = null;
  if (mesures && mesures.every((m) => m.empreinte)) {
    repetitionMesuree = true;
    score = scoreDifferenceVisuelle(mesures);
    const paires: Array<[number, number, number]> = [];
    for (let i = 0; i < mesures.length; i++) {
      for (let j = i + 1; j < mesures.length; j++) {
        const d = ecartEmpreinte(mesures[i].empreinte!, mesures[j].empreinte!);
        if (d < R.quasiIdentique) paires.push([i, j, d]);
      }
    }
    // Même scène : deux morceaux du MÊME rush, proches dans la prise, dont
    // les images se ressemblent encore (mesure, pas reconnaissance).
    const fenetre = (i: number) => [plan[i].depuis ?? 0, plan[i].jusqua ?? (plan[i].depuis ?? 0) + plan[i].fin - plan[i].debut];
    for (let i = 0; i < mesures.length; i++) {
      for (let j = i + 1; j < mesures.length; j++) {
        if (cleSource(plan[i].url) !== cleSource(plan[j].url) || paires.some(([a, b]) => a === i && b === j)) continue;
        const [a0, a1] = fenetre(i); const [b0, b1] = fenetre(j);
        const ecart = Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
        const d = ecartEmpreinte(mesures[i].empreinte!, mesures[j].empreinte!);
        if (ecart < R.memeSceneEcartS && d < R.memeSceneEmpreinte) paires.push([i, j, d]);
      }
    }
    if (paires.length) {
      const t = (i: number) => `${virgule(plan[i].debut)} s`;
      out.push({
        id: 'montage:repetition',
        section: 'Montage',
        priorite: paires.length >= 3 ? 'IMPORTANTE' : 'MOYENNE',
        cible: Array.from(new Set(paires.flatMap(([i, j]) => [i, j]))).map((i) => `extrait:${i}`).join(','),
        texteActuel: null,
        probleme: `${paires.length} paire${paires.length > 1 ? 's' : ''} d'extraits montrent quasiment la même scène (par exemple à ${t(paires[0][0])} et ${t(paires[0][1])}) : le spectateur a l'impression de revoir la même chose.`,
        conseil: 'Remplace l\'un des deux par un plan différent (autre angle, autre geste, autre personne), ou ajoute un rush.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
        mesures: { paires: paires.length, scoreDifferenceVisuelle: score },
      });
    }
  }

  // ── UN SEUL RUSH porte presque toute la vidéo ──
  if (plan.length >= 2) {
    const total = plan.reduce((t, s) => t + (s.fin - s.debut), 0);
    const parRush = new Map<string, { url: string; d: number; n: number }>();
    for (const s of plan) {
      const k = cleSource(s.url);
      const e = parRush.get(k) ?? { url: s.url, d: 0, n: 0 };
      e.d += s.fin - s.debut; e.n += 1; parRush.set(k, e);
    }
    const dominant = Array.from(parRush.values()).reduce((a, b) => (b.d > a.d ? b : a));
    const part = total > 0 ? dominant.d / total : 0;
    if (parRush.size >= 2 && part > R.partDominante) {
      out.push({
        id: 'rushes:dominant',
        section: 'Rushes',
        priorite: 'MOYENNE',
        cible: `rush:${nomRush(dominant.url)}`,
        texteActuel: null,
        probleme: `${Math.round(part * 100)} % de la vidéo (${dominant.n} extraits sur ${plan.length}) vient du même rush, « ${nomRush(dominant.url)} » : la vidéo manque de variété.`,
        conseil: 'Ajoute un ou deux rushes différents (autre lieu, autre angle, gros plan) pour faire progresser la vidéo.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
        mesures: { partRushDominant: r2(part), extraits: dominant.n },
      });
    }
  }

  // ── PLAN STATIQUE au milieu d'une séquence dynamique ──
  if (mesures && dynamique) {
    const med = mediane(mesures.map((m) => m.mouvement));
    const statiques = mesures.filter((m) => {
      const phase = plan[m.index].phase;
      return med > 0 && m.mouvement < med * R.statiqueRelatif && phase !== 'FOCUS' && phase !== 'CTA' && m.index > 0 && m.index < mesures.length - 1;
    });
    if (statiques.length) {
      out.push({
        id: 'montage:statique',
        section: 'Montage',
        priorite: 'MOYENNE',
        cible: statiques.map((m) => `extrait:${m.index}`).join(','),
        texteActuel: null,
        probleme: `${statiques.length > 1 ? `${statiques.length} plans presque immobiles` : 'Un plan presque immobile'} (à ${statiques.map((m) => `${virgule(plan[m.index].debut)} s`).join(', ')}) casse${statiques.length > 1 ? 'nt' : ''} l'énergie de la séquence.`,
        conseil: 'Remplace-le par un plan en mouvement, ou garde-le pour la fin (moment de pause avant le CTA).',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
      });
    }
  }

  // ── RYTHME : durée des plans ──
  if (plan.length) {
    const d = (s: RushSegment) => s.fin - s.debut;
    const accroche = plan.filter((s) => s.phase === 'HOOK');
    if (profil === 'CARDIO_DANCE' && accroche.length && accroche.some((s) => d(s) > R.accrocheMax + 0.05)) {
      const durees = accroche.map((s) => virgule(d(s)));
      out.push({
        id: 'rythme:accroche',
        section: 'Rythme',
        priorite: 'MOYENNE',
        cible: accroche.map((s) => `extrait:${plan.indexOf(s)}`).join(','),
        texteActuel: null,
        probleme: `Les premiers plans durent ${durees.join(' s et ')} s : l'ouverture manque de nervosité pour une vidéo de danse.`,
        conseil: 'Dans les 3 premières secondes, enchaîne des plans de 0,8 à 1,2 s, si les rushes ont assez de matière.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: '0,8 à 1,2 s par plan',
        mesures: { plansAccroche: accroche.length, dureeMax: r2(Math.max(...accroche.map(d))) },
      });
    }
    // Limite du PROFIL (moteur partagé) : danse 2 s, sinon sa propre règle, 3 s par défaut.
    const limite = profil in REGLES_PROFILS ? REGLES_PROFILS[profil as keyof typeof REGLES_PROFILS].hardMax : 3;
    const longs = plan.filter((s) => d(s) > limite + 0.05 && s.phase !== 'CTA');
    if (longs.length) {
      out.push({
        id: 'rythme:plans-longs',
        section: 'Rythme',
        priorite: dynamique ? 'MOYENNE' : 'FAIBLE',
        cible: longs.map((s) => `extrait:${plan.indexOf(s)}`).join(','),
        texteActuel: null,
        probleme: `${longs.length} plan${longs.length > 1 ? 's' : ''} de plus de ${virgule(limite, 0)} s.`,
        conseil: `Au-delà de ${virgule(limite, 0)} s, un plan doit montrer quelque chose qui se passe : sinon, coupe-le en deux.`,
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: '1 à 2 s',
      });
    }
  }

  // ── RYTHME : les coupes tombent-elles VRAIMENT sur la musique ? ──
  let rythmeMesure = false;
  const beats = input.rythme?.beats ?? [];
  if (beats.length >= 4 && plan.length >= 2) {
    rythmeMesure = true;
    const coupes = plan.slice(0, -1).map((s) => s.fin);
    const forts = input.rythme?.forts ?? [];
    const proche = (l: number[], t: number) => (l.length ? Math.min(...l.map((b) => Math.abs(b - t))) : Infinity);
    const surTemps = coupes.filter((c) => proche(beats, c) <= R.toleranceBeat).length;
    const surFort = coupes.filter((c) => proche(forts, c) <= R.toleranceBeat).length;
    const part = surTemps / coupes.length;
    if (part < 0.6) {
      out.push({
        id: 'rythme:musique',
        section: 'Rythme',
        priorite: part < 0.3 ? 'IMPORTANTE' : 'MOYENNE',
        cible: 'coupes',
        texteActuel: null,
        probleme: `Seulement ${surTemps} coupe${surTemps > 1 ? 's' : ''} sur ${coupes.length} tombe${surTemps > 1 ? 'nt' : ''} sur un temps de la musique.`,
        conseil: 'Choisis une musique au rythme bien marqué, ou décale les coupes sur les temps : le montage paraîtra plus dansant.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
        mesures: { coupes: coupes.length, surTemps, surTempsFort: surFort },
      });
    }
  }

  return { conseils: out, couleur: couleurMesuree, repetition: repetitionMesuree, rythme: rythmeMesure, score };
}
