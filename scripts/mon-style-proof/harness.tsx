/**
 * Banc d'essai RESPONSIVE de « Mon style ».
 *
 * Monte le VRAI composant, avec les VRAIES classes Tailwind du projet, dans un
 * navigateur reel. Une assertion sur des noms de classes ne dirait rien : ce
 * qu'on veut savoir, c'est si la page deborde et si les commandes restent
 * atteignables a 375 px de large.
 */
import { createRoot } from 'react-dom/client';
import MonStylePanel from '@/components/creer/MonStylePanel';

// La mediatheque interroge le reseau ; ce banc n'a pas d'API.
window.fetch = (async () => new Response(JSON.stringify({ files: [] }), {
  headers: { 'Content-Type': 'application/json' },
})) as typeof fetch;

const racine = document.getElementById('racine')!;
createRoot(racine).render(
  <MonStylePanel
    profilEnregistre={null}
    onEnregistrer={async () => {
      (window as unknown as { __enregistre?: boolean }).__enregistre = true;
      return true;
    }}
  />,
);
