'use client';

import { useEffect, useRef } from 'react';
import { vitessePrompteur } from '@/lib/avatar/studio';

/**
 * Le PROMPTEUR — une aide visuelle posée PAR-DESSUS l'aperçu caméra, en
 * haut (près de l'objectif, pour garder le regard).
 *
 * ⚠️ Jamais dans la vidéo : l'enregistreur capte le flux de la CAMÉRA, pas
 * l'écran. Ce texte n'est qu'un élément de la page.
 */
export interface ReglagesPrompteur {
  vitesse: number;
  taille: number;
  miroir: boolean;
}
export const REGLAGES_PROMPTEUR_DEFAUT: ReglagesPrompteur = { vitesse: 4, taille: 28, miroir: false };

export default function Prompteur(props: {
  texte: string;
  defilement: boolean;
  reglages: ReglagesPrompteur;
  /** Remis à zéro quand cette clé change (nouvelle prise). */
  cleRemiseAZero: number;
}) {
  const boite = useRef<HTMLDivElement | null>(null);
  const position = useRef(0);

  useEffect(() => {
    position.current = 0;
    if (boite.current) boite.current.scrollTop = 0;
  }, [props.cleRemiseAZero, props.texte]);

  useEffect(() => {
    if (!props.defilement) return;
    let precedent: number | null = null;
    let id = 0;
    const pas = (t: number) => {
      const el = boite.current;
      if (el) {
        if (precedent !== null) {
          position.current = Math.min(el.scrollHeight, position.current + ((t - precedent) / 1000) * vitessePrompteur(props.reglages.vitesse));
          el.scrollTop = position.current;
        }
        precedent = t;
      }
      id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [props.defilement, props.reglages.vitesse]);

  if (!props.texte.trim()) return null;
  return (
    <div
      ref={boite}
      data-prompteur
      data-prompteur-defilement={props.defilement ? 'oui' : 'non'}
      aria-label="Prompteur"
      className="absolute inset-x-0 top-0 h-[45%] overflow-hidden bg-gradient-to-b from-black/80 via-black/55 to-transparent px-5 pt-4 pointer-events-none"
      style={{ transform: props.reglages.miroir ? 'scaleX(-1)' : undefined }}
    >
      <p
        className="text-white font-semibold leading-snug whitespace-pre-wrap text-center drop-shadow"
        style={{ fontSize: props.reglages.taille, paddingBottom: '60%' }}
      >
        {props.texte}
      </p>
    </div>
  );
}
