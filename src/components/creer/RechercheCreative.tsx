'use client';

/**
 * A_3e1 — LA RECHERCHE DANS TOUT LE STUDIO CRÉATIF.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE NE MÉLANGE PAS LES CINQ FAMILLES DANS UNE SEULE LISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « cinéma » trouve un look, deux styles de texte, trois animations et quatre
 * transitions. Les empiler dans une colonne unique obligerait à lire chaque
 * ligne pour savoir de quoi elle parle — et à cliquer une transition en
 * croyant choisir un look. Les résultats sont donc GROUPÉS par famille, avec
 * son libellé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN APPEL RÉSEAU, ET C'EST STRUCTUREL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les cinq catalogues sont des constantes TypeScript déjà chargées avec la
 * page. Chercher est donc un filtre sur un tableau : instantané, hors ligne,
 * et sans une requête par frappe.
 */
import { useMemo } from 'react';
import { Search, Heart } from 'lucide-react';
import { LOOKS_CREATIFS } from '@/lib/creatif/looks';
import { STYLES_TEXTE } from '@/lib/creatif/styles-texte';
import { ANIMATIONS_TEXTE } from '@/lib/creatif/animations-texte';
import { ANIMATIONS_CONTENU } from '@/lib/creatif/animations-contenu';
import { TRANSITIONS_CREATIVES } from '@/lib/creatif/transitions';
import { chercher, trierEntrees, type EntreeCreative } from '@/lib/creatif/catalogue-contrat';
import {
  FAMILLES_BIBLIOTHEQUE, LIBELLES_FAMILLE,
  type FamilleBibliotheque, type FavorisCreatifs,
} from '@/lib/creatif/bibliotheque';

/** Au-delà, la liste cesse d'aider : elle ne fait que défiler. */
export const RESULTATS_MAX_PAR_FAMILLE = 6;

const CATALOGUES: Record<FamilleBibliotheque, readonly EntreeCreative[]> = {
  lut: LOOKS_CREATIFS,
  styleTexte: STYLES_TEXTE,
  animationBloc: ANIMATIONS_TEXTE,
  animationContenu: ANIMATIONS_CONTENU,
  transition: TRANSITIONS_CREATIVES,
};

export interface GroupeResultats {
  famille: FamilleBibliotheque;
  libelle: string;
  entrees: readonly EntreeCreative[];
}

/**
 * Les résultats, groupés par famille — fonction pure, donc testable seule.
 *
 * Une famille sans résultat n'apparaît pas : un titre suivi de rien est du
 * bruit.
 */
export function grouperResultats(requete: string): GroupeResultats[] {
  if (requete.trim() === '') return [];
  const groupes: GroupeResultats[] = [];
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    const trouves = trierEntrees(chercher(CATALOGUES[famille], requete))
      .slice(0, RESULTATS_MAX_PAR_FAMILLE);
    if (trouves.length > 0) {
      groupes.push({ famille, libelle: LIBELLES_FAMILLE[famille], entrees: trouves });
    }
  }
  return groupes;
}

export interface RechercheCreativeProps {
  requete: string;
  onRequete: (v: string) => void;
  favoris: FavorisCreatifs;
  onBasculerFavori: (famille: FamilleBibliotheque, id: string) => void;
  onChoisir: (famille: FamilleBibliotheque, id: string) => void;
}

export default function RechercheCreative({
  requete, onRequete, favoris, onBasculerFavori, onChoisir,
}: RechercheCreativeProps) {
  const groupes = useMemo(() => grouperResultats(requete), [requete]);
  const total = groupes.reduce((n, g) => n + g.entrees.length, 0);

  return (
    <div className="space-y-2" data-recherche-creative data-recherche-total={total}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => onRequete(e.target.value)}
          placeholder="Chercher dans mon studio créatif — cinéma, énergique, doux…"
          data-recherche-creative-champ
          aria-label="Chercher dans mon studio créatif"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      {requete.trim() !== '' && total === 0 && (
        <p data-recherche-creative-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Rien ne correspond dans ton studio créatif.
        </p>
      )}

      {groupes.map((g) => (
        <section key={g.famille} data-recherche-groupe={g.famille}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {g.libelle}
          </p>
          <ul className="space-y-1">
            {g.entrees.map((e) => {
              const favori = favoris[g.famille].includes(e.id);
              return (
                <li key={e.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChoisir(g.famille, e.id)}
                    data-recherche-resultat={`${g.famille}:${e.id}`}
                    title={e.description}
                    className="min-w-0 flex-1 rounded-lg border border-gray-800 px-2 py-1
                      text-left text-[11px] text-gray-300 transition hover:border-gray-700
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                  >
                    <span className="block truncate">{e.nom}</span>
                  </button>
                  {/* Le cœur est le MÊME que dans les grilles : on peut aimer
                      un effet depuis la recherche, sans y aller. */}
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(g.famille, e.id)}
                    aria-pressed={favori}
                    aria-label={favori
                      ? `Retirer ${e.nom} des favoris` : `Ajouter ${e.nom} aux favoris`}
                    data-recherche-favori={`${g.famille}:${e.id}`}
                    className="shrink-0 rounded-full p-1 text-gray-400 transition
                      hover:text-pink-300 focus-visible:outline-none
                      focus-visible:ring-2 focus-visible:ring-purple-500"
                  >
                    <Heart
                      className={`h-3 w-3 ${favori ? 'fill-pink-400 text-pink-400' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
