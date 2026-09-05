import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { toAbsoluteMediaUrl } from '@/lib/storage/resolve-url';
import { adressePubliqueValide, mediaPubliable } from '@/lib/social/publishing';

/**
 * P0.1 — L'ADRESSE DONNEE AUX RESEAUX SOCIAUX DOIT ETRE ABSOLUE.
 *
 * ---------------------------------------------------------------------------
 * LA PANNE QUE CES TESTS EXISTENT POUR NE PLUS REVIVRE
 * ---------------------------------------------------------------------------
 *
 * Le 5 septembre 2026, un post planifie a echoue sur les trois reseaux a la
 * fois. Les messages ne se ressemblaient pas :
 *
 *   Instagram : « processing failed after 2 polls. Status: ERROR »
 *   Facebook  : « (#100) No permission to publish the video »
 *   TikTok    : « TikTok not connected »
 *
 * Les deux premiers avaient la MEME cause, et elle n'apparaissait dans aucun
 * des deux messages : `media_url` valait `/storage/v1/object/public/media/...`
 * — un chemin relatif. Les reseaux vont chercher le fichier depuis LEURS
 * serveurs ; un chemin sans hote ne leur dit rien.
 *
 * Rien ne levait cote Studiio : Graph accepte le conteneur, puis echoue en
 * differe. Seul YouTube, qui telecharge les octets lui-meme et dont le `fetch`
 * de Node LEVE sur une URL relative, avait ete corrige — a une seule ligne.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI DES TESTS DE SOURCE EN PLUS DES TESTS DE FONCTION
 * ---------------------------------------------------------------------------
 *
 * L'invariant utile n'est pas « `toAbsoluteMediaUrl` marche » — il marchait
 * deja. C'est « CHAQUE fournisseur passe par la normalisation ». Cela se
 * verifie sur le cablage, pas sur une fonction pure : le fichier
 * `cron/publish/route.ts` est un gestionnaire Next qui tire ffmpeg, `fs` et le
 * stockage, et le monter dans vitest pour observer trois `fetch` couterait
 * plus qu'il ne prouverait. On lit donc la source, comme
 * `autopilote-lot2a-audio.test.ts` le fait deja pour la commande ffmpeg.
 */

const ROUTE = resolve(process.cwd(), 'src/app/api/cron/publish/route.ts');
const source = readFileSync(ROUTE, 'utf8');

const CHEMIN_RELATIF = '/storage/v1/object/public/media/e0575f46/rush/video.mp4';

describe('A/B/C — toAbsoluteMediaUrl : la normalisation elle-meme', () => {
  const ancien = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro'; });
  afterEach(() => {
    if (ancien === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ancien;
  });

  it('A. un chemin relatif de stockage devient une URL absolue Studiio', () => {
    expect(toAbsoluteMediaUrl(CHEMIN_RELATIF))
      .toBe('https://studiio.pro/storage/v1/object/public/media/e0575f46/rush/video.mp4');
  });

  it('B. une URL Studiio deja absolue reste STRICTEMENT identique', () => {
    const deja = 'https://studiio.pro/storage/v1/object/public/media/x/video.mp4';
    expect(toAbsoluteMediaUrl(deja)).toBe(deja);
    // Et deux passages ne doublent jamais l'origine.
    expect(toAbsoluteMediaUrl(toAbsoluteMediaUrl(CHEMIN_RELATIF)))
      .toBe(toAbsoluteMediaUrl(CHEMIN_RELATIF));
    expect(toAbsoluteMediaUrl(toAbsoluteMediaUrl(CHEMIN_RELATIF)))
      .not.toContain('studiio.prohttps://');
  });

  it('C. une URL externe deja absolue n\'est jamais reecrite', () => {
    for (const externe of [
      'https://lhuqdmlkhezdwzwlpfqo.supabase.co/storage/v1/object/public/media/a.mp4',
      'https://cdn.example.org/a.mp4?token=abc',
      'http://exemple.test/a.mov',
    ]) {
      expect(toAbsoluteMediaUrl(externe)).toBe(externe);
    }
  });

  it('une origine configuree avec un slash final ne produit pas de double slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro/';
    expect(toAbsoluteMediaUrl(CHEMIN_RELATIF))
      .toBe('https://studiio.pro/storage/v1/object/public/media/e0575f46/rush/video.mp4');
  });

  it('une chaine vide reste vide — rien a normaliser, rien a inventer', () => {
    expect(toAbsoluteMediaUrl('')).toBe('');
  });
});

