'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, ImageIcon, Loader2, Palette, Trash2,
} from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import ColorWheel from '@/components/ui/ColorWheel';
import { transitionParId } from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  ANCRES_TEXTE, BUCKETS_LOGO, PROFIL_CREATIF_DEFAUT, POSITIONS_LOGO,
  estProfilHistorique, normaliserProfilCreatif,
  type AncreTexte, type PositionLogo, type ProfilCreatifAutopilote,
} from '@/lib/autopilot/analyse/profil-creatif';
import { TRANSITIONS_RENDUES } from '@/lib/autopilot/analyse/rendu-style';
import { LONGUEURS_MAX } from '@/lib/autopilot/analyse/rendu-texte';
import ApercuStyleTexte from '@/components/creer/ApercuStyleTexte';
import BibliothequeLooks from '@/components/creer/BibliothequeLooks';
import BibliothequeStylesTexte from '@/components/creer/BibliothequeStylesTexte';
import BibliothequeAnimationsTexte from '@/components/creer/BibliothequeAnimationsTexte';
import BibliothequeAnimationsContenu from '@/components/creer/BibliothequeAnimationsContenu';

/**
 * Un champ de texte borne, avec son compteur.
 *
 * ⚠️ LE COMPTEUR N'EST PAS UN ORNEMENT. La borne existe cote serveur, qui
 * TRONQUE silencieusement : sans compteur, on decouvrirait la coupe dans le
 * MP4 fini. Le dire ici coute une ligne et evite un rendu perdu.
 */
function ChampTexte({
  libelle, marqueur, exemple, valeur, max, onChange,
}: {
  libelle: string; marqueur: string; exemple: string;
  valeur: string; max: number; onChange: (v: string) => void;
}) {
  const trop = valeur.length > max;
  return (
    <label className="block text-[11px] text-gray-400">
      <span className="flex items-baseline justify-between gap-2">
        <span>{libelle}</span>
        <span className={trop ? 'text-amber-400' : 'text-gray-600'}>
          {valeur.length} / {max}
        </span>
      </span>
      <input
        type="text"
        value={valeur}
        placeholder={exemple}
        data-mon-style-champ={marqueur}
        /* La borne est posee ICI AUSSI : la saisie ne peut pas depasser ce que
           le serveur gardera. Le compteur previent, l'attribut empeche. */
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-900/60 px-2 py-1.5
          text-[11px] text-gray-200 placeholder:text-gray-600
          focus:border-purple-500/50 focus:outline-none"
      />
      {trop && (
        <span data-mon-style-trop-long className="mt-1 block text-[10px] text-amber-400">
          Texte trop long : il sera coupe a {max} caracteres.
        </span>
      )}
    </label>
  );
}

const LIBELLES_POSITION_LOGO: Record<PositionLogo, string> = {
  'haut-gauche': 'Haut gauche',
  'haut-droite': 'Haut droite',
  'bas-gauche': 'Bas gauche',
  'bas-droite': 'Bas droite',
  centre: 'Centre',
};

const LIBELLES_ANCRE: Record<AncreTexte, string> = {
  haut: 'Haut',
  centre: 'Centre',
  bas: 'Bas',
};

/**
 * `{ bucket, cle }` a partir d'une adresse de la mediatheque, ou `null`.
 *
 * ⚠️ UNE COMMODITE D'ECRAN, PAS UNE GARDE. Le serveur revalide le
 * compartiment ET le prefixe de propriete (`verifierLogo`) : ce que cette
 * fonction produit n'est jamais cru sur parole. Elle existe seulement pour
 * que l'utilisateur choisisse une vignette au lieu de taper une cle.
 */
export function objetDepuisUrl(url: string): { bucket: string; cle: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!m) return null;
  const bucket = m[1];
  if (!(BUCKETS_LOGO as readonly string[]).includes(bucket)) return null;
  let cle: string;
  try { cle = decodeURIComponent(m[2]); } catch { return null; }
  return { bucket, cle };
}

