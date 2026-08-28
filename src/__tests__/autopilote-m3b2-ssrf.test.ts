/**
 * Le contenu d'un rush ne doit pas pouvoir faire ouvrir autre chose.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'URL EST SÛRE, L'OCTET NE L'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'URL donnée à ffmpeg n'est contrôlable par personne : l'hôte vient de
 * `MINIO_ENDPOINT`, le compartiment de `bucketAutorise`, la clé de la base
 * filtrée par `user_id` et forcée au préfixe `<userId>/`, avec `..` et `://`
 * refusés. Cet axe-là est fermé, et les tests du moteur le vérifient déjà.
 *
 * Mais le CONTENU du fichier est intégralement choisi par l'utilisateur :
 * il téléverse ce qu'il veut sous `media/<userId>/rush/…`. Un fichier
 * reconnu comme playlist HLS ou comme `ffconcat` fait ouvrir à ffmpeg des
 * ressources IMBRIQUÉES, dont l'adresse est écrite DANS le fichier. Le
 * conteneur partage son réseau Docker avec `studiio-postgrest:3000` et
 * `studiio-db` : c'est une porte de SSRF, et `file:` serait une lecture de
 * fichier local.
 *
 * ⚠️ Les ffmpeg récents refusent déjà certaines de ces combinaisons. Mais
 * c'est une propriété du binaire installé, pas une décision de ce code — et
 * une garantie qui dépend d'une version d'un paquet Debian n'est pas une
 * garantie. La liste blanche la rend explicite, et ne coûte qu'un argument.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(
  resolve(__dirname, '../lib/autopilot/analyse/extraction.ts'), 'utf-8',
);

describe('Les protocoles que ffmpeg peut ouvrir sont énumérés', () => {
  it('la liste ne contient QUE du réseau sortant', async () => {
    const { PROTOCOLES_AUTORISES } = await import('@/lib/autopilot/analyse/extraction');
    const protocoles = PROTOCOLES_AUTORISES.split(',');
    expect(protocoles.sort()).toEqual(['http', 'https', 'tcp', 'tls']);
    // Ceux qui liraient le disque ou enchaîneraient des ressources locales.
    for (const interdit of ['file', 'concat', 'subfile', 'pipe', 'data', 'unix', 'fd']) {
      expect(protocoles, interdit).not.toContain(interdit);
    }
  });

  it('CHACUNE des trois invocations la pose — aucune exception', () => {
    // Une seule invocation oubliée suffirait : la sonde, le repli et les
    // vignettes lisent tous les trois le fichier de l'utilisateur.
    const invocations = source.match(/'-i', url,/g) ?? [];
    const listes = source.match(/'-protocol_whitelist', PROTOCOLES_AUTORISES,/g) ?? [];
    expect(invocations.length).toBe(3);
    expect(listes.length).toBe(invocations.length);
  });

  it('elle est posée AVANT `-i`, sinon ffmpeg l ignore', () => {
    // Les options de protocole s'appliquent à l'entrée qui les suit. Après
    // `-i`, elles concerneraient une sortie qui n'existe pas.
    let depuis = 0;
    for (let i = 0; i < 3; i += 1) {
      const posListe = source.indexOf("'-protocol_whitelist'", depuis);
      const posEntree = source.indexOf("'-i', url,", depuis);
      expect(posListe, `invocation ${i + 1}`).toBeGreaterThan(-1);
      expect(posEntree, `invocation ${i + 1}`).toBeGreaterThan(posListe);
      depuis = posEntree + 1;
    }
  });

  it('elle est une constante partagée, jamais recopiée', () => {
    // Trois littéraux divergeraient au premier ajout de protocole.
    expect(source).toContain('export const PROTOCOLES_AUTORISES');
    const litteraux = source.match(/'-protocol_whitelist',\s*'/g) ?? [];
    expect(litteraux).toHaveLength(0);
  });
});
