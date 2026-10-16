// @vitest-environment node
/**
 * M2-b — EXTRACTION LOCALE sur de VRAIS rushes (ffmpeg local), sans aucun
 * envoi : les images produites par la commande partagée avec M3
 * (`extraireImageJpeg`) passent nos gardes JPEG, tiennent sous le plafond de
 * jetons, et les mesures M1 décident de l'appel transcription.
 *
 * Les rushes ne sont pas dans le dépôt : `M2B_RUSHES_DIR` pointe vers un
 * dossier local. Sans lui, le fichier est sauté. Le serveur HTTP est local
 * (127.0.0.1) parce que la commande n'autorise que http/https — exactement
 * comme en production. `fetch` est interdit pendant tout le test.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { extraireImageJpeg, positionsImages, sonder } from '@/lib/autopilot/analyse/extraction';
import { jpegComplet, jpegEnTete } from '@/lib/autopilot/analyse/visuel';
import { dimensionsJpeg, estimerJetonsEntree, JETONS_ENTREE_MAX_RUSH, IMAGES_RUSH_DEFAUT } from '@/lib/creer/analyse-ia-rush';
import { mesurerSourceLue } from '@/lib/creer/analyse-rush-serveur';
import { paroleDepuisEnergie } from '@/lib/creer/fiche-contenu';

const DOSSIER = process.env.M2B_RUSHES_DIR ?? '';
const actif = !!DOSSIER && existsSync(DOSSIER);
const rushes = actif ? readdirSync(DOSSIER).filter((f) => f.endsWith('.mp4')).sort() : [];

let serveur: Server;
let base = '';

describe.skipIf(!actif)('vrais rushes — extraction locale, jamais envoyés', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch interdit'); }));
    serveur = createServer((req, res) => {
      const nom = decodeURIComponent((req.url ?? '/').slice(1));
      const chemin = join(DOSSIER, nom);
      if (!rushes.includes(nom)) { res.statusCode = 404; res.end(); return; }
      const taille = statSync(chemin).size;
      const plage = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (plage) {
        const debut = Number(plage[1]);
        const fin = plage[2] ? Number(plage[2]) : taille - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${debut}-${fin}/${taille}`, 'Accept-Ranges': 'bytes', 'Content-Length': fin - debut + 1, 'Content-Type': 'video/mp4' });
        createReadStream(chemin, { start: debut, end: fin }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': taille, 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' });
        createReadStream(chemin).pipe(res);
      }
    });
    await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  });
  afterAll(async () => { vi.unstubAllGlobals(); await new Promise<void>((r) => serveur.close(() => r())); });

  for (const nom of rushes) {
    it(nom, async () => {
      const url = `${base}/${encodeURIComponent(nom)}`;
      const s = await sonder(url);
      expect(s.ok).toBe(true);
      const duree = s.dureeSecondes!;
      const positions = positionsImages(duree, IMAGES_RUSH_DEFAUT);
      expect(positions.length).toBeLessThanOrEqual(IMAGES_RUSH_DEFAUT);
      const images: Buffer[] = [];
      for (const p of positions) {
        const r = await extraireImageJpeg(url, p);
        expect(r.code, `${nom}@${p}`).toBe(0);
        images.push(r.stdout);
      }
      for (const o of images) {
        expect(jpegEnTete(o) && jpegComplet(o)).toBe(true);
        expect(dimensionsJpeg(o)!.largeur).toBeLessThanOrEqual(640);
      }
      const jetons = estimerJetonsEntree(images);
      expect(jetons).toBeLessThan(JETONS_ENTREE_MAX_RUSH);
      const m1 = await mesurerSourceLue(join(DOSSIER, nom), join(DOSSIER, nom), duree);
      const parole = paroleDepuisEnergie(m1?.echantillons.map((e) => e.audio));
      // eslint-disable-next-line no-console -- relevé local de test, aucun contenu personnel
      process.stdout.write(`[m2b-reel] ${nom} duree=${duree}s images=${images.length} dims=${images.map((o) => { const d = dimensionsJpeg(o)!; return `${d.largeur}x${d.hauteur}`; })[0]} octets=${images.reduce((a, o) => a + o.length, 0)} jetonsEstimes=${jetons} audio=${!!s.technique.codecAudio} parole=${parole} => transcription=${!s.technique.codecAudio || parole === 'improbable' ? 'NON (pas d\'appel)' : 'oui'}\n`);
    }, 120_000);
  }
});
