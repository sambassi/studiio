/**
 * QUEL LECTEUR D'ÉTAT UTILISER — le prestataire, ou son double.
 *
 * Le choix est fait ICI, une fois, à partir de la configuration serveur :
 * aucune route ne décide d'appeler l'un ou l'autre, et aucune requête ne
 * peut influencer ce choix.
 */
import { lireEtatDepot, fournisseurSimule } from './client';
import { lecteurSimulePersistant } from './simulateur-persistant';
import { lireDepotLocal } from './depots';
import type { LecteurEtat } from './confirmation';

export function lecteurEtat(env: NodeJS.ProcessEnv = process.env): LecteurEtat {
  if (!fournisseurSimule(env)) {
    return (depositId: string) => lireEtatDepot(depositId, env);
  }
  // Le double a besoin du montant ATTENDU pour qu'une issue « réussie » sans
  // précision soit conforme : il le lit dans NOTRE journal, jamais dans la
  // requête.
  return lecteurSimulePersistant(async (depositId) => {
    const d = await lireDepotLocal(depositId).catch(() => null);
    return d ? { montant: Number(d.montant_local), devise: d.devise } : null;
  });
}
