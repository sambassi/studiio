'use client';

/**
 * A_1b — L'APERÇU DU STYLE TEXTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL APPELLE LA FONCTION DU MOTEUR, IL NE LA RÉIMPLÉMENTE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `preparerCouches` et `positionY` sont EXACTEMENT celles que `rendu.ts`
 * utilise pour fabriquer les `drawtext`. C'est ce qui rend cet aperçu fidèle
 * par construction plutôt que par relecture : si le moteur cesse de dessiner
 * une couche — CTA inactif, texte vide, objectif muet — elle disparaît ici
 * aussi, sans qu'aucune ligne de ce fichier n'ait à le savoir.
 *
 * Un aperçu qui recopierait les règles finirait par mentir : il montrerait un
 * texte que le rendu ne produit plus, et personne ne s'en apercevrait avant
 * d'ouvrir le MP4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE PROMET PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni animation, ni transition, ni LUT, ni sous-titres : le moteur ne les rend
 * pas encore. L'en-tête dit « Aperçu du style », pas « rendu final » — une
 * fausse promesse coûte plus cher qu'une absence.
 *
 * Les polices sont des APPROXIMATIONS CSS des trois familles serveur
 * (Liberation Sans/Serif/Mono). Le navigateur n'a pas ces fichiers ; il a des
 * équivalents métriques très proches, et c'est dit à l'écran.
 */
import { useMemo } from 'react';
import {
  preparerCouches, positionY, type SourcesTexte, type PoliceRendu,
} from '@/lib/autopilot/analyse/rendu-texte';

/** Les trois formats, et leur ratio — les mêmes que le contrat de montage. */
const RATIOS: Record<string, [number, number]> = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
};

/**
 * L'approximation navigateur de chaque famille serveur.
 *
 * Liberation Sans/Serif/Mono sont métriquement compatibles avec
 * Arial/Times/Courier : ce sont donc les piles les plus proches de ce que le
 * serveur dessinera, et non un choix esthétique.
 */
const PILES: Record<PoliceRendu, string> = {
  sans: 'Liberation Sans, Arial, Helvetica, sans-serif',
  serif: 'Liberation Serif, Times New Roman, Times, serif',
  mono: 'Liberation Mono, Courier New, Courier, monospace',
};

export interface ApercuStyleTexteProps {
  profil: SourcesTexte['profil'];
  appelAction: SourcesTexte['appelAction'];
  /** `9:16`, `1:1` ou `16:9`. Une valeur inconnue retombe sur `9:16`. */
  format: string;
  /** Les marges sûres du profil, en pourcentage. */
  marges: { hautPct: number; basPct: number; gauchePct: number; droitePct: number };
  /** La durée du montage, qui borne les timings. */
  dureeSecondes: number;
  /** L'analyse du rush choisi : sa vignette sert de fond. */
  analyseApercuId?: string | null;
}

export default function ApercuStyleTexte({
  profil, appelAction, format, marges, dureeSecondes, analyseApercuId = null,
}: ApercuStyleTexteProps) {
  const [largeur, hauteur] = RATIOS[format] ?? RATIOS['9:16'];

  /* ⚠️ LA MÊME FONCTION QUE LE MOTEUR. Les couches affichées ici sont, à la
     couche près, celles que `drawtext` dessinera. */
  const couches = useMemo(
    () => preparerCouches({ profil, appelAction, dureeTotaleSecondes: dureeSecondes }),
    [profil, appelAction, dureeSecondes],
  );

  const margeHaut = (hauteur * Math.max(0, marges.hautPct)) / 100;
  const margeBas = (hauteur * Math.max(0, marges.basPct)) / 100;
  const margeGauche = (largeur * Math.max(0, marges.gauchePct)) / 100;
  const margeDroite = (largeur * Math.max(0, marges.droitePct)) / 100;

  const image = analyseApercuId !== null
    ? `/api/autopilot/analyses/${analyseApercuId}/vignettes/0`
    : null;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-gray-400">Aperçu du style</p>
        <p className="text-[10px] text-gray-500">{format}</p>
      </div>
      <div
        data-apercu-style
        data-apercu-format={format}
        data-apercu-couches={couches.length}
        className="relative mx-auto overflow-hidden rounded-lg border border-white/10 bg-black/40"
        /* `containerType: 'size'` rend `cqh` utilisable : la taille du texte
           suit alors la hauteur du CADRE, comme elle suivra celle de la
           video. Sans lui, `cqh` ne resout rien et le texte sort en 0. */
        style={{
          aspectRatio: `${largeur} / ${hauteur}`,
          width: '100%',
          maxWidth: 190,
          containerType: 'size',
        }}
      >
        {image !== null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            data-apercu-fond
            className="absolute inset-0 h-full w-full object-cover opacity-70"
          />
        )}
        {/* Les marges sûres, dessinées : on voit POURQUOI un texte ne descend
            pas plus bas, au lieu de le deviner. */}
        <div
          data-apercu-marges
          className="pointer-events-none absolute border border-dashed border-white/15"
          style={{
            top: `${marges.hautPct}%`,
            bottom: `${marges.basPct}%`,
            left: `${marges.gauchePct}%`,
            right: `${marges.droitePct}%`,
          }}
        />
        {/* Le bandeau du CTA, s'il est actif : le texte doit se lire PAR-DESSUS,
            exactement comme le moteur les superpose. */}
        {profil?.ctaVisuel.actif && (
          <div
            data-apercu-bandeau
            className="absolute left-0 right-0"
            style={{
              height: '12%',
              backgroundColor: profil.couleurs.accent ?? '#7C3AED',
              top: profil.ctaVisuel.position === 'haut' ? `${marges.hautPct}%`
                : profil.ctaVisuel.position === 'centre' ? '44%' : undefined,
              bottom: profil.ctaVisuel.position === 'bas' ? `${marges.basPct}%` : undefined,
            }}
          />
        )}
        {couches.map((c, i) => {
          const taillePx = (hauteur * c.taillePct) / 100;
          const y = positionY(c.ancre, hauteur, Math.round(taillePx * 1.2), {
            haut: margeHaut, bas: margeBas,
          });
          return (
            <p
              key={`${c.nature}-${i}`}
              data-apercu-couche={c.nature}
              className="absolute text-center leading-tight"
              style={{
                top: `${(y / hauteur) * 100}%`,
                left: `${(margeGauche / largeur) * 100}%`,
                right: `${(margeDroite / largeur) * 100}%`,
                fontFamily: PILES[c.police],
                fontWeight: c.graisse === 'grasse' ? 700 : 400,
                // La taille suit la hauteur du CADRE D'APERÇU, comme elle
                // suivra celle de la vidéo : le même pourcentage des deux côtés.
                fontSize: `${c.taillePct}cqh`,
                color: c.couleur,
                textShadow: '2px 2px 2px rgba(0,0,0,0.65)',
              }}
            >
              {c.texte}
            </p>
          );
        })}
        {couches.length === 0 && (
          <p
            data-apercu-vide
            className="absolute inset-0 flex items-center justify-center px-3 text-center text-[10px] text-gray-500"
          >
            Aucun texte configuré
          </p>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-gray-500">
        {/* ⚠️ DIRE CE QUE L'APERÇU N'EST PAS. Promettre le rendu final ferait
            passer chaque écart pour un bug. */}
        Position, couleurs et tailles sont celles du rendu. Les polices sont
        approchées par le navigateur, et les animations n’y sont pas encore.
      </p>
    </div>
  );
}
