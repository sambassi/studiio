// @vitest-environment node
/**
 * S1a — SSRF de `localiserProprietesLibres` (`/api/render`, propriétés libres).
 *
 * Aucun appel réseau réel :
 *  - `telechargerSur` est remplacé par un enregistreur qui rejoue le contrôle
 *    RÉEL `verifierCibleSure` (schéma, IP v4/v6, DNS) avec un faux DNS ;
 *  - pour la redirection, le VRAI `telechargerSur` est appelé avec
 *    `http.request` simulé (aucun socket ouvert).
 *
 * Reprend les vecteurs de la preuve S1a (chaînes que Remotion normalise en
 * WHATWG puis télécharge sans filtre IP) : ils sont désormais soit refusés,
 * soit confiés au fetch sûr sous leur forme CANONIQUE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';

const appelsFetchSur: string[] = [];
let modeReel = false;
const DNS_FAUX: Record<string, string[]> = {
  'cdn.public.example': ['93.184.216.34'],
  'interne.example': ['10.0.0.5'],
  'mixte.example': ['93.184.216.34', '10.0.0.5'],
};
const resoudre = async (h: string) => {
  const a = DNS_FAUX[h];
  if (!a) throw new Error('NXDOMAIN');
  return a.map((address) => ({ address, family: 4 }));
};

vi.mock('@/lib/securite/fetch-sur', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/securite/fetch-sur')>();
  return {
    ...reel,
    telechargerSur: vi.fn(async (url: string, local: string, o: Record<string, unknown>) => {
      appelsFetchSur.push(url);
      if (modeReel) return reel.telechargerSur(url, local, o as never);
      await reel.verifierCibleSure(url, { ...o, resoudre } as never);
      await writeFile(local, 'x');
      return { url, octets: 1, typeContenu: null };
    }),
  };
});

import { localiserProprietesLibres } from '@/lib/securite/medias-externes';
import { RefusSsrf } from '@/lib/securite/fetch-sur';

const ORIGINES = ['https://studiio.pro'];
const depot = {
  existe: async () => false,
  deposer: async () => undefined,
  urlPublique: (b: string, c: string) => `https://studiio.pro/storage/v1/object/public/${b}/${c}`,
};
const opts = { depot, origines: ORIGINES, reseau: { resoudre } };
const LOCALISEE = /^https:\/\/studiio\.pro\/storage\//;

/** Toutes les formes dans lesquelles une charge peut arriver. */
const formes = (c: unknown) => [
  { logoUrl: c },
  { niveau: { profond: { backgroundAudio: c } } },
  { backgroundVideos: ['https://cdn.public.example/ok.mp4', c] },
  { clips: [{ src: c }] },
];

beforeEach(() => { appelsFetchSur.length = 0; modeReel = false; });

// ─── 1. Vecteurs de la preuve : http(s) normalisable → fetch sûr, href canonique ──
describe('1. chaînes http(s) non canoniques : normalisées puis confiées au fetch sûr', () => {
  const VERS_10 = {
    espaceTete: ' https://10.0.0.1/x',
    controleC0Tete: '\u0001https://10.0.0.1/x',
    espaceEtC0Fin: 'https://10.0.0.1/x \u0000',
    tabDansSchema: 'ht\ttps://10.0.0.1/x',
    lfApresDeuxPoints: 'https:\n//10.0.0.1/x',
    crDansHote: 'https://10.0.\r0.1/x',
    antislash: 'https:\\\\10.0.0.1\\x',
    sansBarres: 'https:10.0.0.1/x',
  };
  for (const [nom, charge] of Object.entries(VERS_10)) {
    it(`${nom} : le fetch sûr reçoit https://10.0.0.1/x et refuse (ip-interdite), toutes formes`, async () => {
      for (const f of formes(charge)) {
        appelsFetchSur.length = 0;
        await expect(localiserProprietesLibres(f, opts)).rejects.toMatchObject({ name: 'RefusSsrf', motif: 'ip-interdite' });
        expect(appelsFetchSur.at(-1)).toBe('https://10.0.0.1/x');
      }
    });
  }

  it('casse mixte déjà acceptée avant (HtTpS://) : transmise telle quelle, refusée par le fetch sûr', async () => {
    await expect(localiserProprietesLibres({ logoUrl: 'HtTpS://10.0.0.1/x' }, opts)).rejects.toMatchObject({ motif: 'ip-interdite' });
    expect(appelsFetchSur).toEqual(['HtTpS://10.0.0.1/x']);
  });

  it('forme non canonique vers un CDN public : localisée, href canonique transmis', async () => {
    for (const charge of [' https://cdn.public.example/a.png', 'HTTPS:\\\\cdn.public.example\\a.png', 'https:cdn.public.example/a.png', 'ht\ttps://cdn.public.example/a.png']) {
      appelsFetchSur.length = 0;
      const s = await localiserProprietesLibres({ logoUrl: charge }, opts);
      expect(s.logoUrl).toMatch(LOCALISEE);
      expect(s.logoUrl).toMatch(/\.png$/);
      expect(appelsFetchSur).toEqual(['https://cdn.public.example/a.png']);
    }
  });

  it('http(s) impossible à analyser → RefusSsrf url-invalide, 0 appel', async () => {
    for (const charge of ['https://', ' http://[::1', 'https:\\\\']) {
      await expect(localiserProprietesLibres({ logoUrl: charge }, opts)).rejects.toMatchObject({ motif: 'url-invalide' });
    }
    expect(appelsFetchSur).toEqual([]);
  });
});

