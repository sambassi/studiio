#!/usr/bin/env node
/**
 * LE PROXY LOCAL DEVANT POSTGREST — l'equivalent de `studiio-pgrst-proxy`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POURQUOI IL EST INDISPENSABLE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `supabase-js` ne parle pas a PostgREST directement : il prefixe TOUTES ses
 * requetes de table par `/rest/v1`. Un PostgREST nu repond alors « Invalid path
 * specified in request URL », et l'application lit ce refus comme une colonne
 * manquante — le diagnostic part dans une mauvaise direction pendant une heure.
 *
 * La production a la meme piece : CLAUDE.md decrit `studiio-pgrst-proxy` comme
 * « proxy devant PostgREST ». Ce fichier est sa contrepartie locale, et rien de
 * plus : il retire le prefixe et transmet.
 *
 * ⚠️ IL N'AJOUTE, NE RETIRE NI NE REECRIT AUCUN EN-TETE. L'authentification,
 * les droits et le format des reponses restent entierement l'affaire de
 * PostgREST : un proxy qui bricole un `Authorization` en passant deviendrait
 * une autorite de securite que personne n'a auditee.
 *
 * ⚠️ ET IL N'ECOUTE QUE SUR LA BOUCLE LOCALE. Il est devant une base de
 * developpement dont le role de service traverse RLS ; l'exposer au reseau
 * reviendrait a publier la base.
 *
 * Usage : pgrst-proxy.cjs <portEcoute> <portPostgREST>
 */
'use strict';

const http = require('http');

const PORT_ECOUTE = Number(process.argv[2] || 3011);
const PORT_AMONT = Number(process.argv[3] || 3012);
const HOTE = '127.0.0.1';

/** Le prefixe que `supabase-js` ajoute et que PostgREST ne connait pas. */
const PREFIXE = '/rest/v1';

const serveur = http.createServer((requete, reponse) => {
  const chemin = requete.url.startsWith(PREFIXE)
    ? requete.url.slice(PREFIXE.length) || '/'
    : requete.url;

  const amont = http.request(
    { host: HOTE, port: PORT_AMONT, method: requete.method, path: chemin, headers: requete.headers },
    (reponseAmont) => {
      reponse.writeHead(reponseAmont.statusCode, reponseAmont.headers);
      reponseAmont.pipe(reponse);
    },
  );

  /* Une panne d'amont est dite telle quelle. Repondre 200 avec un corps vide
     ferait lire « aucune ligne » la ou il faut lire « base injoignable ». */
  amont.on('error', (err) => {
    reponse.writeHead(502, { 'Content-Type': 'application/json' });
    reponse.end(JSON.stringify({ message: `PostgREST injoignable : ${err.message}` }));
  });

  requete.pipe(amont);
});

serveur.listen(PORT_ECOUTE, HOTE, () => {
  console.log(`pgrst-proxy: http://${HOTE}:${PORT_ECOUTE}${PREFIXE} -> http://${HOTE}:${PORT_AMONT}`);
});
