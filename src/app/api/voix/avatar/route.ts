/**
 * ALIAS NEUTRE. Même gestionnaire que la route historique, sous un chemin qui
 * ne nomme pas le prestataire : le chemin d'une requête est lisible dans
 * l'onglet réseau du navigateur, donc il en fait partie.
 *
 * ⚠️ ADDITIF. La route historique reste en place et répond à l'identique :
 * rien de ce qui l'appelle déjà ne casse. Seuls les appels du navigateur
 * passent par ici.
 */
export { GET, POST } from '@/app/api/tts/heygen/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
