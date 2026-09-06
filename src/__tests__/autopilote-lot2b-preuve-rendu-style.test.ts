/**
 * LOT 2B ETAPE 3B — LA PREUVE : LE STYLE ENREGISTRE SE VOIT DANS LE MP4.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE BANC EXISTE
 * ---------------------------------------------------------------------------
 *
 * Tout le reste de la suite verifie des CHAINES : que le graphe contient
 * `eq=`, que l'empreinte change, que la base garde la bonne cle. Rien de tout
 * cela ne prouve qu'une image sort differente. Un filtre peut etre ecrit,
 * accepte par ffmpeg, et sans effet visible — parametres trop faibles,
 * applique au mauvais endroit de la chaine, ecrase par un filtre suivant.
 *
 * Ce banc part donc du PROFIL ENREGISTRE, le relit par le vrai chemin de
 * persistance, rend un vrai MP4, et LIT LES PIXELS.
 *
 * Trois mesures, trois defauts possibles :
 *
 *   • le LOOK — la moyenne des couleurs au milieu d'un plan. S'il ne bouge
 *     pas, l'etalonnage est decoratif ;
 *   • la TRANSITION — la luminance a la jonction. Si elle ne baisse pas, le
 *     fondu n'est pas la ou on croit ;
 *   • le BANDEAU — la couleur au bas de l'image sur la fin. S'il n'apparait
 *     pas, `drawbox` n'a pas ete pris.
 *
 * Chaque mesure est comparee au rendu HISTORIQUE du meme plan : c'est la
 * comparaison qui a une valeur, pas une valeur absolue qu'on pourrait
 * ajuster jusqu'a ce qu'elle passe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const executer = promisify(execFile);

// ---------------------------------------------------------------------------
// La base en memoire — le vrai chemin de persistance, sans Postgres
// ---------------------------------------------------------------------------

type Ligne = Record<string, unknown>;
let lignes: Ligne[] = [];

function makeQuery() {
  const filtres: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select() { return q; },
    eq(c: string, v: unknown) { filtres.push([c, v]); return q; },
    limit() {
      return Promise.resolve({
        data: lignes.filter((l) => filtres.every(([c, v]) => l[c] === v)), error: null,
      });
    },
    async upsert(payload: Ligne) {
      const e = lignes.find((l) => l.user_id === payload.user_id);
      if (e) Object.assign(e, payload); else lignes.push({ ...payload });
      return { error: null };
    },
  };
  return q;
}

async function rpcFusion(nom: string, args: Record<string, unknown>) {
  if (nom !== 'autopilot_design_style_merge') {
    return { data: null, error: { message: 'Could not find the function' } };
  }
  const userId = args.p_user_id as string;
  const patch = args.p_patch as Record<string, unknown>;
  const l = lignes.find((x) => x.user_id === userId);
  if (l) l.design_style = { ...(l.design_style as object ?? {}), ...patch };
  else lignes.push({ user_id: userId, design_style: { ...patch } });
  return { data: null, error: null };
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => makeQuery(), rpc: rpcFusion },
  supabase: { from: () => makeQuery(), rpc: rpcFusion },
}));

const {
  enregistrerProfilCreatifUtilisateur, lireProfilCreatifUtilisateur,
  reinitialiserSondeStyle,
} = await import('@/lib/autopilot/analyse/profil-compte');
const { fusionnerProfilEtOverride } = await import('@/lib/autopilot/analyse/profil-creatif');
const { construireStyle } = await import('@/lib/autopilot/analyse/rendu-style');
const { argumentsRendu } = await import('@/lib/autopilot/analyse/rendu-ffmpeg');
const { RECETTE_AUDIO_DEFAUT } = await import('@/lib/autopilot/analyse/recette-audio');
const { methodeRendu } = await import('@/lib/autopilot/analyse/rendu-contrat');
type SourceLocale = import('@/lib/autopilot/analyse/rendu-ffmpeg').SourceLocale;
type CibleRendu = import('@/lib/autopilot/analyse/rendu-ffmpeg').CibleRendu;

// ---------------------------------------------------------------------------
// Outils de mesure
// ---------------------------------------------------------------------------

const L = 240;
const H = 426;
const FPS = 30;
const CIBLE: CibleRendu = { largeur: L, hauteur: H, fps: FPS };
const DUREE_CLIP = 2;
const DUREE_TOTALE = DUREE_CLIP * 2;
/** Le fondu, en millisecondes — assez long pour se mesurer sans doute. */
const FONDU_MS = 400;
/** La couleur du bandeau, choisie loin des deux plans pour etre reconnaissable. */
const COULEUR_CTA = '#FF00AA';
const CTA_SECONDES = 1.5;

