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
