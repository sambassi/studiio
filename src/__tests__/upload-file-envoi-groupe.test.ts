import { describe, it, expect } from 'vitest';
import {
  runUploadQueue, progressionGlobale, trierFichiersRecus, correspondAccept,
  LIMITES_TAILLE_CLIENT, type ElementEnvoi, type FonctionEnvoi,
} from '@/lib/storage/useUploadQueue';
import { cleObjetStockage, dedupeParCleObjet } from '@/lib/storage/cle-objet-client';
import type { UploadResult } from '@/lib/storage/uploadFile';

/**
 * L'envoi groupé de la Médiathèque — la logique, sans React.
 *
 * Un faux `upload` que le test PILOTE : chaque envoi reste suspendu tant que
 * le test ne le libère pas. C'est ce qui permet d'observer combien tournent
 * en même temps, et non de le supposer.
 */

function fichier(nom: string, taille: number, type = 'video/mp4'): File {
  return new File([new Uint8Array(taille)], nom, { type });
}

function element(nom: string, taille: number, statut: ElementEnvoi['statut'] = 'attente'): ElementEnvoi {
  const file = fichier(nom, taille);
  return { id: `id-${nom}`, file, nom, taille, pourcent: 0, statut };
}

function resultat(nom: string): UploadResult {
  return { publicUrl: `/storage/v1/object/public/media/u/${nom}`, path: `u/${nom}`, bucket: 'media', mode: 'direct' };
}