interface Props {
  /** Le style deja enregistre, ou `null` si le compte n'en a pas. */
  profilEnregistre: ProfilCreatifAutopilote | null;
  /** Enregistre « Mon style ». Rend `true` en cas de succes. */
  onEnregistrer: (profil: ProfilCreatifAutopilote) => Promise<boolean>;
  /**
   * Ce que le CTA DIT, et ou il mene — lu depuis l'OBJECTIF du compte.
   *
   * ⚠️ CE N'EST PAS DU STYLE. Le depot le dit depuis toujours : le message
   * appartient a l'objectif, sa forme au style. Il est edite ici parce que
   * c'est la qu'on regle ce qui s'affiche, et enregistre la-bas.
   */
  appelActionEnregistre?: { texte: string | null; destination: string | null } | null;
  onEnregistrerAppelAction?: (
    a: { texte: string | null; destination: string | null },
  ) => Promise<boolean>;
  /** Le format du montage, pour que l'apercu ait la bonne geometrie. */
  format?: string;
  /** La duree du montage, qui borne les timings de l'apercu. */
  dureeMontageSecondes?: number;
  /** L'analyse du rush choisi : sa vignette sert de fond a l'apercu. */
  analyseApercuId?: string | null;
  chargement?: boolean;
}

export default function MonStylePanel({
  profilEnregistre, onEnregistrer, chargement = false,
  appelActionEnregistre = null, onEnregistrerAppelAction,
  format = '9:16', dureeMontageSecondes = 30, analyseApercuId = null,
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState<ProfilCreatifAutopilote>(
    profilEnregistre ?? PROFIL_CREATIF_DEFAUT,
  );
  const [libOuverte, setLibOuverte] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  // ⚠️ RESYNCHRONISE SUR LA VALEUR SERIALISEE. Le profil relu est un objet
  // neuf a chaque reponse : comparer les references relancerait cet effet a
  // chaque rendu et effacerait ce que l'utilisateur est en train de regler.
  const signature = JSON.stringify(profilEnregistre ?? null);
  useEffect(() => {
    setBrouillon(profilEnregistre ?? PROFIL_CREATIF_DEFAUT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const modifier = useCallback((patch: Partial<ProfilCreatifAutopilote>) => {
    setEnregistre(false);
    // ⚠️ RENORMALISE A CHAQUE TOUCHE. L'ecran ne peut donc pas fabriquer un
    // etat que le serveur refuserait — desactiver la LUT efface son
    // intensite ici exactement comme la-bas.
    setBrouillon((c) => normaliserProfilCreatif({ ...c, ...patch }));
  }, []);

  const aUnStyle = profilEnregistre !== null && !estProfilHistorique(profilEnregistre);

  /*
   * ⚠️ FAVORIS ET RÉCENTS VIVENT ICI, ET PAS ENCORE EN BASE.
   *
   * Les porter dans le profil demanderait de décider comment ils survivent
   * aux quatre familles à venir — styles, animations, transitions — et cette
   * décision mérite son propre lot. Tenus dans l'état du panneau, ils
   * rendent déjà la grille utilisable, et rien de ce qui les remplacera ne
   * sera contraint par ce choix.
   */
  const [favorisLooks, setFavorisLooks] = useState<string[]>([]);
  const [favorisStyles, setFavorisStyles] = useState<string[]>([]);
  const [favorisAnimations, setFavorisAnimations] = useState<string[]>([]);
  const [recentsAnimations, setRecentsAnimations] = useState<string[]>([]);
  const [favorisContenu, setFavorisContenu] = useState<string[]>([]);
  const [recentsContenu, setRecentsContenu] = useState<string[]>([]);
  const [recentsStyles, setRecentsStyles] = useState<string[]>([]);
  const [recentsLooks, setRecentsLooks] = useState<string[]>([]);
  const [textesOuverts, setTextesOuverts] = useState(false);
  const [appel, setAppel] = useState<{ texte: string | null; destination: string | null }>(
    appelActionEnregistre ?? { texte: null, destination: null },
  );
  /* L'objectif peut arriver apres le premier rendu (il est charge). Sans
     cette resynchronisation, le champ resterait vide alors que le compte a
     bien un appel a l'action enregistre. */
  useEffect(() => {
    if (appelActionEnregistre) setAppel(appelActionEnregistre);
  }, [appelActionEnregistre]);

  const enregistrer = useCallback(async () => {
    setEnregistrement(true);
    try {
      const ok = await onEnregistrer(brouillon);
      /* ⚠️ UN SEUL GESTE, DEUX DESTINATIONS. Le style va au profil, le
         message du CTA a l'objectif. Demander deux clics pour un seul
         reglage a l'ecran serait une frontiere technique imposee a
         l'utilisateur. */
      let okAppel = true;
      if (onEnregistrerAppelAction
        && (appel.texte !== (appelActionEnregistre?.texte ?? null)
          || appel.destination !== (appelActionEnregistre?.destination ?? null))) {
        okAppel = await onEnregistrerAppelAction(appel);
      }
      setEnregistre(ok && okAppel);
    } finally {
      setEnregistrement(false);
    }
  }, [brouillon, onEnregistrer, appel, appelActionEnregistre, onEnregistrerAppelAction]);

  return (
    <div className="pt-3 border-t border-gray-800" data-mon-style>
      {/* ── L'etat, en une ligne ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Palette className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <p className="text-xs font-medium text-gray-300">Style</p>
          {chargement ? (
            <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
          ) : (
            <span
              data-mon-style-etat={aUnStyle ? 'personnel' : 'defaut'}
              className={`truncate text-[11px] ${aUnStyle ? 'text-purple-300' : 'text-gray-500'}`}
            >
              {aUnStyle ? 'Mon style' : 'Style par défaut'}
            </span>
          )}
          {aUnStyle && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
        </div>
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          data-mon-style-toggle
          className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
        >
          {ouvert ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {aUnStyle ? 'Modifier' : 'Configurer'}
        </button>
      </div>

      {!ouvert && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          {aUnStyle
            ? 'Appliqué automatiquement à tes prochaines vidéos.'
            : 'Configure-le une fois : il s’appliquera ensuite tout seul.'}
        </p>
      )}

      {ouvert && (
        <div className="mt-3 space-y-4">
          {/* ── LOOK ──────────────────────────────────────────────────── */}
          <section>
            <p className="mb-1.5 text-[11px] font-medium text-gray-400">Look</p>
            {/* ⚠️ LA LISTE DE NOMS A LAISSÉ PLACE À DE VRAIS APERÇUS (A_3a).
                Quatre boutons de texte suffisaient à quatre looks ; ils ne
                suffisent plus à trente-quatre, et surtout ils ne disaient
                rien de ce qu'un look FAIT. Chaque vignette est calculée par
                le moteur, sur le rush choisi. */}
            <BibliothequeLooks
              lookActif={brouillon.lut.active ? brouillon.lut.lutId : 'neutral'}
              favoris={favorisLooks}
              recents={recentsLooks}
              analyseApercuId={analyseApercuId}
              onBasculerFavori={(id) => setFavorisLooks((f) => (
                f.includes(id) ? f.filter((x) => x !== id) : [...f, id]
              ))}
              onChoisir={(id) => {
                modifier({
                  lut: id === 'neutral'
                    ? { active: false, lutId: null, intensite: 1 }
                    : { active: true, lutId: id, intensite: brouillon.lut.intensite || 1 },
                });
                /* Les récents : le plus récent en tête, sans doublon, et
                   bornés — une liste qui grandit sans fin cesse d'être une
                   liste de récents. */
                setRecentsLooks((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
              }}
            />
            {brouillon.lut.active && (
              <label className="mt-2 block text-[11px] text-gray-400">
                Intensité <span className="text-gray-500">{Math.round(brouillon.lut.intensite * 100)} %</span>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={brouillon.lut.intensite}
                  data-mon-style-look-intensite
                  onChange={(e) => modifier({
                    lut: { ...brouillon.lut, intensite: Number(e.target.value) },
                  })}
                  className="mt-1 w-full accent-purple-500"
                />
              </label>
            )}
          </section>

          {/* ── LOGO ──────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-gray-400">Logo</p>
              <button
                type="button"
                role="switch"
                aria-checked={brouillon.marque.logoActif}
                data-mon-style-logo-actif
                onClick={() => modifier({
                  marque: { ...brouillon.marque, logoActif: !brouillon.marque.logoActif },
                })}
                // ⚠️ `py-1.5`, ET NON `py-0.5`. Mesure au banc responsive :
                // l'interrupteur ne faisait que 19 px de haut, sous le seuil
                // ou un doigt le vise sans le rater. Le texte reste petit ;
                // c'est la CIBLE qui grandit.
                className={`rounded-full px-2.5 py-1.5 text-[10px] leading-none transition ${
                  brouillon.marque.logoActif
                    ? 'bg-purple-500/20 text-purple-300'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {brouillon.marque.logoActif ? 'Activé' : 'Désactivé'}
              </button>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLibOuverte(true)}
                data-mon-style-logo-choisir
                className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
              >
                <ImageIcon className="w-3 h-3" />
                {brouillon.marque.logo ? 'Changer' : 'Choisir dans ma médiathèque'}
              </button>
              {brouillon.marque.logo && (
                <>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                    {brouillon.marque.logo.cle.split('/').pop()}
                  </span>
                  <button
                    type="button"
                    aria-label="Retirer le logo"
                    data-mon-style-logo-retirer
                    onClick={() => modifier({
                      marque: { ...brouillon.marque, logoActif: false, logo: null },
                    })}
                    className="text-gray-500 transition-colors hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>

            {brouillon.marque.logoActif && brouillon.marque.logo && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {POSITIONS_LOGO.map((p) => (
                    <button
                      key={p}
                      type="button"
                      data-mon-style-logo-position={p}
                      aria-pressed={brouillon.marque.position === p}
                      onClick={() => modifier({ marque: { ...brouillon.marque, position: p } })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] transition ${
                        brouillon.marque.position === p
                          ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      {LIBELLES_POSITION_LOGO[p]}
                    </button>
                  ))}
                </div>
                <label className="block text-[11px] text-gray-400">
                  Taille <span className="text-gray-500">{brouillon.marque.taillePct} %</span>
                  <input
                    type="range" min={1} max={50} step={1}
                    value={brouillon.marque.taillePct}
                    data-mon-style-logo-taille
                    onChange={(e) => modifier({
                      marque: { ...brouillon.marque, taillePct: Number(e.target.value) },
                    })}
                    className="mt-1 w-full accent-purple-500"
                  />
                </label>
                <label className="block text-[11px] text-gray-400">
                  Opacité <span className="text-gray-500">{Math.round(brouillon.marque.opacite * 100)} %</span>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={brouillon.marque.opacite}
                    data-mon-style-logo-opacite
                    onChange={(e) => modifier({
                      marque: { ...brouillon.marque, opacite: Number(e.target.value) },
                    })}
                    className="mt-1 w-full accent-purple-500"
                  />
                </label>
              </div>
            )}
          </section>


          {/* ── TEXTES & CTA ──────────────────────────────────────────────
              ⚠️ CES CHAMPS EXISTAIENT DÉJÀ EN BASE, VALIDÉS ET INATTEIGNABLES.
              `texte.titre`, `texte.sousTitre`, `texte.libre` étaient persistés
              et consommés par personne ; `appelAction.texte` n'avait AUCUNE
              surface d'édition dans toute l'application. A_1 les a rendus
              visibles à l'écran final ; ce bloc les rend saisissables. */}
          <section data-mon-style-textes>
            <button
              type="button"
              onClick={() => setTextesOuverts((o) => !o)}
              aria-expanded={textesOuverts}
              data-mon-style-textes-toggle
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <p className="text-[11px] font-medium text-gray-400">Textes &amp; appel à l’action</p>
              {textesOuverts
                ? <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
                : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
            </button>

            {textesOuverts && (
              <div className="mt-2 space-y-3">
                <ChampTexte
                  libelle="Accroche"
                  marqueur="accroche"
                  exemple="Bouge. Danse. Transpire."
                  valeur={brouillon.texte.titre ?? ''}
                  max={LONGUEURS_MAX.hook}
                  onChange={(v) => modifier({
                    // Écrire un texte ACTIVE le bloc : demander en plus de
                    // cocher une case ferait taper un texte qui ne s'affiche
                    // pas, sans rien dire.
                    texte: { ...brouillon.texte, titre: v || null, actif: true },
                  })}
                />
                <ChampTexte
                  libelle="Texte secondaire"
                  marqueur="secondaire"
                  exemple="Cours d’essai gratuit"
                  valeur={brouillon.texte.sousTitre ?? ''}
                  max={LONGUEURS_MAX.titre}
                  onChange={(v) => modifier({
                    texte: { ...brouillon.texte, sousTitre: v || null, actif: true },
                  })}
                />
                <ChampTexte
                  libelle="Texte de fin"
                  marqueur="fin"
                  exemple="Places limitées"
                  valeur={brouillon.texte.libre ?? ''}
                  max={LONGUEURS_MAX.fin}
                  onChange={(v) => modifier({
                    texte: { ...brouillon.texte, libre: v || null, actif: true },
                  })}
                />

                {/* ── Apparence ─────────────────────────────────────────── */}
                {/* ⚠️ LES BOUTONS « POLICE » ET « GRAISSE » ONT CÉDÉ LA PLACE
                    (A_3b). Choisir une police puis une graisse puis une
                    taille puis une ombre, c'est reconstruire un style à
                    chaque vidéo. La bibliothèque les porte ensemble — et
                    c'est elle qui décide, sinon deux réglages
                    contradictoires cohabiteraient à l'écran. */}
                <BibliothequeStylesTexte
                  styleActif={brouillon.typographie.styleTexteId}
                  exemple={brouillon.texte.titre ?? undefined}
                  couleur={brouillon.couleurs.texte ?? '#FFFFFF'}
                  favoris={favorisStyles}
                  recents={recentsStyles}
                  onBasculerFavori={(id) => setFavorisStyles((f) => (
                    f.includes(id) ? f.filter((x) => x !== id) : [...f, id]
                  ))}
                  onChoisir={(id) => {
                    modifier({
                      typographie: { ...brouillon.typographie, styleTexteId: id },
                    });
                    setRecentsStyles((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
                  }}
                />
                {/* ── DEUX ANIMATIONS QUI NE FONT PAS LA MÊME CHOSE ────
                    « Mouvement » déplace le bloc entier ; « Apparition »
                    révèle les mots un à un. Elles se cumulent, donc elles
                    sont DEUX réglages nommés — les fondre en une seule liste
                    obligerait à choisir entre monter et s'écrire. */}
                <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Mouvement du bloc
                </p>
                <BibliothequeAnimationsTexte
                  animationActive={brouillon.animations.texteId}
                  exemple={brouillon.texte.titre ?? undefined}
                  couleur={brouillon.couleurs.texte ?? '#FFFFFF'}
                  favoris={favorisAnimations}
                  recents={recentsAnimations}
                  onBasculerFavori={(id) => setFavorisAnimations((f) => (
                    f.includes(id) ? f.filter((x) => x !== id) : [...f, id]
                  ))}
                  onChoisir={(id) => {
                    modifier({
                      animations: { ...brouillon.animations, texteId: id },
                    });
                    setRecentsAnimations((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
                  }}
                />

                <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Apparition du texte
                </p>
                <BibliothequeAnimationsContenu
                  animationActive={brouillon.animations.texteContenuId}
                  exemple={brouillon.texte.titre ?? undefined}
                  couleur={brouillon.couleurs.texte ?? '#FFFFFF'}
                  favoris={favorisContenu}
                  recents={recentsContenu}
                  onBasculerFavori={(id) => setFavorisContenu((f) => (
                    f.includes(id) ? f.filter((x) => x !== id) : [...f, id]
                  ))}
                  onChoisir={(id) => {
                    modifier({
                      animations: { ...brouillon.animations, texteContenuId: id },
                    });
                    setRecentsContenu((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
                  }}
                />

                <ColorWheel
                  color={brouillon.couleurs.texte ?? '#FFFFFF'}
                  onChange={(c) => modifier({
                    couleurs: { ...brouillon.couleurs, texte: c },
                  })}
                  label="Couleur du texte"
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {ANCRES_TEXTE.map((a) => (
                    <button
                      key={a}
                      type="button"
                      data-mon-style-texte-position={a}
                      aria-pressed={brouillon.texte.position === a}
                      onClick={() => modifier({
                        texte: { ...brouillon.texte, position: a },
                      })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] transition ${
                        brouillon.texte.position === a
                          ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      {LIBELLES_ANCRE[a]}
                    </button>
                  ))}
                </div>

                {/* ── Timing, en secondes et rien d'autre ──────────────── */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] text-gray-400">
                    Début <span className="text-gray-500">{brouillon.texte.debutSecondes} s</span>
                    <input
                      type="range" min={0} max={20} step={1}
                      value={brouillon.texte.debutSecondes}
                      data-mon-style-texte-debut
                      onChange={(e) => modifier({
                        texte: { ...brouillon.texte, debutSecondes: Number(e.target.value) },
                      })}
                      className="mt-1 w-full accent-purple-500"
                    />
                  </label>
                  <label className="block text-[11px] text-gray-400">
                    Durée <span className="text-gray-500">{brouillon.texte.dureeSecondes} s</span>
                    <input
                      type="range" min={1} max={20} step={1}
                      value={brouillon.texte.dureeSecondes}
                      data-mon-style-texte-duree
                      onChange={(e) => modifier({
                        texte: { ...brouillon.texte, dureeSecondes: Number(e.target.value) },
                      })}
                      className="mt-1 w-full accent-purple-500"
                    />
                  </label>
                </div>

                {/* ── Ce que le CTA DIT ────────────────────────────────────
                    ⚠️ CECI N'EST PAS DU STYLE, ET C'EST ASSUMÉ. Le message
                    appartient à l'objectif — le dépôt le dit depuis toujours :
                    changer « Réserve ta place » ne doit pas rejouer un style.
                    Il est édité ici parce que c'est là qu'on règle ce qui
                    s'affiche, mais il est ENREGISTRÉ dans l'objectif. */}
                {brouillon.ctaVisuel.actif && onEnregistrerAppelAction && (
                  <div className="space-y-2 rounded-lg border border-gray-800 p-2">
                    <ChampTexte
                      libelle="Texte du bandeau"
                      marqueur="cta-texte"
                      exemple="Réserve ton cours d’essai"
                      valeur={appel.texte ?? ''}
                      max={LONGUEURS_MAX.cta}
                      onChange={(v) => setAppel({ ...appel, texte: v || null })}
                    />
                    <ChampTexte
                      libelle="Lien ou identifiant"
                      marqueur="cta-lien"
                      exemple="afroboost.com"
                      valeur={appel.destination ?? ''}
                      max={LONGUEURS_MAX.lien}
                      onChange={(v) => setAppel({ ...appel, destination: v || null })}
                    />
                    <p className="text-[10px] text-gray-500">
                      Ce message appartient à ton objectif : il suit tes vidéos,
                      quel que soit le style.
                    </p>
                  </div>
                )}

                <ApercuStyleTexte
                  profil={brouillon}
                  appelAction={brouillon.ctaVisuel.actif ? appel : null}
                  format={format}
                  marges={brouillon.margesSures}
                  dureeSecondes={dureeMontageSecondes}
                  analyseApercuId={analyseApercuId}
                />
              </div>
            )}
          </section>

          {/* ── CTA VISUEL ────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-gray-400">Bandeau de fin</p>
              <button
                type="button"
                role="switch"
                aria-checked={brouillon.ctaVisuel.actif}
                data-mon-style-cta-actif
                onClick={() => modifier({
                  ctaVisuel: { ...brouillon.ctaVisuel, actif: !brouillon.ctaVisuel.actif },
                })}
                // ⚠️ `py-1.5`, ET NON `py-0.5`. Mesure au banc responsive :
                // l'interrupteur ne faisait que 19 px de haut, sous le seuil
                // ou un doigt le vise sans le rater. Le texte reste petit ;
                // c'est la CIBLE qui grandit.
                className={`rounded-full px-2.5 py-1.5 text-[10px] leading-none transition ${
                  brouillon.ctaVisuel.actif
                    ? 'bg-purple-500/20 text-purple-300'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {brouillon.ctaVisuel.actif ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            {/* ⚠️ « Bandeau » ET NON « CTA » : ce qui est rendu aujourd'hui est
                une forme coloree, sans un mot de texte — les polices ne sont
                pas licenciees. Le nommer CTA laisserait attendre une phrase. */}
            <p className="mt-1 text-[11px] text-gray-500">
              Une bande de couleur sur la fin de la vidéo. Le texte arrivera plus tard.
            </p>
            {brouillon.ctaVisuel.actif && (
              <div className="mt-2 space-y-2">
                <ColorWheel
                  color={brouillon.couleurs.accent ?? '#7C3AED'}
                  onChange={(c) => modifier({
                    couleurs: { ...brouillon.couleurs, accent: c },
                  })}
                  label="Couleur"
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {ANCRES_TEXTE.map((a) => (
                    <button
                      key={a}
                      type="button"
                      data-mon-style-cta-position={a}
                      aria-pressed={brouillon.ctaVisuel.position === a}
                      onClick={() => modifier({
                        ctaVisuel: { ...brouillon.ctaVisuel, position: a },
                      })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] transition ${
                        brouillon.ctaVisuel.position === a
                          ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      {LIBELLES_ANCRE[a]}
                    </button>
                  ))}
                </div>
                <label className="block text-[11px] text-gray-400">
                  Durée <span className="text-gray-500">{brouillon.ctaVisuel.dureeSecondes} s</span>
                  <input
                    type="range" min={1} max={10} step={1}
                    value={brouillon.ctaVisuel.dureeSecondes}
                    data-mon-style-cta-duree
                    onChange={(e) => modifier({
                      ctaVisuel: { ...brouillon.ctaVisuel, dureeSecondes: Number(e.target.value) },
                    })}
                    className="mt-1 w-full accent-purple-500"
                  />
                </label>
              </div>
            )}
          </section>

          {/* ── TRANSITIONS ───────────────────────────────────────────── */}
          <section>
            <p className="mb-1.5 text-[11px] font-medium text-gray-400">Transitions</p>
            <div className="grid grid-cols-3 gap-1.5">
              {TRANSITIONS_RENDUES.map((id) => {
                const t = transitionParId(id);
                const actif = id === 'cut'
                  ? !brouillon.transitions.active
                  : brouillon.transitions.active && brouillon.transitions.transitionId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-mon-style-transition={id}
                    aria-pressed={actif}
                    onClick={() => modifier({
                      transitions: id === 'cut'
                        ? { ...brouillon.transitions, active: false, transitionId: 'cut' }
                        : { ...brouillon.transitions, active: true, transitionId: id },
                    })}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] transition ${
                      actif
                        ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                        : 'border-gray-800 text-gray-400 hover:border-gray-700'
                    }`}
                  >
                    {t?.nom ?? id}
                  </button>
                );
              })}
            </div>
            {brouillon.transitions.active && (
              <label className="mt-2 block text-[11px] text-gray-400">
                Durée <span className="text-gray-500">{brouillon.transitions.dureeMs} ms</span>
                <input
                  type="range" min={0} max={1000} step={50}
                  value={brouillon.transitions.dureeMs}
                  data-mon-style-transition-duree
                  onChange={(e) => modifier({
                    transitions: { ...brouillon.transitions, dureeMs: Number(e.target.value) },
                  })}
                  className="mt-1 w-full accent-purple-500"
                />
              </label>
            )}
          </section>

          {/* ── LE GESTE EXPLICITE ────────────────────────────────────── */}
          <div className="pt-1">
            <button
              type="button"
              onClick={enregistrer}
              disabled={enregistrement}
              data-mon-style-enregistrer
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40"
            >
              {enregistrement && <Loader2 className="w-3 h-3 animate-spin" />}
              {enregistre && !enregistrement && <Check className="w-3 h-3" />}
              {enregistre && !enregistrement
                ? 'Enregistré'
                : 'Enregistrer comme mon style par défaut'}
            </button>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Tant que tu ne l’enregistres pas, rien ne change pour ton compte.
            </p>
          </div>
        </div>
      )}

      <MediaLibrary
        isOpen={libOuverte}
        onClose={() => setLibOuverte(false)}
        mediaType="image"
        onSelect={(url) => {
          setLibOuverte(false);
          const objet = objetDepuisUrl(url);
          // Une adresse hors mediatheque ne peut pas devenir un logo : le
          // serveur la refuserait, et l'accepter ici afficherait un reglage
          // qui echouerait plus tard sans explication.
          if (!objet) return;
          modifier({
            marque: {
              ...brouillon.marque,
              logoActif: true,
              logo: { bucket: objet.bucket as (typeof BUCKETS_LOGO)[number], cle: objet.cle },
            },
          });
        }}
      />
    </div>
  );
}
