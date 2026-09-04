'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Eye, Film, Loader2, Plus, Check,
  RotateCcw, ScanSearch,
} from 'lucide-react';
import MenuActions from '@/components/ui/MenuActions';
import { formaterDuree } from '@/lib/autopilot/analyse/rendu-passerelle';
import type { Rush } from '@/lib/autopilot/tournage/contrat';

/**
 * LA BANDE DE RUSHES — HORIZONTALE, VISUELLE, COURTE.
 *
 * ---------------------------------------------------------------------------
 * CE QU'ELLE REMPLACE
 * ---------------------------------------------------------------------------
 *
 * Une liste VERTICALE ou chaque rush deroulait son analyse complete, ses
 * passages, son panneau audio et son propre bouton « Creer ma video ». Trois
 * rushes faisaient donc trois fois tout l'ecran, et il fallait une vingtaine
 * de crans de molette pour atteindre le deuxieme bouton.
 *
 * Ici un rush tient dans une carte : une image, un nom, une duree, un etat,
 * un « ⋯ ». Le reste est derriere ce « ⋯ ». La page ne grandit plus quand on
 * ajoute un rush — elle defile LATERALEMENT.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LA MINIATURE N'EST PAS FABRIQUEE ICI
 * ---------------------------------------------------------------------------
 *
 * L'analyse produit deja huit vignettes par rush et les sert par une route
 * qui recontrole la propriete a chaque requete. En generer d'autres serait
 * payer deux fois pour la meme image. La carte prend donc la vignette 0 de
 * l'analyse du rush, et retombe sur une pellicule quand il n'y en a pas
 * encore — un rush non analyse n'a legitimement pas d'image.
 */

/** Ce que la bande sait d'une analyse, et rien de plus. */
export interface AnalyseCarte {
  id: string;
  etat: string;
  dureeSecondes?: number | null;
}

export interface EnvoiEnCours {
  nom: string;
  pourcent: number;
  erreur?: string;
}

interface Props {
  rushes: Rush[];
  /** L'analyse connue par rush, si elle existe. Sert l'image et l'etat. */
  analyses: Record<string, AnalyseCarte | null>;
  selection: string | null;
  onSelectionner: (rushId: string) => void;
  onVoirAnalyse: (rushId: string) => void;
  onReanalyser: (rushId: string) => void;
  onAjouterFichiers: (fichiers: File[]) => void;
  envois: EnvoiEnCours[];
}

function nomCourt(r: Rush): string {
  const brut = r.nomOrigine || r.cleObjet.split('/').pop() || 'rush';
  // Le prefixe d'horodatage du stockage n'apprend rien a personne.
  return brut.replace(/^\d{10,}-/, '');
}