async function ffmpegDisponible(): Promise<boolean> {
  try { await executer('ffmpeg', ['-hide_banner', '-version']); return true; } catch { return false; }
}
const AVEC_FFMPEG = await ffmpegDisponible();

/** Une frame, en RGB brut — la seule facon de lire ce que l'oeil verrait. */
async function frameRgb(fichier: string, seconde: number): Promise<Uint8Array> {
  const dossier = await mkdtemp(join(tmpdir(), 'studiio-frame-'));
  const brut = join(dossier, 'f.raw');
  await executer('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(seconde), '-i', fichier, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', brut,
  ]);
  const octets = new Uint8Array(await readFile(brut));
  await rm(dossier, { recursive: true, force: true });
  return octets;
}

interface Moyenne { r: number; g: number; b: number; luminance: number }

/** La moyenne d'une bande horizontale, de `y0` a `y1` en part de la hauteur. */
function moyenne(px: Uint8Array, y0 = 0, y1 = 1): Moyenne {
  const debut = Math.floor(H * y0) * L * 3;
  const fin = Math.floor(H * y1) * L * 3;
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = debut; i < Math.min(fin, px.length); i += 3) {
    r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 1;
  }
  if (n === 0) return { r: 0, g: 0, b: 0, luminance: 0 };
  const mr = r / n; const mg = g / n; const mb = b / n;
  return { r: mr, g: mg, b: mb, luminance: 0.2126 * mr + 0.7152 * mg + 0.0722 * mb };
}

beforeEach(() => { lignes = []; reinitialiserSondeStyle(); });