// ─── 2. Relatifs : jamais confiés à Remotion ────────────────────────────
describe('2. chemins relatifs (/, //, \\, /proxy) : RefusSsrf, 0 appel', () => {
  const RELATIFS = {
    relatifSchema: '//studiio-minio:9000/media/x',
    relatifProxy: '/proxy?src=http%3A%2F%2F10.0.0.1%2Fx&time=0&transparent=false&toneMapped=false',
    proxyMeta: '/proxy?src=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F&time=0&toneMapped=false',
    absoluChemin: '/media/x.mp4',
    antislashRelatif: '\\\\10.0.0.1\\x',
    espaceRelatif: ' \t//10.0.0.1/x',
    tabRelatif: '/\t/10.0.0.1/x',
  };
  for (const [nom, charge] of Object.entries(RELATIFS)) {
    it(nom, async () => {
      for (const f of formes(charge)) {
        await expect(localiserProprietesLibres(f, opts)).rejects.toBeInstanceOf(RefusSsrf);
      }
      expect(appelsFetchSur.filter((u) => !u.includes('cdn.public.example'))).toEqual([]);
    });
  }
});

// ─── 3. Schémas dangereux (liste fermée) ────────────────────────────────
describe('3. schémas dangereux : RefusSsrf schema, premier niveau, imbriqué, tableau', () => {
  const SCHEMAS = ['file', 'data', 'blob', 'javascript', 'vbscript', 'ftp', 'ws', 'wss', 'filesystem', 'about',
    'view-source', 'chrome', 'chrome-extension', 'gopher', 'jar', 'ldap', 'dict', 'smb'];
  const charges: Record<string, string> = {
    fichier: 'file:///etc/passwd',
    data: 'data:image/png;base64,iVBORw0KGgo=',
    blob: 'blob:http://localhost:3000/abc',
    javascript: 'javascript:alert(1)',
    javascriptCasse: ' JavaScript:alert(1)',
    javascriptTab: 'java\tscript:alert(1)',
    viewSource: 'view-source:http://10.0.0.1/',
    ...Object.fromEntries(SCHEMAS.map((s) => [`liste-${s}`, `${s}://10.0.0.1/x`])),
  };
  for (const [nom, charge] of Object.entries(charges)) {
    it(nom, async () => {
      for (const f of formes(charge)) {
        await expect(localiserProprietesLibres(f, opts)).rejects.toMatchObject({ name: 'RefusSsrf', motif: 'schema' });
      }
      expect(appelsFetchSur.filter((u) => !u.includes('cdn.public.example'))).toEqual([]);
    });
  }
});

