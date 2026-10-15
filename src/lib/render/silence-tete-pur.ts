/**
 * A6 (partie PURE, importable par la composition Remotion) — LA MUSIQUE DÉMARRE AUDIBLE : silence de tête du fichier sauté.
 *
 * Constaté sur une vraie vidéo (STRESS, musique `adou.mp3`) : le fichier
 * commence par 2,26 s de blanc numérique, et rien ne le rognait — la vidéo
 * s'ouvrait sur ~2,3 s de silence total, ce qui la condamne sur les réseaux.
 *
 * La durée du blanc est mesurée UNE fois, localement et gratuitement, par
 * ffmpeg `silencedetect` sur les premières secondes du fichier, puis le rendu
 * démarre la musique à ce point (`trimBefore` de `<Audio>` côté Remotion,
 * `atrim=start=` côté hybride), avec un court fondu d'entrée.
 *
 * Choix :
 *   - SEUIL −50 dBFS : sous ce niveau, rien n'est audible sur un téléphone ;
 *     un fondu musical réel (pianissimo) reste au-dessus. Rien de réel n'est
 *     coupé : on saute jusqu'au PREMIER franchissement du seuil.
 *   - MAXIMUM 5 s : au-delà, ce n'est plus un blanc d'encodage mais un choix
 *     de l'auteur (intro très calme, piste mal choisie) — on n'en saute que
 *     5 s, jamais un pan entier du morceau. La mesure ne lit donc que
 *     5,5 s : coût négligeable, même pour un morceau de 3 min.
 *   - MINIMUM 0,05 s : un blanc plus court est inaudible ; aucun décalage, le
 *     rendu reste IDENTIQUE à celui d'avant (props inchangées).
 *   - FONDU 0,15 s, posé AVANT le son : le départ est reculé de la durée du
 *     fondu (`blanc − fondu`), si bien que le fondu ne s'applique qu'à la fin
 *     du blanc — l'attaque réelle arrive à plein volume, sans clic.
 *
 * Tout échec (ffmpeg absent, fichier illisible, délai) rend 0 : le rendu
 * d'avant, exactement. Jamais un rendu n'échoue pour ça.
 *
 * La BOUCLE n'est pas modifiée : seul le DÉBUT de la vidéo saute le blanc ;
 * une repasse du morceau (morceau plus court que la vidéo) repart du début du
 * fichier, comme le `loop` du compositeur navigateur et le `-stream_loop` de
 * ffmpeg.
 */
export const SEUIL_SILENCE_TETE_DB = -50;
export const SILENCE_TETE_MAX_S = 5;
export const SILENCE_TETE_MIN_S = 0.05;
export const FONDU_ENTREE_MUSIQUE_S = 0.15;
/** Fenêtre lue par la mesure : un peu plus que le maximum, pour le borner. */
export const FENETRE_MESURE_S = SILENCE_TETE_MAX_S + 0.5;

/**
 * Durée du silence de TÊTE lue dans le journal de `silencedetect`. Pure.
 * À n'appeler que sur le journal d'une mesure réussie (code 0).
 * 0 : le fichier commence par du son. `fenetre` : silence jusqu'au bout de
 * la fenêtre lue (aucune fin trouvée). `null` : valeur illisible.
 */
export function lireSilenceDeTete(journal: string, fenetre = FENETRE_MESURE_S): number | null {
  const debut = /silence_start:\s*(-?[\d.]+)/.exec(journal);
  if (!debut) return 0; // journal d'une mesure RÉUSSIE (code 0) : aucun blanc
  const t0 = Number(debut[1]);
  if (!Number.isFinite(t0)) return null;
  if (t0 > 0.01) return 0; // le premier blanc ne commence pas au début
  const fin = /silence_end:\s*(-?[\d.]+)/.exec(journal.slice(debut.index));
  if (!fin) return fenetre;
  const t1 = Number(fin[1]);
  return Number.isFinite(t1) && t1 >= 0 ? t1 : null;
}

/**
 * Départ de la musique (s) pour un silence de tête mesuré. Pure.
 * 0 = aucun décalage (mesure absente, échouée ou blanc inaudible).
 */
export function departMusiquePourSilence(silence: number | null | undefined): number {
  if (typeof silence !== 'number' || !Number.isFinite(silence) || silence < SILENCE_TETE_MIN_S) return 0;
  const borne = Math.min(silence, SILENCE_TETE_MAX_S);
  const depart = Math.max(0, borne - FONDU_ENTREE_MUSIQUE_S);
  return depart < SILENCE_TETE_MIN_S ? 0 : Math.round(depart * 1000) / 1000;
}

/**
 * Facteur du fondu d'entrée à l'instant `t` (s) de la vidéo. 1 partout quand
 * aucun décalage n'est appliqué : sortie identique à celle d'avant. Pure.
 */
export function facteurFonduEntreeMusique(t: number, departSecondes: number | null | undefined): number {
  if (!(typeof departSecondes === 'number' && departSecondes > 0)) return 1;
  if (t >= FONDU_ENTREE_MUSIQUE_S) return 1;
  return Math.max(0, t / FONDU_ENTREE_MUSIQUE_S);
}

/** Arguments ffmpeg de la mesure. Pur. */
export function argumentsSilenceDeTete(source: string): string[] {
  return [
    '-hide_banner', '-nostats', '-t', String(FENETRE_MESURE_S), '-i', source,
    '-vn', '-af', `silencedetect=noise=${SEUIL_SILENCE_TETE_DB}dB:d=${SILENCE_TETE_MIN_S}`, '-f', 'null', '-',
  ];
}


/** Une passe de la musique dans la vidéo, en images. */
export interface PasseMusique { from: number; duree: number; trimBefore: number }

/**
 * Passes de la musique en boucle (`MusiqueEnBoucle`), en images. Pure.
 * `boucleFrames` : durée du morceau (0 = inconnue → une seule passe).
 * `departFrames` : silence de tête sauté par la PREMIÈRE passe seulement ;
 * ignoré s'il mangerait tout le morceau. Sans départ : les passes d'avant
 * A6, à l'identique (`i × boucleFrames`).
 */
export function passesMusiqueEnBoucle(boucleFrames: number, totalFrames: number, departFrames = 0): PasseMusique[] {
  const depart = departFrames > 0 && (boucleFrames === 0 || departFrames < boucleFrames) ? departFrames : 0;
  if (boucleFrames === 0 || boucleFrames - depart >= totalFrames) {
    return [{ from: 0, duree: totalFrames, trimBefore: depart }];
  }
  const premiere = boucleFrames - depart;
  const out: PasseMusique[] = [{ from: 0, duree: premiere, trimBefore: depart }];
  for (let from = premiere; from < totalFrames; from += boucleFrames) {
    out.push({ from, duree: Math.min(boucleFrames, totalFrames - from), trimBefore: 0 });
  }
  return out;
}
