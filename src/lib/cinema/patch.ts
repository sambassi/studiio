/**
 * CINEMA IA — appliquer une modification a la main sur un film (fonction PURE).
 *
 * Extraite de la route PATCH pour que `modifierFilm` puisse la REJOUER sur un
 * film plus recent quand une autre ecriture est passee entre-temps (rendu qui
 * scelle des scenes, second onglet). Une fonction rejouable ne doit rien lire
 * d'autre que ses deux arguments.
 *
 * ⚠️ AUCUNE URL DE MEDIA N'ENTRE PAR ICI. Poser un media passe par
 * `POST .../medias`, qui ECRIT le fichier et le MESURE. Le PATCH ne sait que
 * RETIRER (`media: null`) et regler le son (`sonMedia`). La meme regle vaut
 * pour l'image d'un personnage : `urlImage` n'est accepte que s'il designe une
 * reference IMPORTEE (`referenceCinemaValide`), jamais une adresse libre.
 */
import type { Film } from '@/lib/cinema/types';
import { ajouterReference } from '@/lib/cinema/personnages';
import { remplacerMedia, reglerSonMedia } from '@/lib/cinema/medias';
import { referenceCinemaValide } from '@/lib/cinema/acces';
import { estStyleCinema } from '@/lib/cinema/direction/styles';
import { estCameraCinema } from '@/lib/cinema/direction/camera';
import type { IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';
import { VOIX_FILM } from '@/lib/cinema/personnages';

/** Une erreur DE L'APPELANT, rendue en 400 telle quelle. */
export function erreurPatch(corps: unknown): string | null {
  const c = corps as { plans?: unknown[]; scenes?: unknown[]; style?: unknown; narration?: unknown; reference?: { urlImage?: unknown } } | null;
  if (c && 'narration' in c && typeof c.narration !== 'boolean') return 'narration : vrai ou faux attendu';
  const ca = c as { modeAudio?: unknown; voix?: unknown } | null;
  if (ca && 'modeAudio' in ca && ca.modeAudio !== 'personnages' && ca.modeAudio !== 'narrateur') return 'mode audio inconnu (personnages ou narrateur attendu)';
  if (ca && 'voix' in ca) {
    if (!Array.isArray(ca.voix)) return 'voix : liste attendue';
    for (const v of ca.voix as Array<Record<string, unknown> | null>) {
      if (typeof v?.personnageId !== 'string' || !VOIX_FILM.some((x) => x.id === v.voix)) return 'voix inconnue : choisis une voix de la liste';
    }
  }
  // Direction artistique : `null` efface le choix, toute autre valeur doit etre connue.
  if (c && 'style' in c && c.style !== null && !estStyleCinema(c.style)) return 'style de film inconnu';
  if (Array.isArray(c?.scenes)) {
    for (const sc of c!.scenes as Array<Record<string, unknown> | null>) {
      if (sc && 'style' in sc && sc.style !== null && !estStyleCinema(sc.style)) return 'style de scene inconnu';
    }
  }
  if (Array.isArray(c?.plans)) {
    for (const p of c!.plans as Array<Record<string, unknown> | null>) {
      if (p && 'camera' in p && p.camera !== null && !estCameraCinema(p.camera)) return 'mouvement de camera inconnu';
    }
  }
  if (Array.isArray(c?.plans)) {
    for (const p of c!.plans as Array<Record<string, unknown> | null>) {
      if ((p?.media !== undefined && p.media !== null) || p?.mediaUrl !== undefined) {
        return 'un media s\'importe par POST /medias, il ne se declare pas par URL';
      }
    }
  }
  const url = c?.reference?.urlImage;
  if (url !== undefined && url !== null && !referenceCinemaValide(url)) {
    return 'l\'image d\'un personnage s\'importe par POST /references, elle ne se declare pas par URL';
  }
  return null;
}

type PatchPlan = { locuteur?: unknown; id?: unknown; texte?: unknown; dureeS?: unknown; media?: null; sonMedia?: unknown; personnages?: unknown; camera?: unknown };
type PatchScene = { id?: unknown; personnages?: unknown; etat?: unknown; style?: unknown };

export function appliquerPatch(film: Film, corps: unknown): Film {
  const c = corps as { modeAudio?: unknown; voix?: Array<{ personnageId?: unknown; voix?: unknown }>; plans?: PatchPlan[]; scenes?: PatchScene[]; style?: unknown; accepter?: unknown; narration?: unknown; reference?: { personnageId?: unknown; description?: unknown; urlImage?: unknown } } | null;
  let suivant = film;

  // Style GLOBAL : `null` (ou absent du corps) → inchange ; `null` explicite → efface.
  if (c && 'style' in c) suivant = avecChamp(suivant, 'styleCinema', c.style === null ? undefined : (estStyleCinema(c.style) ? c.style : suivant.styleCinema));

  // Narration : un seul reglage par film. Le changer rend « a reproduire » les scenes qui ont
  // des phrases de recit (leur son change) ; les repliques ne bougent pas.
  if (c && typeof c.narration === 'boolean' && (suivant.narration !== false) !== c.narration) {
    suivant = {
      ...avecChamp(suivant, 'narration', c.narration ? undefined : false),
      scenes: suivant.scenes.map((sc) => (sc.plans.some((p) => p.dialogue?.genre === 'narration') ? { ...sc, empreinte: '' } : sc)),
    };
  }

  // Mode audio : un des DEUX modes. Le changer ne touche ni l'histoire, ni les personnages, ni les
  // dialogues : seules les scenes qui ont du texte dit deviennent « a reproduire » (leur son change).
  if (c && (c.modeAudio === 'personnages' || c.modeAudio === 'narrateur') && suivant.modeAudio !== c.modeAudio) {
    suivant = {
      ...suivant,
      modeAudio: c.modeAudio,
      scenes: suivant.scenes.map((sc) => (sc.plans.some((p) => p.dialogue) ? { ...sc, empreinte: '' } : sc)),
    };
  }

  // Voix d'un personnage : la meme dans toutes ses scenes. Les scenes ou il parle sont a reproduire.
  if (c && Array.isArray(c.voix)) {
    const choix = new Map<string, string>();
    for (const v of c.voix) if (typeof v?.personnageId === 'string' && VOIX_FILM.some((x) => x.id === v.voix)) choix.set(v.personnageId, v.voix as string);
    const changes = suivant.personnages.filter((p) => choix.has(p.id) && choix.get(p.id) !== p.voix).map((p) => p.id);
    if (changes.length > 0) {
      suivant = {
        ...suivant,
        personnages: suivant.personnages.map((p) => (choix.has(p.id) ? { ...p, voix: choix.get(p.id)! } : p)),
        scenes: suivant.scenes.map((sc) => (sc.plans.some((p) => p.dialogue?.personnageId && changes.includes(p.dialogue.personnageId)) ? { ...sc, empreinte: '' } : sc)),
      };
    }
  }

  // Ecarts de fidelite acceptes : la liste ENTIERE est remplacee (accepter puis retirer son choix).
  if (c && Array.isArray(c.accepter)) {
    const cles = (c.accepter as unknown[]).filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 400).slice(0, 200);
    suivant = { ...suivant, ecartsAcceptes: [...new Set(cles)] };
  }

  if (Array.isArray(c?.plans)) {
    const patchs = new Map<string, PatchPlan>();
    for (const p of c!.plans) if (typeof p?.id === 'string') patchs.set(p.id, p);
    const connus = new Set(film.personnages.map((p) => p.id));
    suivant = {
      ...suivant,
      scenes: suivant.scenes.map((scene) => ({
        ...scene,
        plans: scene.plans.map((plan) => {
          const patch = patchs.get(plan.id);
          if (!patch) return plan;
          const texte = typeof patch.texte === 'string' ? patch.texte.slice(0, 500) : null;
          return {
            ...avecChamp(plan, 'camera', 'camera' in patch ? cameraDe(patch.camera, plan.camera) : plan.camera),
            personnages: Array.isArray(patch.personnages)
              ? (patch.personnages as unknown[]).filter((id): id is string => typeof id === 'string' && connus.has(id))
              : plan.personnages,
            description: texte && !plan.dialogue ? texte : plan.description,
            // `locuteur` : l'utilisateur CHOISIT qui dit la replique (clarification d'un locuteur ambigu).
            dialogue: plan.dialogue && typeof patch.locuteur === 'string' && connus.has(patch.locuteur) && plan.dialogue.genre === 'replique'
              ? { ...plan.dialogue, ...(texte ? { texte } : {}), personnageId: patch.locuteur, locuteurConfirme: true as const }
              : plan.dialogue && texte ? { ...plan.dialogue, texte } : plan.dialogue,
            dureeS: !plan.dialogue && Number.isFinite(patch.dureeS)
              ? Math.min(20, Math.max(0.5, Number(patch.dureeS)))
              : plan.dureeS,
          };
        }),
      })),
    };
    // Retrait d'un media, et son du media. Un media retire laisse son OBJET
    // en place (il peut etre reattache) ; seul le plan cesse de le designer.
    for (const p of c!.plans) {
      if (typeof p?.id !== 'string') continue;
      if (p.media === null) suivant = remplacerMedia(suivant, p.id, null);
      if (typeof p.sonMedia === 'boolean') suivant = reglerSonMedia(suivant, p.id, p.sonMedia);
      // Un locuteur choisi : il figure dans le plan, et la scene est a reproduire (la voix change).
      if (typeof p.locuteur === 'string' && connus.has(p.locuteur)) {
        const loc = p.locuteur;
        suivant = {
          ...suivant,
          scenes: suivant.scenes.map((sc) => (!sc.plans.some((pl) => pl.id === p.id && pl.dialogue?.genre === 'replique') ? sc : {
            ...sc, empreinte: '',
            plans: sc.plans.map((pl) => (pl.id === p.id && !pl.personnages.includes(loc) ? { ...pl, personnages: [...pl.personnages, loc] } : pl)),
          })),
        };
      }
    }
  }

  if (Array.isArray(c?.scenes)) {
    const patchs = new Map<string, PatchScene>();
    for (const s of c!.scenes) if (typeof s?.id === 'string') patchs.set(s.id, s);
    const connus = new Set(suivant.personnages.map((p) => p.id));
    suivant = {
      ...suivant,
      scenes: suivant.scenes.map((scene) => {
        const patch = patchs.get(scene.id);
        if (!patch) return scene;
        return {
          ...avecChamp(scene, 'styleCinema', 'style' in patch ? styleDe(patch.style, scene.styleCinema) : scene.styleCinema),
          personnages: Array.isArray(patch.personnages)
            ? (patch.personnages as unknown[]).filter((id): id is string => typeof id === 'string' && connus.has(id))
            : scene.personnages,
          etat: patch.etat === 'validee' || patch.etat === 'brouillon' ? patch.etat : scene.etat,
        };
      }),
    };
  }

  // Nouvelle apparence d'un personnage : une VERSION de plus, jamais un ecrasement.
  if (c?.reference && typeof c.reference.personnageId === 'string') {
    const ref = c.reference;
    suivant = {
      ...suivant,
      personnages: suivant.personnages.map((p) => p.id !== ref.personnageId ? p : ajouterReference(p, {
        description: typeof ref.description === 'string' ? ref.description.slice(0, 300) : undefined,
        urlImage: typeof ref.urlImage === 'string' ? ref.urlImage : null,
      })),
    };
  }
  return suivant;
}

/** `valeur` absente ou `undefined` → le champ est RETIRE (jamais laisse a `undefined` dans le JSON). */
function avecChamp<T extends object, K extends string>(objet: T, cle: K, valeur: unknown): T {
  const { [cle]: _ancien, ...reste } = objet as Record<string, unknown>;
  return (valeur === undefined ? reste : { ...reste, [cle]: valeur }) as T;
}

/** Une camera `auto` n'est pas stockee : l'absence EST l'automatique. */
function cameraDe(v: unknown, actuel: IdCameraCinema | undefined): IdCameraCinema | undefined {
  if (v === null || v === 'auto') return undefined;
  return estCameraCinema(v) ? v : actuel;
}

function styleDe(v: unknown, actuel: IdStyleCinema | undefined): IdStyleCinema | undefined {
  if (v === null) return undefined;
  return estStyleCinema(v) ? v : actuel;
}