/** Un envoi pilotable : `demarres` liste l'ordre, `liberer(nom)` le termine. */
function envoiPilote() {
  const enCours = new Map<string, { ok: (r: UploadResult) => void; ko: (e: Error) => void; progress: (p: number) => void }>();
  const demarres: string[] = [];
  let simultanesMax = 0;
  const upload: FonctionEnvoi = (file, { onProgress }) => new Promise<UploadResult>((ok, ko) => {
    demarres.push(file.name);
    enCours.set(file.name, { ok, ko, progress: onProgress });
    simultanesMax = Math.max(simultanesMax, enCours.size);
  });
  const attendre = () => new Promise((r) => setTimeout(r, 0));
  return {
    upload,
    demarres,
    get simultanesMax() { return simultanesMax; },
    get actifs() { return Array.from(enCours.keys()); },
    async progresser(nom: string, p: number) { enCours.get(nom)!.progress(p); await attendre(); },
    async liberer(nom: string) { const e = enCours.get(nom)!; enCours.delete(nom); e.ok(resultat(nom)); await attendre(); },
    async echouer(nom: string, message: string) { const e = enCours.get(nom)!; enCours.delete(nom); e.ko(new Error(message)); await attendre(); },
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe('runUploadQueue — deux à la fois, dans l ordre', () => {
  it('n en lance jamais plus de deux, et respecte l ordre de sélection', async () => {
    const pilote = envoiPilote();
    const items = ['a', 'b', 'c', 'd', 'e'].map((n) => element(n, 10));
    const fin = runUploadQueue(items, { upload: pilote.upload, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 0));

    expect(pilote.actifs).toEqual(['a', 'b']);
    await pilote.liberer('a');
    expect(pilote.actifs).toEqual(['b', 'c']);
    await pilote.liberer('c');
    expect(pilote.actifs).toEqual(['b', 'd']);
    await pilote.liberer('b');
    await pilote.liberer('d');
    await pilote.liberer('e');

    const finaux = await fin;
    expect(pilote.simultanesMax).toBe(2);
    expect(pilote.demarres).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(finaux.map((e) => e.nom)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(finaux.every((e) => e.statut === 'ok' && e.pourcent === 100 && e.resultat)).toBe(true);
  });

  it('un échec reste sur son fichier : les autres aboutissent, le message est celui de l erreur', async () => {
    const pilote = envoiPilote();
    const items = ['a', 'b', 'c'].map((n) => element(n, 10));
    const fin = runUploadQueue(items, { upload: pilote.upload, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 0));

    await pilote.echouer('a', 'Upload échoué (HTTP 502) — la connexion a été coupée avant la fin');
    await pilote.liberer('b');
    await pilote.liberer('c');

    const finaux = await fin;
    expect(finaux.map((e) => e.statut)).toEqual(['erreur', 'ok', 'ok']);
    expect(finaux[0].erreur).toContain('HTTP 502');
    expect(finaux[0].resultat).toBeUndefined();
  });

  it('ne relance QUE les éléments en attente : une réussite antérieure ne repart pas', async () => {
    const pilote = envoiPilote();
    const reussi = { ...element('ok-avant', 10, 'ok'), pourcent: 100, resultat: resultat('ok-avant') };
    const aReprendre = element('echec-avant', 10, 'attente');
    const fin = runUploadQueue([reussi, aReprendre], { upload: pilote.upload, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 0));

    expect(pilote.demarres).toEqual(['echec-avant']);
    await pilote.liberer('echec-avant');
    const finaux = await fin;
    expect(finaux[0]).toEqual(reussi);
    expect(finaux[1].statut).toBe('ok');
  });

  it('un élément annulé avant de partir est marqué sans appeler l envoi', async () => {
    const pilote = envoiPilote();
    const ctrl = new AbortController();
    ctrl.abort();
    const finaux = await runUploadQueue([element('a', 10)], {
      upload: pilote.upload,
      signalPour: () => ctrl.signal,
    });
    expect(pilote.demarres).toEqual([]);
    expect(finaux[0].statut).toBe('erreur');
    expect(finaux[0].erreur).toBe('Annulé');
  });

  it('émet un instantané à chaque changement, avec le pourcentage borné', async () => {
    const pilote = envoiPilote();
    const instantanes: ElementEnvoi[][] = [];
    const fin = runUploadQueue([element('a', 10)], {
      upload: pilote.upload,
      onChange: (l) => instantanes.push(l),
    });
    await new Promise((r) => setTimeout(r, 0));
    await pilote.progresser('a', 42.6);
    await pilote.progresser('a', 140);
    await pilote.liberer('a');
    await fin;
    const pourcents = instantanes.map((l) => `${l[0].statut}:${l[0].pourcent}`);
    expect(pourcents).toEqual(['envoi:0', 'envoi:43', 'envoi:100', 'ok:100']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('progressionGlobale — pondérée par la taille', () => {
  it('un petit fichier fini ne fait pas bondir la barre', () => {
    const petit = { ...element('img', 100, 'ok'), pourcent: 100 };
    const gros = { ...element('rush', 900, 'envoi'), pourcent: 0 };
    const p = progressionGlobale([petit, gros]);
    // 100 octets à 100 % + 900 octets à 0 % = 10 %, et non 50 %.
    expect(p.pourcent).toBe(10);
    expect(p.termines).toBe(1);
    expect(p.total).toBe(2);
    expect(p.echecs).toBe(0);
  });

  it('un envoi en cours compte au prorata, un échec compte comme terminé', () => {
    const a = { ...element('a', 500, 'envoi'), pourcent: 50 };
    const b = { ...element('b', 500, 'erreur'), erreur: 'x' };
    const p = progressionGlobale([a, b]);
    expect(p.pourcent).toBe(25);
    expect(p.termines).toBe(1);
    expect(p.echecs).toBe(1);
  });

  it('liste vide : zéro partout', () => {
    expect(progressionGlobale([])).toEqual({ pourcent: 0, termines: 0, total: 0, echecs: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('trierFichiersRecus — type et taille, sans bloquer les autres', () => {
  it('accepte par préfixe de type, refuse le reste avec une raison', () => {
    const { acceptes, refuses } = trierFichiersRecus(
      [fichier('a.mp4', 10), fichier('b.jpg', 10, 'image/jpeg'), fichier('c.mov', 10, 'video/quicktime')],
      'video/*',
    );
    expect(acceptes.map((f) => f.name)).toEqual(['a.mp4', 'c.mov']);
    expect(refuses.map((r) => r.file.name)).toEqual(['b.jpg']);
    expect(refuses[0].raison).toMatch(/non accepté/);
  });

  it('un fichier au-dessus du plafond de son type est refusé, isolément', () => {
    // On ne fabrique pas 500 Mo : on prend le plafond IMAGE (10 Mo) et on le
    // dépasse d'un octet, avec un objet dont `size` est simulé.
    const trop = fichier('grande.jpg', 1, 'image/jpeg');
    Object.defineProperty(trop, 'size', { value: LIMITES_TAILLE_CLIENT.image + 1 });
    const { acceptes, refuses } = trierFichiersRecus([fichier('ok.jpg', 10, 'image/jpeg'), trop], 'image/*');
    expect(acceptes.map((f) => f.name)).toEqual(['ok.jpg']);
    expect(refuses[0].raison).toContain('10 Mo');
  });

  it('les plafonds sont ceux de la route media (500 / 10 / 50 Mo)', () => {
    expect(LIMITES_TAILLE_CLIENT.video).toBe(500 * 1024 * 1024);
    expect(LIMITES_TAILLE_CLIENT.image).toBe(10 * 1024 * 1024);
    expect(LIMITES_TAILLE_CLIENT.audio).toBe(50 * 1024 * 1024);
  });

  it('« tout » accepte tout', () => {
    expect(correspondAccept(fichier('x.bin', 1, 'application/octet-stream'), '*/*')).toBe(true);
    expect(correspondAccept(fichier('x.mp3', 1, 'audio/mpeg'), 'audio/*')).toBe(true);
    expect(correspondAccept(fichier('x.mp3', 1, 'audio/mpeg'), 'video/*')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('cleObjetStockage / dedupeParCleObjet — la même ressource, plusieurs écritures', () => {
  it('relative, absolue et signée donnent la même clé', () => {
    const cle = 'media/u1/library/x.mp4';
    expect(cleObjetStockage('/storage/v1/object/public/media/u1/library/x.mp4')).toBe(cle);
    expect(cleObjetStockage('https://studiio.pro/storage/v1/object/public/media/u1/library/x.mp4')).toBe(cle);
    expect(cleObjetStockage('https://studiio.pro/storage/v1/object/sign/media/u1/library/x.mp4?token=abc')).toBe(cle);
  });

  it('une URL qui n est pas du stockage n a pas de clé', () => {
    expect(cleObjetStockage('https://cdn.example.com/x.mp4')).toBeNull();
    expect(cleObjetStockage('')).toBeNull();
    expect(cleObjetStockage(null)).toBeNull();
  });

  it('dédoublonne par clé en gardant la PREMIÈRE écriture et l ordre', () => {
    const out = dedupeParCleObjet([
      'https://studiio.pro/storage/v1/object/public/media/u/a.mp4',
      '/storage/v1/object/public/media/u/a.mp4',
      'https://cdn.example.com/b.mp4',
      'https://cdn.example.com/b.mp4',
      'https://studiio.pro/storage/v1/object/public/media/u/c.mp4',
    ]);
    expect(out).toEqual([
      'https://studiio.pro/storage/v1/object/public/media/u/a.mp4',
      'https://cdn.example.com/b.mp4',
      'https://studiio.pro/storage/v1/object/public/media/u/c.mp4',
    ]);
  });

  it('deux objets différents dans le même bucket restent deux', () => {
    expect(dedupeParCleObjet([
      '/storage/v1/object/public/media/u/a.mp4',
      '/storage/v1/object/public/media/u/b.mp4',
    ])).toHaveLength(2);
  });
});