describe.skipIf(!AVEC_FFMPEG)('PREUVE — du style enregistre au MP4, pixels a l’appui', () => {
  it('enregistre, relit, rend, et le style SE VOIT', async () => {
    const dossier = await mkdtemp(join(tmpdir(), 'studiio-lot2b3b-'));
    try {
      // ── Deux plans, avec du son ────────────────────────────────────────
      const clips = [
        { chemin: join(dossier, 'a.mp4'), teinte: 'gray' },
        { chemin: join(dossier, 'b.mp4'), teinte: 'darkgreen' },
      ];
      for (const c of clips) {
        await executer('ffmpeg', [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', `color=c=${c.teinte}:s=${L}x${H}:r=${FPS}:d=${DUREE_CLIP}`,
          '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DUREE_CLIP}`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
          '-y', c.chemin,
        ]);
      }
      const sources: SourceLocale[] = clips.map((c, i) => ({
        ordre: i, chemin: c.chemin, entreeSecondes: 0, dureeRetenueSecondes: DUREE_CLIP,
        crop: { largeur: L, hauteur: H, x: 0, y: 0 }, aAudio: true,
      }));
      const audio = { recette: RECETTE_AUDIO_DEFAUT, musique: null, dureeSecondes: DUREE_TOTALE };

      // ── A. Enregistrer « Mon style » ───────────────────────────────────
      const ecriture = await enregistrerProfilCreatifUtilisateur('moi', {
        lut: { active: true, lutId: 'cinema-warm', intensite: 1 },
        marque: { logoActif: false },
        ctaVisuel: { actif: true, dureeSecondes: CTA_SECONDES, position: 'bas' },
        couleurs: { accent: COULEUR_CTA },
        transitions: { active: true, transitionId: 'crossfade', dureeMs: FONDU_MS },
        margesSures: { hautPct: 0, basPct: 0, gauchePct: 0, droitePct: 0 },
      });
      expect(ecriture.ok).toBe(true);

      // ── B + D. Relire — l'aller-retour doit etre fidele ────────────────
      const relu = await lireProfilCreatifUtilisateur('moi');
      expect(relu).not.toBeNull();
      expect(relu!.lut.lutId).toBe('cinema-warm');
      expect(relu!.transitions.transitionId).toBe('crossfade');
      expect(relu!.ctaVisuel.actif).toBe(true);
      expect(relu!.couleurs.accent).toBe(COULEUR_CTA);
      // Une seconde relecture rend exactement la meme chose.
      const relu2 = await lireProfilCreatifUtilisateur('moi');
      expect(JSON.stringify(relu2)).toBe(JSON.stringify(relu));

      // ── Le rendu HISTORIQUE, pour comparer ─────────────────────────────
      const neutre = join(dossier, 'neutre.mp4');
      await executer('ffmpeg', argumentsRendu(sources, CIBLE, neutre, audio));

      // ── Le rendu AVEC le style relu ────────────────────────────────────
      const style = construireStyle(relu, {
        cible: { largeur: L, hauteur: H },
        clips: [{ dureeSecondes: DUREE_CLIP }, { dureeSecondes: DUREE_CLIP }],
        dureeTotaleSecondes: DUREE_TOTALE,
        logo: null,
        indicePremiereEntree: sources.length,
      });
      const stylise = join(dossier, 'stylise.mp4');
      await executer('ffmpeg', argumentsRendu(sources, CIBLE, stylise, audio, style));

      // ── Le fichier est-il valide ? ─────────────────────────────────────
      const { stdout } = await executer('ffprobe', [
        '-hide_banner', '-loglevel', 'error', '-print_format', 'json',
        '-show_format', '-show_streams', stylise,
      ]);
      const sonde = JSON.parse(stdout) as {
        format: { duration: string };
        streams: Array<{ codec_type: string; duration?: string }>;
      };
      const flux = sonde.streams;
      expect(flux.filter((s) => s.codec_type === 'video')).toHaveLength(1);
      expect(flux.filter((s) => s.codec_type === 'audio')).toHaveLength(1);
      expect(Math.abs(Number(sonde.format.duration) - DUREE_TOTALE)).toBeLessThan(0.15);
      const dv = Number(flux.find((s) => s.codec_type === 'video')?.duration ?? 0);
      const da = Number(flux.find((s) => s.codec_type === 'audio')?.duration ?? 0);
      expect(Math.abs(dv - da)).toBeLessThan(0.15);

      // ── 1. LE LOOK ─────────────────────────────────────────────────────
      // Au milieu du premier plan, loin de toute transition et du bandeau.
      const mN = moyenne(await frameRgb(neutre, 1.0));
      const mS = moyenne(await frameRgb(stylise, 1.0));
      const ecart = Math.abs(mS.r - mN.r) + Math.abs(mS.g - mN.g) + Math.abs(mS.b - mN.b);
      expect(ecart).toBeGreaterThan(6);
      // ⚠️ ET DANS LE BON SENS. `cinema-warm` rechauffe : le rouge doit monter
      // par rapport au bleu. Un ecart tout court passerait aussi avec un look
      // branche a l'envers.
      expect((mS.r - mS.b) - (mN.r - mN.b)).toBeGreaterThan(3);

      // ── 2. LA TRANSITION ───────────────────────────────────────────────
      // A la jonction exacte : la fin du plan 1 est fondue au noir.
      const jN = moyenne(await frameRgb(neutre, DUREE_CLIP - 0.05));
      const jS = moyenne(await frameRgb(stylise, DUREE_CLIP - 0.05));
      expect(jS.luminance).toBeLessThan(jN.luminance - 20);
      // ⚠️ ET SEULEMENT A LA JONCTION. Un assombrissement general serait un
      // look rate, pas une transition : au milieu du plan, rien ne baisse.
      expect(mS.luminance).toBeGreaterThan(jS.luminance + 20);

      // ── 3. LE BANDEAU DE FIN ───────────────────────────────────────────
      // Le bas de l'image, sur la derniere seconde.
      const t = DUREE_TOTALE - 0.5;
      const bN = moyenne(await frameRgb(neutre, t), 0.92, 1);
      const bS = moyenne(await frameRgb(stylise, t), 0.92, 1);
      // #FF00AA : rouge fort, vert nul, bleu moyen.
      expect(bS.r).toBeGreaterThan(180);
      expect(bS.g).toBeLessThan(60);
      expect(bS.r - bN.r).toBeGreaterThan(80);
      // ⚠️ ET SEULEMENT SUR LA FIN. Un bandeau permanent recouvrirait la
      // video : au debut, le bas de l'image est celui du rush.
      const bDebut = moyenne(await frameRgb(stylise, 0.5), 0.92, 1);
      expect(bDebut.r).toBeLessThan(180);

      // ── L'identite de rendu suit ───────────────────────────────────────
      expect(methodeRendu(RECETTE_AUDIO_DEFAUT, relu).startsWith('x264-pc-v1-')).toBe(true);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }, 180_000);

  it('un override de video l’emporte au rendu, et le compte n’en garde rien', async () => {
    await enregistrerProfilCreatifUtilisateur('moi', {
      lut: { active: true, lutId: 'cinema-warm', intensite: 1 },
    });
    const compte = await lireProfilCreatifUtilisateur('moi');
    expect(compte!.lut.lutId).toBe('cinema-warm');

    // Le profil EFFECTIF de cette video seulement.
    const effectif = fusionnerProfilEtOverride(compte, { lut: { lutId: 'vibrant' } });
    expect(effectif.lut.lutId).toBe('vibrant');

    // ⚠️ APRES le rendu, le compte n'a pas bouge d'un pouce.
    const apres = await lireProfilCreatifUtilisateur('moi');
    expect(apres!.lut.lutId).toBe('cinema-warm');

    // Puis le geste explicite, et seulement lui, change le compte.
    await enregistrerProfilCreatifUtilisateur('moi', effectif);
    expect((await lireProfilCreatifUtilisateur('moi'))!.lut.lutId).toBe('vibrant');
  });
});
