import { describe, it, expect, afterEach, vi } from 'vitest';
import { signState, verifyState } from '@/lib/social/oauth-state';
import { toJsStringLiteral, escapeHtml } from '@/lib/social/html-escape';

/**
 * Les deux failles HIGH fermees ici, verrouillees par des tests.
 *
 * 1. `state` OAuth non signe -> rattachement de compte force (CSRF).
 * 2. XSS reflechie dans les pages de retour OAuth.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('Faille 1 — `state` OAuth signe', () => {
  it('signe le state sans changer le format des trois premiers segments', () => {
    const state = signState('user-42');
    const parts = state.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('user-42');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
  });

  it('accepte son propre state et rend le userId', () => {
    const verified = verifyState(signState('user-42'));
    expect(verified.valid).toBe(true);
    expect(verified.userId).toBe('user-42');
  });

  it("REFUSE le state forge de l'attaque : `<id victime>:0:x`", () => {
    // C'est exactement la faille : sans signature, ce state suffisait a
    // rattacher le compte social de l'attaquant au compte de la victime.
    const verified = verifyState('victime-id:0:x');
    expect(verified.valid).toBe(false);
    expect(verified.userId).toBeNull();
  });

  it('refuse un state a 4 segments dont la signature est inventee', () => {
    expect(verifyState('victime-id:' + Date.now() + ':x:signature-bidon').valid).toBe(false);
  });

  it('refuse une signature valide recollee sur un AUTRE userId', () => {
    // Rejeu de signature : on prend un state legitime et on change le userId.
    const legit = signState('attaquant');
    const [, timestamp, random, sig] = legit.split(':');
    const forge = `victime:${timestamp}:${random}:${sig}`;
    expect(verifyState(forge).valid).toBe(false);
  });

  it('refuse un state perime (au-dela de 30 minutes)', () => {
    const state = signState('user-42');
    expect(verifyState(state).valid).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    const expired = verifyState(state);
    expect(expired.valid).toBe(false);
    expect(expired.reason).toContain('expire');
  });

  it('sans AUTH_SECRET, ne pretend pas signer et ne valide rien', () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      // Format historique a 3 segments plutot qu'une signature vide qui
      // donnerait une fausse impression de securite...
      expect(signState('user-42').split(':')).toHaveLength(3);
      // ...et rien ne passe la verification.
      expect(verifyState('user-42:0:x').valid).toBe(false);
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  });

  it('ne leve jamais, quelle que soit l entree', () => {
    for (const bad of [null, '', ':::', 'a:b', 'a:b:c:d:e', 'x'.repeat(5000)]) {
      expect(() => verifyState(bad as any)).not.toThrow();
      expect(verifyState(bad as any).valid).toBe(false);
    }
  });
});

describe('Faille 2 — XSS des pages de retour OAuth', () => {
  /**
   * Relit le litteral produit pour verifier qu'on echappe sans mutiler.
   * `JSON.parse` et non `eval` : le litteral reste du JSON valide (les
   * echappements ajoutes sont des `\uXXXX`), et un test ne doit pas evaluer
   * une chaine construite a partir d'une charge d'attaque.
   */
  const evaluate = (literal: string) => JSON.parse(literal);

  /**
   * Le vecteur reel de la faille : l'ancien echappement
   * `message.replace(/'/g, "\\'").replace(/</g, '&lt;')` ne touchait pas
   * l'antislash. Un message finissant par `\` produisait `'...\'` : l'antislash
   * echappait le guillemet fermant, le litteral JS n'etait plus termine, et la
   * suite du message devenait du CODE.
   */
  const legacyEscape = (m: string) => m.replace(/'/g, "\\'").replace(/</g, '&lt;');
  const emitLegacy = (m: string) => `postMessage({ message: '${legacyEscape(m)}' }, '*');`;
  const emitFixed = (m: string) => `postMessage({ message: ${toJsStringLiteral(m)} }, '*');`;

  it("PREUVE : l ancien echappement laissait sortir du litteral JS via l antislash final", () => {
    const payload = 'x\\';
    // Le guillemet fermant se retrouve echappe : la chaine n'est plus fermee.
    expect(emitLegacy(payload)).toContain("'x\\'");
    // Le correctif, lui, garde un litteral clos et relisible.
    expect(evaluate(toJsStringLiteral(payload))).toBe(payload);
    expect(emitFixed(payload)).toContain('"x\\\\"');
  });

  it('neutralise aussi `</script>`, le piege du correctif naif par JSON.stringify', () => {
    // `JSON.stringify` seul n'echappe pas `/` : `</script>` traverserait intact
    // et fermerait la balise au niveau du PARSEUR HTML, avant toute evaluation.
    const payload = '</script><img src=x onerror=alert(1)>';
    const literal = toJsStringLiteral(payload);
    expect(JSON.stringify(payload)).toContain('</script>');
    expect(literal).not.toContain('</script>');
    expect(literal).not.toContain('<');
    // La valeur reste intacte cote JS : on echappe, on ne mutile pas.
    expect(evaluate(literal)).toBe(payload);
  });

  it('echappe U+2028 / U+2029, terminateurs de ligne en JS mais pas en JSON', () => {
    const literal = toJsStringLiteral('a b c');
    expect(literal).not.toContain(' ');
    expect(literal).not.toContain(' ');
    expect(evaluate(literal)).toBe('a b c');
  });

  it('resiste aux charges classiques, sans jamais laisser passer un chevron', () => {
    const payloads = [
      '"><script>alert(1)</script>',
      "');alert(1);//",
      '</script><svg onload=alert(1)>',
      '\\\';alert(1);//',
      '&lt;script&gt;',
      '</SCRIPT ><script>alert(1)</script>',
    ];
    for (const p of payloads) {
      const literal = toJsStringLiteral(p);
      expect(literal, p).not.toMatch(/[<>]/);
      expect(evaluate(literal), p).toBe(p);
    }
  });

  it('escapeHtml couvre les cinq caracteres, y compris en contexte d attribut', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
  });

  it('escapeHtml n echappe pas deux fois les esperluettes', () => {
    // `&` traite en premier : sinon `<` deviendrait `&amp;lt;`.
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('gere null et undefined sans lever', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(evaluate(toJsStringLiteral(null))).toBe('');
    expect(evaluate(toJsStringLiteral(undefined))).toBe('');
  });
});

describe('Cablage dans les routes', () => {
  it('le callback partage verifie le state au lieu de le lire en clair', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const route = readFileSync(
      resolve(__dirname, '../app/api/social/callback/route.ts'),
      'utf-8',
    );
    expect(route).toContain('verifyState(state)');
    // L'ancienne lecture en clair ne doit pas revenir.
    expect(route).not.toContain("state.split(':')");
    // Et les deux echappements sont bien ceux utilises dans le HTML.
    expect(route).toContain('toJsStringLiteral(message)');
    expect(route).toContain('escapeHtml(message)');
    expect(route).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('la route de connexion emet un state signe', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const route = readFileSync(
      resolve(__dirname, '../app/api/social/connect/route.ts'),
      'utf-8',
    );
    expect(route).toContain('signState');
    expect(route).not.toContain('Math.random().toString(36)');
  });
});
