import '@testing-library/jest-dom/vitest';

/**
 * Variables d'environnement factices pour les tests.
 *
 * Plusieurs modules construisent leur client Supabase AU CHARGEMENT
 * (`src/lib/email/notifications.ts:18` appelle `createClient(process.env… ||
 * '')`, atteint depuis `src/lib/auth/config.ts`).
 * Avec une URL vide, supabase-js lève « supabaseUrl is required » et le
 * fichier de test entier échoue à l'import — avant même qu'un test tourne.
 * C'est ce qui mettait `credits-system.test.ts` au rouge alors que la
 * fonction testée, `getVideoRenderCost`, est purement arithmétique.
 *
 * Ces valeurs ne servent qu'à satisfaire la construction : aucun test ne fait
 * d'appel réseau, tous les accès Supabase sont mockés. On n'écrase jamais une
 * variable déjà définie, pour ne pas masquer un environnement volontaire.
 */
const TEST_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  AUTH_SECRET: 'test-auth-secret',
  NEXTAUTH_URL: 'http://localhost:3000',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) process.env[key] = value;
}

// ───────────────────────────────────────────────────────────────────────────
// LE RÉSEAU EXTERNE EST FERMÉ PENDANT LES TESTS — ET ÇA ÉCHOUE BRUYAMMENT
// ───────────────────────────────────────────────────────────────────────────
//
// L'en-tête de ce fichier affirmait « aucun test ne fait d'appel réseau ».
// C'était une affirmation ; ceci en fait une garantie — et M3-B4 en a besoin,
// parce qu'un fournisseur d'IA branché par erreur coûterait de l'argent à
// chaque exécution de la suite, sans qu'aucun test ne rougisse.
//
// ⚠️ POURQUOI `net.Socket.prototype.connect`, ET PAS `fetch`
//
// Le `fetch` de Node est undici : il n'emprunte NI `globalThis.fetch` une fois
// capturé, NI `http.request`. Onze fichiers de tests remplacent déjà
// `globalThis.fetch` par leur propre doublure — un garde-fou posé là serait
// écrasé par le premier d'entre eux. La socket, elle, est le passage obligé :
// undici, `http.request`, le SDK MinIO et XHR finissent tous ici.
//
// ⚠️ CE QU'IL NE COUVRE PAS : un processus ENFANT. ffmpeg lit les serveurs de
// banc d'essai des tests M3-B2.x depuis son propre processus, hors de portée
// de ce crochet. C'est pourquoi le chemin d'analyse ne doit shell-outer vers
// aucun binaire qui parlerait au réseau — et c'est aussi pourquoi ces tests-là
// continuent de passer sans modification.
//
// La liste blanche est la BOUCLE LOCALE, et rien d'autre : M3-B2.2/2.4/2.6
// montent de vrais serveurs sur `127.0.0.1` avec un port éphémère, et ces
// tests doivent continuer de passer à l'identique.
import net from 'node:net';

const HOTES_BOUCLE = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '']);

export class AppelReseauInterdit extends Error {
  constructor(hote: string) {
    super(
      `Appel réseau externe interdit pendant les tests : ${hote}. `
      + 'Un fournisseur d’IA se remplace par une doublure, jamais par un vrai appel.',
    );
    this.name = 'AppelReseauInterdit';
  }
}

const connecterOriginal = net.Socket.prototype.connect;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(net.Socket.prototype as any).connect = function connectSurveille(...args: any[]) {
  const premier = args[0];
  const options = typeof premier === 'object' && premier !== null
    ? premier as { host?: unknown; hostname?: unknown; path?: unknown }
    : null;

  // `connect(path, …)` : socket de domaine unix — l'IPC de Vitest lui-même.
  // Toujours autorisée, sinon le lanceur de tests se couperait la parole.
  const chemin = options ? options.path : premier;
  if (typeof chemin === 'string') return connecterOriginal.apply(this, args as never);

  const hote = options
    ? String(options.host ?? options.hostname ?? '')
    : (typeof args[1] === 'string' ? args[1] : '');

  if (HOTES_BOUCLE.has(hote)) return connecterOriginal.apply(this, args as never);

  // L'hôte est nommé — c'est une INFORMATION de diagnostic, pas un secret :
  // aucun test légitime ne devrait produire cette ligne.
  throw new AppelReseauInterdit(hote);
};