describe('D — la garde d\'adresse refuse avant tout appel fournisseur', () => {
  it('refuse le chemin relatif qui a fait echouer les trois reseaux', () => {
    const r = adressePubliqueValide(CHEMIN_RELATIF);
    expect(r.ok).toBe(false);
    expect(r.motif).toContain('adresse publique');
  });

  it.each([
    ['data URL', 'data:video/mp4;base64,AAAA'],
    ['blob URL', 'blob:https://studiio.pro/abc-def'],
    ['chemin local', '/tmp/montage.mp4'],
    ['file://', 'file:///tmp/montage.mp4'],
    ['chaine vide', ''],
    ['espaces', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('refuse %s', (_nom, valeur) => {
    expect(adressePubliqueValide(valeur as string | null | undefined).ok).toBe(false);
  });

  it('accepte une URL absolue http(s), avec ou sans parametres', () => {
    expect(adressePubliqueValide('https://studiio.pro/storage/v1/object/public/m/a.mp4').ok)
      .toBe(true);
    expect(adressePubliqueValide('https://cdn.example.org/a.mp4?token=abc').ok).toBe(true);
    expect(adressePubliqueValide('http://exemple.test/a.mov').ok).toBe(true);
  });

  it('ne juge PAS le conteneur — c\'est le role de `mediaPubliable`', () => {
    // Le cron transcode un WebM en MP4 avant d'appeler Instagram : lui opposer
    // la regle du conteneur AVANT la conversion bloquerait des publications qui
    // aboutissaient. Les deux gardes restent donc distinctes.
    expect(adressePubliqueValide('https://studiio.pro/m/montage.webm').ok).toBe(true);
    expect(mediaPubliable('https://studiio.pro/m/montage.webm').ok).toBe(false);
    // Et `mediaPubliable` refuse toujours, lui aussi, une adresse relative.
    expect(mediaPubliable(CHEMIN_RELATIF).ok).toBe(false);
  });
});

describe('E/F/G/H — chaque fournisseur recoit l\'URL normalisee', () => {
  it('`ensurePublicUrl` se termine par `toAbsoluteMediaUrl`, sans sortie anticipee', () => {
    const bloc = source.slice(
      source.indexOf('async function ensurePublicUrl'),
      source.indexOf('async function publishToInstagram'),
    );
    expect(bloc).toContain('return toAbsoluteMediaUrl(url);');
    // La sortie anticipee qui laissait passer le chemin relatif ne doit pas
    // revenir : c'etait `if (url.includes('/storage/v1/object/public/')) return url;`
    expect(bloc).not.toMatch(/includes\('\/storage\/v1\/object\/public\/'\)\)\s*return url;/);
    // Et le chemin signe est absolutise lui aussi.
    expect(bloc).toContain('return toAbsoluteMediaUrl(data.signedUrl);');
  });

  it('l\'URL est normalisee UNE FOIS, avant la boucle des plateformes', () => {
    expect(source).toContain('videoData.video_url = await ensurePublicUrl(videoData.video_url);');
    const iNormalisation = source.indexOf(
      'videoData.video_url = await ensurePublicUrl(videoData.video_url);',
    );
    const iBoucle = source.indexOf('for (const platform of (post.platforms || []))');
    expect(iNormalisation).toBeGreaterThan(0);
    expect(iNormalisation).toBeLessThan(iBoucle);
  });

  it.each([
    ['E. Instagram', 'publishToInstagram', 'publishToFacebook'],
    ['F. Facebook', 'publishToFacebook', 'publishToTikTok'],
    ['G. TikTok', 'publishToTikTok', 'publishToYouTube'],
    ['H. YouTube', 'publishToYouTube', null],
  ])('%s passe par ensurePublicUrl', (_nom, debut, fin) => {
    const i = source.indexOf(`async function ${debut}`);
    expect(i).toBeGreaterThan(0);
    const j = fin ? source.indexOf(`async function ${fin}`) : source.length;
    const corps = source.slice(i, j);
    expect(corps).toContain('ensurePublicUrl(');
  });

  it('aucun fournisseur ne transmet `video.video_url` brute', () => {
    for (const [nom, cle] of [
      ['Instagram', 'video_url: publishableVideoUrl'],
      ['Facebook', 'file_url: publicUrl'],
    ] as const) {
      expect(source, nom).toContain(cle);
    }
    // TikTok etait le seul a passer la valeur brute.
    expect(source).not.toContain('video_url: video.video_url,');
    expect(source).toContain('video_url: await ensurePublicUrl(video.video_url),');
  });

  it('H. YouTube garde son comportement : telechargement local de l\'URL absolue', () => {
    const i = source.indexOf('async function publishToYouTube');
    const corps = source.slice(i);
    expect(corps).toContain('await ensurePublicUrl(video.video_url)');
    expect(corps).toContain('await fetch(toAbsoluteMediaUrl(publicVideoUrl))');
  });

  it('la garde bloque le fournisseur AVANT l\'appel reseau', () => {
    expect(source).toContain('const adresse = adressePubliqueValide(videoData.video_url);');
    const iGarde = source.indexOf('if (!adresse.ok) {\n            platformResults.push(');
    const iSwitch = source.indexOf("switch (platform.toLowerCase())");
    expect(iGarde).toBeGreaterThan(0);
    expect(iGarde).toBeLessThan(iSwitch);
  });

  it('les canaux sans compte social ne sont pas bloques par la garde media', () => {
    // Email, WhatsApp et afroboost.com publient sans video : la garde est
    // calculee avant la boucle mais appliquee APRES la recherche de compte,
    // que ces canaux ne franchissent jamais.
    const iCanaux = source.indexOf("if (channel === 'email')");
    const iGarde = source.indexOf('if (!adresse.ok) {\n            platformResults.push(');
    expect(iCanaux).toBeGreaterThan(0);
    expect(iCanaux).toBeLessThan(iGarde);
  });
});

describe('I — aucun secret dans les journaux', () => {
  it('le journal de la garde ne montre que le debut de l\'adresse', () => {
    expect(source).toContain("String(videoData.video_url ?? '').slice(0, 32)");
  });

  it('aucun jeton n\'est journalise, meme tronque', () => {
    // ⚠️ CE QUI EST INTERDIT, C'EST LA VALEUR — PAS SA PRESENCE. Le fichier
    // journalise volontairement `hasToken=${!!accessToken}` : un booleen dit
    // tout ce qu'un diagnostic a besoin de savoir, et ne fuit rien. Le test
    // doit donc laisser passer `!!token` et refuser `${token}` ou
    // `${token.slice(...)}`, sans quoi il pousserait a retirer une trace utile.
    const lignesLog = source
      .split('\n')
      .filter((l) => /console\.(log|warn|error)/.test(l));
    const interdits = /\$\{\s*(?!!!)[^}]*\b(accessToken|access_token|freshToken|refresh_token|refreshToken|clientSecret|client_secret)\b[^}]*\}/;
    for (const ligne of lignesLog) {
      expect(ligne, ligne.trim().slice(0, 90)).not.toMatch(interdits);
    }
  });
});
