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