export default function BandeRushes({
  rushes, analyses, selection, onSelectionner, onVoirAnalyse, onReanalyser,
  onAjouterFichiers, envois,
}: Props) {
  const pisteRef = useRef<HTMLDivElement>(null);
  const fichiersRef = useRef<HTMLInputElement>(null);
  const [debord, setDebord] = useState({ gauche: false, droite: false });
  const [survolFichiers, setSurvolFichiers] = useState(false);
  /** Une vignette peut manquer : on n'insiste pas, on montre la pellicule. */
  const [sansImage, setSansImage] = useState<Record<string, boolean>>({});

  /**
   * ⚠️ LES FLECHES N'APPARAISSENT QUE S'IL Y A REELLEMENT A DEFILER.
   * Deux chevrons inertes sur une bande de deux rushes, c'est deux boutons
   * qui mentent.
   */
  const mesurer = useCallback(() => {
    const el = pisteRef.current;
    if (!el) return;
    setDebord({
      gauche: el.scrollLeft > 4,
      droite: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    mesurer();
    const el = pisteRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', mesurer, { passive: true });
    window.addEventListener('resize', mesurer);
    return () => {
      el.removeEventListener('scroll', mesurer);
      window.removeEventListener('resize', mesurer);
    };
  }, [mesurer, rushes.length]);

  const defiler = (sens: 1 | -1) => {
    pisteRef.current?.scrollBy({ left: sens * 240, behavior: 'smooth' });
  };

  /**
   * Le depot depuis le Finder.
   *
   * ⚠️ `dragleave` PART AUSSI QUAND ON SURVOLE UN ENFANT. Compter les entrees
   * plutot que basculer un booleen evite la drop-zone qui clignote.
   */
  const profondeurRef = useRef(0);
  const surEntree = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    profondeurRef.current += 1;
    setSurvolFichiers(true);
  };
  const surSortie = () => {
    profondeurRef.current = Math.max(0, profondeurRef.current - 1);
    if (profondeurRef.current === 0) setSurvolFichiers(false);
  };
  const surDepot = (e: React.DragEvent) => {
    e.preventDefault();
    profondeurRef.current = 0;
    setSurvolFichiers(false);
    const fs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/'));
    if (fs.length > 0) onAjouterFichiers(fs);
  };

  return (
    <section className="space-y-2" data-bande-rushes>
      <div className="flex items-center justify-between gap-2">
        {/* ⚠️ LE TITRE DIT LE CONTRAT, PAS LA RUBRIQUE. Le moteur monte UN
            rush : « Rushes » laissait croire qu'ils seraient tous utilises,
            et rien a l'ecran ne disait lequel partait au montage. */}
        <h3 className="text-[11px] uppercase tracking-wide text-gray-500">
          Rush utilisé pour cette vidéo
        </h3>
        {(debord.gauche || debord.droite) && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => defiler(-1)}
              disabled={!debord.gauche}
              aria-label="Faire défiler les rushes vers la gauche"
              title="Rushes précédents"
              data-bande-gauche
              className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500
                hover:bg-white/5 hover:text-white disabled:opacity-25 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => defiler(1)}
              disabled={!debord.droite}
              aria-label="Faire défiler les rushes vers la droite"
              title="Rushes suivants"
              data-bande-droite
              className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500
                hover:bg-white/5 hover:text-white disabled:opacity-25 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div
        className="relative"
        onDragEnter={surEntree}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
        }}
        onDragLeave={surSortie}
        onDrop={surDepot}
      >
        <div className="flex items-stretch gap-2">
        <div
          ref={pisteRef}
          data-bande-piste
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1
            [scrollbar-width:thin] [-ms-overflow-style:none]"
        >
          {rushes.map((r) => {
            const a = analyses[r.id];
            const choisi = selection === r.id;
            const nom = nomCourt(r);
            const duree = a?.dureeSecondes ? formaterDuree(a.dureeSecondes) : null;
            const analyse = a?.etat === 'reussie';
            const image = a && !sansImage[r.id]
              ? `/api/autopilot/analyses/${a.id}/vignettes/0`
              : null;
            return (
              <div
                key={r.id}
                data-bande-carte={r.id}
                data-bande-carte-choisie={choisi ? '1' : undefined}
                className={`group relative w-[9.5rem] shrink-0 overflow-hidden rounded-xl border
                  transition-colors ${choisi
                    ? 'border-purple-500/70 bg-purple-500/[0.06]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectionner(r.id)}
                  aria-pressed={choisi}
                  aria-label={choisi
                    ? `${nom} — rush sélectionné pour cette vidéo`
                    : `Utiliser ${nom} pour cette vidéo`}
                  title={choisi ? `${nom} — sélectionné` : `Utiliser ${nom}`}
                  data-bande-choisir={r.id}
                  className="block w-full text-left focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
                >
                  <span
                    className="flex items-center justify-center overflow-hidden bg-black/40"
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {image ? (
                      // Un `<img>` nu : la route sert les octets derriere la
                      // session, l'optimiseur de Next n'aurait qu'un 401.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={() => setSansImage((s) => ({ ...s, [r.id]: true }))}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Film className="h-5 w-5 text-gray-700" aria-hidden="true" />
                    )}
                  </span>
                  {choisi && (
                    <span
                      data-bande-badge
                      className="absolute left-1.5 top-1.5 inline-flex items-center gap-1
                        rounded-full bg-purple-600 px-1.5 py-0.5 text-[9px] font-medium text-white"
                    >
                      <Check className="h-2.5 w-2.5" aria-hidden="true" /> Sélectionné
                    </span>
                  )}
                  <span className="block px-2 pb-2 pt-1.5">
                    <span className="block truncate text-[11px] text-gray-200" title={nom}>
                      {nom}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                      {duree && <span>{duree}</span>}
                      {analyse && (
                        <span className="inline-flex items-center gap-0.5 text-gray-400">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">Analysé</span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <div className="absolute right-0.5 top-0.5">
                  <MenuActions
                    compact
                    marqueur={`rush-${r.id}`}
                    etiquette={`Options du rush — ${nom}`}
                    titreGroupe="Rush"
                    icone={<ScanSearch className="h-3.5 w-3.5" />}
                    actions={[
                      {
                        libelle: 'Voir l’analyse',
                        icone: <Eye className="h-3.5 w-3.5" />,
                        onClick: () => onVoirAnalyse(r.id),
                        desactive: !a,
                      },
                      {
                        libelle: 'Ré-analyser',
                        icone: <RotateCcw className="h-3.5 w-3.5" />,
                        onClick: () => onReanalyser(r.id),
                      },
                    ]}
                  />
                </div>
              </div>
            );
          })}

        </div>

        {/* ⚠️ « AJOUTER » EST HORS DE LA PISTE, ET C'EST TOUT L'OBJET DU
            CORRECTIF. Place a la fin des cartes, il sortait de l'ecran des le
            quatrieme rush : il fallait faire defiler 325 px pour decouvrir
            comment ajouter un rush — mesure en production le 2026-09-04, et
            c'est le seul point qui faisait echouer le test des cinq secondes.
            Le depot par glisser-deposer marchait, mais rien ne le disait.

            Ici, la piste defile et le bouton reste. Il est donc visible quel
            que soit le nombre de rushes, et quel que soit le defilement. */}
        <button
          type="button"
          onClick={() => fichiersRef.current?.click()}
          data-bande-ajouter
          aria-label="Ajouter des rushes"
          title="Ajouter des rushes — ou déposez vos fichiers ici"
          className="mb-1 flex w-[5.5rem] shrink-0 flex-col items-center justify-center gap-1
            rounded-xl border border-dashed border-white/15 bg-white/[0.01]
            text-gray-500 hover:border-purple-500/50 hover:text-gray-300
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500
            transition-colors"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="text-[11px]">Ajouter</span>
        </button>
        </div>

        {/* La drop-zone n'existe QUE pendant le survol : hors de ce moment,
            elle occuperait la place qu'on vient de rendre. */}
        {survolFichiers && (
          <div
            data-bande-depot
            className="pointer-events-none absolute inset-0 flex items-center justify-center
              rounded-xl border-2 border-dashed border-purple-500/70 bg-[#0d0d14]/90
              text-[12px] text-purple-200"
          >
            Déposez vos vidéos ici
          </div>
        )}
      </div>

      <input
        ref={fichiersRef}
        type="file"
        multiple
        accept="video/*"
        data-tournage-fichiers
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = '';
          onAjouterFichiers(fs);
        }}
      />

      {envois.length > 0 && (
        <ul className="space-y-1" data-tournage-envois>
          {envois.map((e) => (
            <li key={e.nom} className="flex items-center gap-2 text-[11px]">
              {e.erreur
                ? <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" aria-hidden="true" />
                : e.pourcent === 100
                  ? <Check className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
                  : <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-500" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-gray-400">{e.nom}</span>
              <span className="text-gray-500">{e.erreur ? e.erreur : `${e.pourcent} %`}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ⚠️ LE DEPOT SE DIT, IL NE SE DEVINE PAS. Une zone qui accepte les
          fichiers sans jamais l'ecrire n'est decouverte que par hasard. Une
          ligne de onze pixels suffit, et elle ne coute pas une carte. */}
      <p className="text-[11px] text-gray-500" data-bande-aide>
        {rushes.length === 0 && envois.length === 0
          ? 'Aucun rush. Déposez vos vidéos ici, ou utilisez « Ajouter ».'
          : 'Déposez vos vidéos ici pour en ajouter.'}
      </p>
    </section>
  );
}
