'use client';

/**
 * Le GUIDE DE CADRAGE du visage : un ovale en pointillés, posé sur l'image.
 *
 * Purement visuel (`aria-hidden`, aucun clic capté) et JAMAIS dans la vidéo :
 * il est dessiné par-dessus l'aperçu, pas dans le flux enregistré ni dans le
 * fichier préparé. Placé un peu au-dessus du centre, comme un visage cadré
 * « épaules comprises ».
 */
export default function OvaleVisage(props: { attribut?: string; legende?: string; voile?: boolean }) {
  return (
    <div
      aria-hidden="true"
      {...{ [props.attribut ?? 'data-ovale-visage']: '' }}
      className="pointer-events-none absolute inset-0 flex flex-col items-center"
    >
      <div
        className="border-2 border-dashed border-white/70"
        style={{ borderRadius: '50%', marginTop: '12%', width: '46%', aspectRatio: '3 / 4', maxHeight: '62%', ...(props.voile === false ? {} : { boxShadow: '0 0 0 9999px rgba(0,0,0,0.18)' }) }}
      />
      {props.legende && (
        <span className="mt-2 rounded-full bg-black/55 px-2.5 py-0.5 text-xs text-white/90">{props.legende}</span>
      )}
    </div>
  );
}

export const GUIDE_TOURNAGE: readonly string[] = [
  'Visage bien éclairé, de face',
  'Caméra stable, à hauteur des yeux',
  'Regardez l’objectif',
  'Évitez le contre-jour (pas de fenêtre derrière vous)',
  'Son clair, endroit calme',
  'Restez dans le cadre du début à la fin',
];
