/**
 * TTS Edge — `msedge-tts` ne doit JAMAIS être bundlé par webpack.
 *
 * Constaté sur staging (2026-09-29) : bundlé, le `ws` qu'il embarque lève
 * `TypeError: t.mask is not a function` à l'envoi de la première trame, hors
 * de toute promesse. Rien ne part, rien ne revient : `/api/tts/edge` attend
 * ses 45 s et rend 504, et la voix de l'Autopilote échoue pareil. Le même
 * code, chargé depuis node_modules, synthétise en une seconde.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const require_ = createRequire(import.meta.url);
const nextConfig = require_(join(process.cwd(), 'next.config.js'));

describe('msedge-tts reste externe au bundle serveur', () => {
  it('est déclaré dans serverComponentsExternalPackages (tracé dans le standalone)', () => {
    expect(nextConfig.experimental.serverComponentsExternalPackages).toContain('msedge-tts');
  });

  it('est déclaré en external webpack côté serveur', () => {
    const config = nextConfig.webpack({ externals: [] }, { isServer: true });
    const externes = Object.assign({}, ...config.externals.filter((e: unknown) => typeof e === 'object'));
    expect(externes['msedge-tts']).toBe('commonjs msedge-tts');
  });

  it("ne touche pas le bundle client", () => {
    const config = nextConfig.webpack({ externals: [] }, { isServer: false });
    const externes = Object.assign({}, ...(config.externals || []).filter((e: unknown) => typeof e === 'object'));
    expect(externes['msedge-tts']).toBeUndefined();
  });

  it('garde minio externe (non-régression)', () => {
    expect(nextConfig.experimental.serverComponentsExternalPackages).toContain('minio');
  });
});
