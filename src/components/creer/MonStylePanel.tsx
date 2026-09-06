'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, ImageIcon, Loader2, Palette, Trash2,
} from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import ColorWheel from '@/components/ui/ColorWheel';
import {
  LUTS_AUTORISEES, transitionParId,
} from '@/lib/autopilot/analyse/catalogues-creatifs';
import {
  ANCRES_TEXTE, BUCKETS_LOGO, PROFIL_CREATIF_DEFAUT, POSITIONS_LOGO,
  estProfilHistorique, normaliserProfilCreatif,
  type AncreTexte, type PositionLogo, type ProfilCreatifAutopilote,
} from '@/lib/autopilot/analyse/profil-creatif';
import { TRANSITIONS_RENDUES } from '@/lib/autopilot/analyse/rendu-style';

/**
 * LOT 2B ETAPE 3 — L'ECRAN « MON STYLE ».
 *
 * ---------------------------------------------------------------------------
 * ⚠️ IL N'AFFICHE QUE CE QUI EST REELLEMENT RENDU
 * ---------------------------------------------------------------------------
 *
 * Le contrat accepte sept transitions ; le moteur n'en rend que trois
 * (`TRANSITIONS_RENDUES`). Les quatre autres deviennent `cut`. Les proposer
 * ici donnerait un reglage choisi et sans effet — et l'utilisateur passerait
 * son temps a chercher pourquoi son whip pan ne se voit pas.
 *
 * La liste vient donc de `TRANSITIONS_RENDUES`, exportee par le moteur
 * lui-meme, et non d'une seconde liste ecrite a la main : le jour ou `zoom`
 * sera rendu, il apparaitra ici sans qu'on y touche. C'est le meme
 * raisonnement que `slugPolice`, qui derive du catalogue plutot que de le
 * recopier.
 *
 * Meme regle pour la TYPOGRAPHIE et le TEXTE du CTA : aucune commande n'est
 * proposee, parce que les 52 familles ont `licence: null` et
 * `ressourceServeur: null`. Un selecteur de police qui ne changerait rien au
 * MP4 serait un mensonge d'interface.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ « ENREGISTRER » EST UN GESTE, PAS UN EFFET DE BORD
 * ---------------------------------------------------------------------------
 *
 * Rien ne part vers le serveur tant que le bouton n'est pas presse. Les
 * reglages vivent dans l'etat local ; un essai n'ecrit jamais le style du
 * compte.
 */

/** Les looks, dans l'ordre du catalogue. */
const LOOKS = LUTS_AUTORISEES;

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
  chargement?: boolean;
}

export default function MonStylePanel({
  profilEnregistre, onEnregistrer, chargement = false,
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

  const enregistrer = useCallback(async () => {
    setEnregistrement(true);
    try {
      const ok = await onEnregistrer(brouillon);
      setEnregistre(ok);
    } finally {
      setEnregistrement(false);
    }
  }, [brouillon, onEnregistrer]);

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
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {LOOKS.map((l) => {
                const actif = l.id === 'neutral'
                  ? !brouillon.lut.active
                  : brouillon.lut.active && brouillon.lut.lutId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    data-mon-style-look={l.id}
                    aria-pressed={actif}
                    onClick={() => modifier({
                      lut: l.id === 'neutral'
                        ? { active: false, lutId: null, intensite: 1 }
                        : { active: true, lutId: l.id, intensite: brouillon.lut.intensite || 1 },
                    })}
                    className={`rounded-lg border px-2.5 py-2 text-left transition ${
                      actif
                        ? 'border-purple-500/50 bg-gray-800'
                        : 'border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <span className="block text-[11px] font-medium text-gray-200">{l.nom}</span>
                  </button>
                );
              })}
            </div>
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