// ─── 4. Le fetch sûr bloque IP v4/v6, DNS interne, redirection ──────────
describe('4. URL bien formées vers l’interne : refusées par le fetch sûr', () => {
  it.each([
    'http://[::1]/v.mp4',
    'http://[::ffff:10.0.0.1]/v.mp4',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/v.mp4',
    'https://10.0.0.1/x',
    'https://interne.example/v.mp4',
    'https://mixte.example/v.mp4',
  ])('%s → ip-interdite', async (u) => {
    await expect(localiserProprietesLibres({ characterImage: u }, opts)).rejects.toMatchObject({ motif: 'ip-interdite' });
    expect(appelsFetchSur).toHaveLength(1);
  });

  describe('redirection publique → 10.0.0.1 (vrai telechargerSur, http.request simulé)', () => {
    afterEach(() => vi.restoreAllMocks());
    it('le saut privé est refusé AVANT toute requête vers lui', async () => {
      modeReel = true;
      const cibles: string[] = [];
      vi.spyOn(http, 'request').mockImplementation(((o: http.RequestOptions, cb: (r: unknown) => void) => {
        cibles.push(`${o.headers && (o.headers as Record<string, string>).host}${o.path}`);
        const req = new EventEmitter() as EventEmitter & { end: () => void };
        req.end = () => {
          cb(Object.assign(new EventEmitter(), {
            statusCode: 302, headers: { location: 'http://10.0.0.1/secret' }, resume() {}, destroy() {},
          }));
        };
        return req;
      }) as never);
      await expect(localiserProprietesLibres({ logoUrl: ' http://cdn.public.example/a.png' }, opts))
        .rejects.toMatchObject({ motif: 'ip-interdite' });
      expect(appelsFetchSur).toEqual(['http://cdn.public.example/a.png']);
      expect(cibles).toEqual(['cdn.public.example/a.png']); // jamais 10.0.0.1
    });
  });
});

// ─── 5. Profondeur ──────────────────────────────────────────────────────
describe('5. profondeur bornée, fermée par défaut', () => {
  const emboiter = (feuille: unknown, n: number) => {
    let o: unknown = feuille;
    for (let i = 0; i < n; i += 1) o = { n: o };
    return o;
  };
  it('profondeur 9 (chaîne ou objet) : RefusSsrf, 0 appel', async () => {
    await expect(localiserProprietesLibres(emboiter({ logoUrl: 'https://10.0.0.1/x' }, 8), opts)).rejects.toBeInstanceOf(RefusSsrf);
    await expect(localiserProprietesLibres(emboiter({ logoUrl: 'https://cdn.public.example/a.png' }, 8), opts)).rejects.toBeInstanceOf(RefusSsrf);
    await expect(localiserProprietesLibres(emboiter(['/proxy?src=x'], 8), opts)).rejects.toBeInstanceOf(RefusSsrf);
    await expect(localiserProprietesLibres(emboiter({ a: { b: 'texte' } }, 8), opts)).rejects.toBeInstanceOf(RefusSsrf);
    expect(appelsFetchSur).toEqual([]);
  });
  it('profondeur 8 légitime : localisée ; profondeur 8 interne : refusée', async () => {
    const s = await localiserProprietesLibres(emboiter({ logoUrl: 'https://cdn.public.example/a.png' }, 7), opts) as Record<string, unknown>;
    let feuille: Record<string, unknown> = s;
    for (let i = 0; i < 7; i += 1) feuille = feuille.n as Record<string, unknown>;
    expect(feuille.logoUrl).toMatch(LOCALISEE);
    await expect(localiserProprietesLibres(emboiter({ logoUrl: 'https://10.0.0.1/x' }, 7), opts)).rejects.toMatchObject({ motif: 'ip-interdite' });
  });
  it('nombres, booléens, null au-delà de la profondeur 8 : inchangés (aucun média possible)', async () => {
    const o = emboiter({ x: 50, y: null, z: true }, 8);
    expect(await localiserProprietesLibres(o, opts)).toEqual(o);
  });
});

