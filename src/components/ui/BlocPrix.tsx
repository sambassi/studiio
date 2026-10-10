/**
 * Bloc prix posé AU-DESSUS d'un bouton de génération payante.
 *
 * Le prix ne vit plus dans le libellé du bouton : `.button-base` est
 * insécable (`whitespace-nowrap`), et un libellé long (« … prix public
 * 40 crédits · votre coût : 0 ») débordait de sa colonne. Ici chaque ligne
 * est courte et peut revenir à la ligne si la colonne est étroite.
 * La première ligne est le prix ; les suivantes (administrateur) le coût réel.
 */
export default function BlocPrix({ lignes, ...attributs }: { lignes: string[] } & Record<`data-${string}`, string>) {
  return (
    <div {...attributs} className="text-xs leading-snug min-w-0 break-words">
      {lignes.map((l, i) => (
        <div key={l} data-bloc-prix-ligne={i} className={i === 0 ? 'font-medium text-gray-100' : 'text-gray-400'}>{l}</div>
      ))}
    </div>
  );
}