// ───────────────────────────────────────────────────────────────────────────
// TRADUCTION : sans fournisseur, `useTranslations` retombe sur le catalogue français.
// Les composants convertis (texte en dur → t('clé')) se rendent donc dans les tests
// exactement comme avant : le français, pas une clé brute. En production, c'est le
// fournisseur qui apporte français + surcouche de la langue choisie.
// ───────────────────────────────────────────────────────────────────────────
import { definirMessagesDeRepli } from '@/i18n/client';
import frMessages from '../../messages/fr.json';
definirMessagesDeRepli(frMessages as Record<string, unknown>);

// ───────────────────────────────────────────────────────────────────────────
// TESTS DE SOURCE : le texte français d'origine reste lisible.
// ~300 tests lisent le CODE SOURCE (`readFileSync`) et y cherchent des phrases ou des
// garde-fous. Depuis la conversion du texte en dur en `tUi('clé')`, ces phrases vivent
// dans messages/fr.json. Pour que ces tests continuent de garder CE QUI EST AFFICHÉ, la
// lecture d'un fichier source converti rend `tUi('clé')` remplacé par son texte français
// (substitution déterministe ; les fichiers non convertis ne sont pas touchés).
// ───────────────────────────────────────────────────────────────────────────
import fsModule from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

function texteFr(cle: string, ns: string): string | null {
  let cur: unknown = frMessages;
  for (const p of `${ns}.${cle}`.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return null;
  }
  return typeof cur === 'string' ? cur : null;
}

export function restituerFrancais(source: string): string {  // eslint-disable-line
  const m = source.match(/useTranslations\('(ui\.[A-Za-z0-9.]+)'\)/);
  if (!m) return source;
  const ns = m[1];
  const sub = (cle: string, forme: (t: string) => string): string | null => {
    const t = texteFr(cle, ns);
    return t === null ? null : forme(t);
  };
  // Appels PARAMÉTRÉS : tUi('k', { a, b: x.y }) → gabarit d'origine (`…${a}…${x.y}…`).
  const params = (brut: string): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const part of brut.split(',')) {
      const [nom, ...reste] = part.split(':');
      const n = nom.trim();
      if (n) m[n] = (reste.join(':').trim() || n);
    }
    return m;
  };
  const gabarit = (t: string, p: Record<string, string>, jsx: boolean) =>
    t.replace(/\{([A-Za-z_][\w]*)\}/g, (tout, v) => (v in p ? (jsx ? `{${p[v]}}` : '${' + p[v] + '}') : tout));
  source = source
    // attribut : aria-label={tUi('k', {…})}  →  aria-label={`Texte ${x}`}
    .replace(/=\{tUi\('([^']+)',\s*\{([^}]*)\}\)\}/g, (tout, cle, p) => sub(cle, (t) => '={`' + gabarit(t, params(p), false) + '`}') ?? tout)
    // enfant JSX : {tUi('k', {…})}  →  Texte {x}
    .replace(/\{tUi\('([^']+)',\s*\{([^}]*)\}\)\}/g, (tout, cle, p) => sub(cle, (t) => gabarit(t, params(p), true)) ?? tout)
    // expression : tUi('k', {…})  →  `Texte ${x}`
    .replace(/\btUi\('([^']+)',\s*\{([^}]*)\}\)/g, (tout, cle, p) => sub(cle, (t) => '`' + gabarit(t, params(p), false) + '`') ?? tout);
  return source
    // attribut : title={tUi('k')}  →  title="Texte"
    .replace(/=\{tUi\('([^']+)'\)\}/g, (tout, cle) => sub(cle, (t) => (t.includes('"') ? `={'${t.replace(/'/g, "\\'")}'}` : `="${t}"`)) ?? tout)
    // enfant JSX : {tUi('k')}  →  Texte
    .replace(/\{tUi\('([^']+)'\)\}/g, (tout, cle) => sub(cle, (t) => t) ?? tout)
    // expression : tUi('k')  →  'Texte'
    .replace(/\btUi\('([^']+)'\)/g, (tout, cle) => sub(cle, (t) => `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`) ?? tout);
}

const lireOrigine = fsModule.readFileSync;
(fsModule as { readFileSync: unknown }).readFileSync = function (this: unknown, ...a: unknown[]) {
  const r = (lireOrigine as (...x: unknown[]) => unknown).apply(fsModule, a);
  const chemin = String(a[0]);
  if (typeof r === 'string' && /\.tsx?$/.test(chemin) && r.includes("useTranslations('ui.")) return restituerFrancais(r);
  return r;
};
syncBuiltinESMExports();