// ─── 6. Légitimes inchangés ─────────────────────────────────────────────
describe('6. comportement légitime inchangé', () => {
  it('CDN public canonique : localisé comme avant (URL d’origine transmise telle quelle)', async () => {
    const s = await localiserProprietesLibres({ logoUrl: 'https://cdn.public.example/a.png', mixVideos: ['https://cdn.public.example/v.mp4'] }, opts);
    expect(s.logoUrl).toMatch(LOCALISEE);
    expect(s.mixVideos[0]).toMatch(/\.mp4$/);
    expect(appelsFetchSur).toEqual(['https://cdn.public.example/a.png', 'https://cdn.public.example/v.mp4']);
  });
  it('notre stockage : rendu tel quel, 0 appel', async () => {
    const u = 'https://studiio.pro/storage/v1/object/public/media/rush.mp4';
    expect(await localiserProprietesLibres({ backgroundVideo: u }, opts)).toEqual({ backgroundVideo: u });
    expect(appelsFetchSur).toEqual([]);
  });
  it('textes ordinaires, couleurs, icônes : inchangés', async () => {
    const e = {
      a: 'Astuce: bois', b: 'Fitness:Go', c: '#7C3AED', d: 'Dumbbell', e: 'zap', f: '', g: 'Mailto-like: non',
      cards: [{ icon: 'Flame', title: 'SILENT', description: 'Danse: 0 bruit', value: '+40%' }],
      textItems: [{ text: 'https://x.example', duration: 2 }],
      seq: ['intro', 'cards'],
    };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(appelsFetchSur).toEqual([]);
  });
  it('clés texte des compositions (dont *Text) : intactes même avec une URL ou un /proxy', async () => {
    const e = {
      titleText: 'https://10.0.0.1/x', subtitleText: '/proxy?src=http%3A%2F%2F10.0.0.1', themeTitle: 'file:///etc/passwd',
      themeSubtitle: ' https://10.0.0.1', tagLine: 'javascript:alert(1)', ctaText: 'https://monsite.example',
      ctaSubText: 'AFROBOOST.COM', videoMode: 'cardio', objective: 'promotion',
      textPosition: { anchor: 'top-left', x: 50, y: 50 }, videoPosition: { anchor: 'center', x: 50, y: 50 },
    };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(appelsFetchSur).toEqual([]);
  });
  it('nombres, booléens, null, undefined : inchangés', async () => {
    const e = { renderSeed: 42, isImageFlags: [true, false], clipDurations: [1.5, 2], voiceOverAudio: null, logoUrl: undefined };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(await localiserProprietesLibres(7, opts)).toBe(7);
    expect(await localiserProprietesLibres(null, opts)).toBe(null);
  });
});

// ─── 7. Comparaison avec la preuve S1a (avant → après) ──────────────────
describe('7. preuve S1a rejouée : les 12 charges ne passent plus intactes', () => {
  const CHARGES: Record<string, string> = {
    espaceTete: ' https://10.0.0.1/x',
    controleC0Tete: '\u0001https://10.0.0.1/x',
    tabDansSchema: 'ht\ttps://10.0.0.1/x',
    lfApresDeuxPoints: 'https:\n//10.0.0.1/x',
    antislash: 'https:\\\\10.0.0.1\\x',
    sansBarres: 'https:10.0.0.1/x',
    relatifSchema: '//studiio-minio:9000/media/x',
    relatifProxy: '/proxy?src=http%3A%2F%2F10.0.0.1%2Fx&time=0&transparent=false&toneMapped=false',
    fichier: 'file:///etc/passwd',
    data: 'data:image/png;base64,iVBORw0KGgo=',
    blob: 'blob:http://localhost:3000/abc',
    javascript: 'javascript:alert(1)',
  };
  for (const [nom, charge] of Object.entries(CHARGES)) {
    it(`${nom} : AVANT sortie identique, APRÈS RefusSsrf`, async () => {
      const entree = {
        logoUrl: charge, characterImage: charge, backgroundVideos: [charge, charge],
        niveau: { profond: { backgroundAudio: charge } }, voiceOverAudio: charge,
      };
      await expect(localiserProprietesLibres(entree, opts)).rejects.toBeInstanceOf(RefusSsrf);
      // Seule la forme canonique https://10.0.0.1/x a pu atteindre le fetch sûr (qui l'a refusée).
      for (const u of appelsFetchSur) expect(u).toBe('https://10.0.0.1/x');
    });
  }
  it('témoin : https://cdn.public.example/a.png EST localisée (inchangé)', async () => {
    const s = await localiserProprietesLibres({ logoUrl: 'https://cdn.public.example/a.png' }, opts);
    expect(s.logoUrl).toMatch(LOCALISEE);
    expect(appelsFetchSur).toEqual(['https://cdn.public.example/a.png']);
  });
  it('profondeur 9 : AVANT intacte, APRÈS RefusSsrf', async () => {
    let o: Record<string, unknown> = { logoUrl: 'https://10.0.0.1/x' };
    for (let i = 0; i < 8; i += 1) o = { n: o };
    await expect(localiserProprietesLibres(o, opts)).rejects.toBeInstanceOf(RefusSsrf);
    expect(appelsFetchSur).toEqual([]);
  });
  it('clés texte de la preuve (iconUrl, sourceUrl, link, ctaImage, bgColor) : inchangées (affichées, jamais chargées)', async () => {
    const e = { iconUrl: 'https://10.0.0.1/i.png', sourceUrl: 'https://10.0.0.1/s', link: 'https://10.0.0.1/l', ctaImage: 'https://10.0.0.1/c.png', bgColor: 'https://10.0.0.1/b' };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(appelsFetchSur).toEqual([]);
  });
});

