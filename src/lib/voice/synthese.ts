/**
 * A_6c — SYNTHÉTISER UNE VOIX-OFF, AVEC SES MINUTAGES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `with-timestamps` PLUTÔT QUE LA SYNTHÈSE NUE, ET POUR UNE RAISON PRÉCISE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A_4 pose une règle qui ne se négocie pas : « sans mots horodatés, pas de
 * sous-titres » — répartir un texte uniformément donnerait un minutage
 * inventé, et un mot actif qui ment. Une voix-off sans minutage serait donc
 * une voix-off qu'on ne peut pas sous-titrer.
 *
 * ElevenLabs sait rendre l'audio ET l'alignement caractère par caractère. On
 * demande donc les deux d'un coup : c'est le même appel, le même coût, et
 * c'est ce qui rend les sous-titres de voix-off possibles sans rien deviner.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LES MOTS SE RECOMPOSENT À PARTIR DES CARACTÈRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'alignement est par CARACTÈRE. Un sous-titre se lit par MOTS. Le
 * regroupement est fait ici, une fois, par une fonction pure — et testé sur
 * des valeurs, parce qu'une lecture du code ne prouverait ni les apostrophes,
 * ni la ponctuation collée, ni les espaces multiples.
 *
 * MODULE PUR : il ne parle à personne, il met en forme.
 */

/** La forme brute que rend `with-timestamps`. */
export interface AlignementBrut {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
}

/** Un mot daté, dans le repère du fichier de voix. */
export interface MotVoix {
  debutSecondes: number;
  finSecondes: number;
  texte: string;
}

/** Au-delà, ce n'est plus une voix-off, c'est un livre audio. */
export const SCRIPT_MAX = 1_200;
export const MOTS_VOIX_MAX = 400;

const arrondir = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Les mots, reconstitués depuis l'alignement par caractère.
 *
 * ⚠️ LA PONCTUATION RESTE COLLÉE À SON MOT. « aujourd'hui ! » doit s'afficher
 * d'un bloc : détacher le point d'exclamation en ferait un mot actif à lui
 * seul, qui s'allumerait tout seul au milieu d'une phrase.
 *
 * ⚠️ ET UN MOT NE FINIT PAS AVANT DE COMMENCER. Le fournisseur rend parfois
 * des bornes identiques sur un caractère muet ; un mot de durée nulle
 * disparaîtrait du découpage sans qu'on sache pourquoi.
 *
 * Fonction PURE.
 */
export function motsDepuisAlignement(brut: AlignementBrut | null | undefined): MotVoix[] {
  if (!brut) return [];
  const cars = Array.isArray(brut.characters) ? brut.characters : [];
  const debuts = Array.isArray(brut.character_start_times_seconds)
    ? brut.character_start_times_seconds : [];
  const fins = Array.isArray(brut.character_end_times_seconds)
    ? brut.character_end_times_seconds : [];
  if (cars.length === 0 || cars.length !== debuts.length || cars.length !== fins.length) {
    return [];
  }

  const mots: MotVoix[] = [];
  let courant = '';
  let debut = 0;
  let fin = 0;

  const fermer = () => {
    const texte = courant.trim();
    courant = '';
    if (texte.length === 0) return;
    if (!(fin > debut)) return;
    mots.push({ debutSecondes: arrondir(debut), finSecondes: arrondir(fin), texte });
  };

  for (let i = 0; i < cars.length && mots.length < MOTS_VOIX_MAX; i += 1) {
    const c = typeof cars[i] === 'string' ? cars[i] as string : '';
    const d = Number(debuts[i]);
    const f = Number(fins[i]);
    if (!Number.isFinite(d) || !Number.isFinite(f)) continue;

    // Une espace — quelle qu'elle soit — ferme le mot en cours.
    if (/\s/.test(c)) { fermer(); continue; }
    if (courant.length === 0) debut = Math.max(0, d);
    courant += c;
    fin = Math.max(fin, f);
  }
  fermer();
  return mots;
}

/** Les caractères de contrôle, qui n'ont aucune prononciation. */
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/g;

/**
 * Le texte d'un script, nettoyé.
 *
 * ⚠️ ON NE CENSURE RIEN. Le script est ce que la personne a choisi de faire
 * dire à SA voix ; le seul ménage est celui des caractères de contrôle.
 */
export function scriptValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(CONTROLES, ' ').replace(/\s+/g, ' ').trim().slice(0, SCRIPT_MAX);
  return propre.length > 0 ? propre : null;
}

/** La durée totale de la voix, d'après ses mots. `0` si aucun. */
export function dureeVoixSecondes(mots: readonly MotVoix[]): number {
  return mots.length === 0 ? 0 : arrondir(mots[mots.length - 1].finSecondes);
}

/**
 * Les mots relus depuis la base — même exigence qu'à l'écriture.
 *
 * Ils traversent un `jsonb` : rien ne garantit qu'ils reviennent tels qu'ils
 * sont partis, et un minutage aberrant décalerait tous les sous-titres.
 */
export function motsVoixValides(brut: unknown): MotVoix[] {
  if (!Array.isArray(brut)) return [];
  const sortie: MotVoix[] = [];
  for (const v of brut) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const d = Number(o.debutSecondes);
    const f = Number(o.finSecondes);
    const t = typeof o.texte === 'string' ? o.texte : '';
    if (!Number.isFinite(d) || !Number.isFinite(f) || d < 0 || !(f > d)) continue;
    if (t.length === 0 || t.length > 100) continue;
    sortie.push({ debutSecondes: arrondir(d), finSecondes: arrondir(f), texte: t });
    if (sortie.length >= MOTS_VOIX_MAX) break;
  }
  /* ⚠️ TRIÉS : un `jsonb` ne promet pas l'ordre, et le segmenteur d'A_4
     suppose une suite croissante. */
  sortie.sort((a, b) => a.debutSecondes - b.debutSecondes);
  return sortie;
}
