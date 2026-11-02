'use client';

/**
 * CINEMA IA — LE PORTRAIT D'UN PERSONNAGE : sa vraie photo de reference, sinon une icone neutre.
 *
 * ⚠️ AUCUN FAUX VISAGE. L'image vient de la reference ACTIVE importee dans Cinema IA
 * (`/api/cinema/films/:id/references/:personnageId`) ; sans reference, ou si le fichier ne se
 * charge pas, c'est une icone neutre — jamais un visage genere, jamais une initiale deguisee en
 * photo. Afficher un portrait ne declenche AUCUN appel IA : c'est une simple lecture d'image.
 */
import { useState } from 'react';
import { User } from 'lucide-react';

export interface PortraitDonnees {
  id: string;
  nom: string;
  references: Array<{ id: string; urlImage?: string | null }>;
  referenceActiveId: string | null;
}

/** La reference active porte-t-elle un visuel importe ? */
export function aUnePhoto(p: PortraitDonnees): boolean {
  const active = p.references.find((r) => r.id === p.referenceActiveId) ?? p.references[p.references.length - 1];
  return !!active?.urlImage;
}

export default function PortraitPersonnage({ filmId, personnage, selectionne, surClic, taille = 32 }: {
  filmId: string;
  personnage: PortraitDonnees;
  selectionne: boolean;
  /** Absent : portrait decoratif, sans bouton. */
  surClic?: () => void;
  taille?: number;
}) {
  const [casse, setCasse] = useState(false);
  const photo = aUnePhoto(personnage) && !casse;
  const titre = photo
    ? `${personnage.nom}${surClic ? (selectionne ? ' — present dans ce plan (cliquer pour retirer)' : ' — cliquer pour l’ajouter a ce plan') : ''}`
    : `${personnage.nom} — aucune photo de reference${surClic ? (selectionne ? ' · present dans ce plan' : ' · cliquer pour l’ajouter a ce plan') : ''}`;
  const contenu = photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/cinema/films/${filmId}/references/${personnage.id}`}
      alt=""
      aria-hidden="true"
      onError={() => setCasse(true)}
      className="h-full w-full object-cover"
    />
  ) : (
    <User className="h-1/2 w-1/2 text-slate-500" aria-hidden="true" />
  );
  const classe = `relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-slate-900 transition-opacity ${
    selectionne ? 'border-violet-400' : 'border-slate-700 opacity-60 hover:opacity-100'
  } ${photo ? '' : 'border-dashed'}`;
  const style = { width: taille, height: taille };
  if (!surClic) return <span className={classe} style={style} title={titre} data-portrait={photo ? 'photo' : 'neutre'}>{contenu}</span>;
  return (
    <button
      type="button"
      onClick={surClic}
      aria-pressed={selectionne}
      aria-label={`${personnage.nom}${selectionne ? ', present dans ce plan' : ''}`}
      title={titre}
      data-portrait={photo ? 'photo' : 'neutre'}
      className={classe}
      style={style}
    >
      {contenu}
    </button>
  );
}