// ─── 8. QA S1a : chemins relatifs SANS « / » vers le /proxy local de Remotion ──
describe('8. références relatives qui atteignent /proxy : RefusSsrf, 0 appel', () => {
  const P = 'proxy?src=http%3A%2F%2F169.254.169.254%2F&time=0';
  const CHARGES = {
    nu: P,
    point: `./${P}`,
    remontee: `../../../${P}`,
    pointAntislash: `.\\${P}`,
    pointEncode: `%2e/${P}`,
    deuxPointsEncodes: `%2e%2e/${P}`,
    allerRetour: `proxy/../${P}`,
    majuscules: 'PROXY?src=http%3A%2F%2F10.0.0.1%2F',
    xEncode: 'pro%78y?src=http%3A%2F%2F10.0.0.1%2F',
    espaceTete: ` \t${P}`,
    sousChemin: 'proxy/x',
  };
  for (const [nom, charge] of Object.entries(CHARGES)) {
    it(nom, async () => {
      expect(new URL(charge.trim(), 'http://localhost:3000/').pathname.toLowerCase()).toMatch(/^\/pro(xy|%78y)/);
      for (const f of [...formes(charge), { posterUrl: charge }]) {
        await expect(localiserProprietesLibres(f, opts)).rejects.toMatchObject({ name: 'RefusSsrf', motif: 'url-invalide' });
      }
      expect(appelsFetchSur.filter((u) => !u.includes('cdn.public.example'))).toEqual([]);
    });
  }

  it('%2Fproxy : chemin brut /%2Fproxy, non routé par Remotion → laissé intact', async () => {
    expect(new URL('%2Fproxy?src=x', 'http://localhost:3000/').pathname).toBe('/%2Fproxy');
    const e = { posterUrl: '%2Fproxy?src=http%3A%2F%2F10.0.0.1%2F' };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
  });

  it('références relatives ordinaires : intactes', async () => {
    const e = { a: '95%', b: '12:30', c: '#7C3AED', d: 'logo', e: 'proxima', f: 'mon proxy', g: 'Photo 100%', h: '%zz' };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(appelsFetchSur).toEqual([]);
  });
});

// ─── 9. QA S1a : « Data: … », « File: … » sont du TEXTE (blanc après « : ») ──
describe('9. nom de schéma suivi d’un blanc : texte intact', () => {
  it.each(['Data: 5 chiffres', 'About: nous', 'File: x', 'file: /etc/passwd', 'Chrome: astuce', 'FTP: info', 'data:  x'])('%s', async (t) => {
    const e = { posterUrl: t, logoUrl: t, backgroundVideos: [t] };
    expect(await localiserProprietesLibres(e, opts)).toEqual(e);
    expect(appelsFetchSur).toEqual([]);
  });
  it('« File: x » et « file: /etc/passwd » ne désignent pas /etc/passwd', () => {
    expect(new URL('File: x').href).toBe('file:///%20x');
    expect(new URL('file: /etc/passwd').href).toBe('file:///%20/etc/passwd');
    expect(new URL('file: /etc/passwd').pathname).not.toBe('/etc/passwd');
  });
  it('blanc supprimé par WHATWG (tab/LF après « : ») : toujours refusé', async () => {
    for (const t of ['file:\t///etc/passwd', 'data:\nimage/png;base64,AA', 'javascript:\ralert(1)']) {
      await expect(localiserProprietesLibres({ posterUrl: t }, opts)).rejects.toMatchObject({ motif: 'schema' });
    }
  });
});
