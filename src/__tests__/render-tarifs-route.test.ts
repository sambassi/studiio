/**
 * `GET /api/render/tarifs` — le prix vient du serveur, et rien d'autre ne sort.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE ROUTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'écran annonçait « 10 crédits » depuis une constante TypeScript. Elle
 * disait vrai par coïncidence : le prix réel vit dans `tarifs_rendu`, et
 * c'est de là que `reserver_rendu` le lit. Les deux pouvaient diverger sans
 * que rien ne le signale.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CES TESTS FERMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La première version construisait sa réponse en recopiant CHAQUE clé
 * trouvée en base. Aucune entrée client n'y arrivait — ce n'était donc pas
 * une faille — mais une ligne ajoutée en base serait sortie telle quelle
 * vers le navigateur, `__proto__` compris.
 *
 * Ces tests appellent le VRAI gestionnaire, avec une base qui répond ce
 * qu'on veut : c'est la seule façon de vérifier qu'une ligne inconnue est
 * ignorée plutôt que relayée.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FORMATS } from '@/lib/rendus/service';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** Ce que la table renvoie, et ce que la route a demandé. */
let lignesTarifs: unknown;
let erreurTarifs: unknown = null;
let ligneUser: Record<string, unknown> | null = null;
const tablesLues: string[] = [];
const filtresIn: Array<{ colonne: string; valeurs: unknown }> = [];

function requete(table: string) {
  tablesLues.push(table);
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    in: (colonne: string, valeurs: unknown) => { filtresIn.push({ colonne, valeurs }); return api; },
    insert: () => { throw new Error('insert interdit'); },
    update: () => { throw new Error('update interdit'); },
    maybeSingle: async () => ({ data: ligneUser, error: null }),
    then: undefined,
  };
  // `tarifs_rendu` est attendue comme une promesse (pas de `.maybeSingle()`).
  if (table === 'tarifs_rendu') {
    (api as { then: unknown }).then = (resoudre: (v: unknown) => unknown) =>
      resoudre({ data: lignesTarifs, error: erreurTarifs });
  }
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

const { GET } = await import('@/app/api/render/tarifs/route');

const lire = async () => {
  const res = await GET({} as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  tablesLues.length = 0;
  filtresIn.length = 0;
  erreurTarifs = null;
  lignesTarifs = [{ format: 'reel', credits: 10 }, { format: 'tv', credits: 15 }];
  ligneUser = { id: 'moi', role: 'user', credits: 4242, email: 'moi@exemple.fr' };
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
});

// ────────────────────────────────────────────────────────────────────────────

describe('1. Session obligatoire', () => {
  it('sans session → 401, et rien n est lu', async () => {
    authMock.mockResolvedValue(null);
    const r = await lire();
    expect(r.status).toBe(401);
    expect(tablesLues).toEqual([]);
  });
});

describe('2. Les tarifs viennent de la table', () => {
  it('rend exactement reel et tv', async () => {
    const r = await lire();
    expect(r.status).toBe(200);
    expect(r.body.tarifs).toEqual({ reel: 10, tv: 15 });
  });

  it('et lit bien `tarifs_rendu`', async () => {
    await lire();
    expect(tablesLues).toContain('tarifs_rendu');
  });

  it('la requête filtre déjà sur la liste canonique', async () => {
    await lire();
    expect(filtresIn).toEqual([{ colonne: 'format', valeurs: ['reel', 'tv'] }]);
    expect(FORMATS).toEqual(['reel', 'tv']);
  });
});

describe('3, 4, 5. Toute ligne hors liste fermée est ignorée', () => {
  it('une ligne « xyz » n apparaît pas dans la réponse', async () => {
    lignesTarifs = [
      { format: 'reel', credits: 10 },
      { format: 'tv', credits: 15 },
      { format: 'xyz', credits: 999 },
    ];
    const r = await lire();
    expect(r.body.tarifs).toEqual({ reel: 10, tv: 15 });
    expect(Object.keys(r.body.tarifs)).toEqual(['reel', 'tv']);
    expect(JSON.stringify(r.body)).not.toContain('xyz');
    expect(JSON.stringify(r.body)).not.toContain('999');
  });

  it('une ligne « __proto__ » n apparaît pas, et ne pollue rien', async () => {
    lignesTarifs = [
      { format: 'reel', credits: 10 },
      { format: 'tv', credits: 15 },
      { format: '__proto__', credits: 7 },
    ];
    const r = await lire();
    expect(r.body.tarifs).toEqual({ reel: 10, tv: 15 });
    // Le prototype d'Object n'a pas bougé : aucune clé n'y a été posée.
    expect((Object.prototype as unknown as Record<string, unknown>).credits).toBeUndefined();
    expect(({} as Record<string, unknown>).credits).toBeUndefined();
    expect(Object.getPrototypeOf(r.body.tarifs)).toBe(Object.prototype);
  });

  it('une ligne « constructor » n apparaît pas', async () => {
    lignesTarifs = [
      { format: 'reel', credits: 10 },
      { format: 'tv', credits: 15 },
      { format: 'constructor', credits: 1 },
    ];
    const r = await lire();
    expect(r.body.tarifs).toEqual({ reel: 10, tv: 15 });
    expect(Object.keys(r.body.tarifs)).toEqual(['reel', 'tv']);
  });

  it('même toutes ensemble, et dans le désordre', async () => {
    lignesTarifs = [
      { format: '__proto__', credits: 1 },
      { format: 'constructor', credits: 2 },
      { format: 'tv', credits: 15 },
      { format: 'prototype', credits: 3 },
      { format: 'reel', credits: 10 },
      { format: 'toString', credits: 4 },
    ];
    const r = await lire();
    expect(r.body.tarifs).toEqual({ reel: 10, tv: 15 });
    expect(Object.keys(r.body.tarifs)).toEqual(['reel', 'tv']);
  });

  it('un crédit non numérique est ignoré, il ne devient pas zéro', async () => {
    lignesTarifs = [{ format: 'reel', credits: '10' }, { format: 'tv', credits: 15 }];
    const r = await lire();
    expect(r.status).toBe(503);
    expect(r.body.tarifs).toBeNull();
  });
});

describe('6 & 7. La politique dérivée, et elle seule', () => {
  it('rôle « admin » en base → partner_cost_only, sans tarif', async () => {
    ligneUser = { id: 'moi', role: 'admin', credits: 4242, email: 'moi@exemple.fr' };
    const r = await lire();
    expect(r.status).toBe(200);
    expect(r.body.politique).toBe('partner_cost_only');
    expect(r.body.tarifs).toBeNull();
    expect(r.body.libelle).toBe('Frais partenaires uniquement');
  });

  it('rôle « user » → credits', async () => {
    const r = await lire();
    expect(r.body.politique).toBe('credits');
  });

  it('rôle absent, inconnu ou nul → credits', async () => {
    for (const role of [undefined, null, '', 'inconnu', 'Administrateur']) {
      ligneUser = { id: 'moi', role };
      // eslint-disable-next-line no-await-in-loop
      const r = await lire();
      expect(r.body.politique, String(role)).toBe('credits');
    }
  });
});

describe('8. Rien de l utilisateur ne sort', () => {
  it('ni e-mail, ni identifiant, ni solde, ni rôle brut', async () => {
    for (const role of ['user', 'admin']) {
      ligneUser = { id: 'moi', role, credits: 4242, email: 'moi@exemple.fr', name: 'Moi' };
      // eslint-disable-next-line no-await-in-loop
      const r = await lire();
      const texte = JSON.stringify(r.body);
      expect(texte).not.toContain('moi@exemple.fr');
      expect(texte).not.toContain('4242');
      expect(texte).not.toContain('"role"');
      expect(texte).not.toContain('"id"');
      expect(texte).not.toContain('"name"');
    }
  });

  it('la réponse ne porte que les champs attendus', async () => {
    const r = await lire();
    expect(Object.keys(r.body).sort()).toEqual(['ok', 'politique', 'tarifs']);
  });

  it('et pour l administrateur, un libellé en plus — jamais un nombre', async () => {
    ligneUser = { id: 'moi', role: 'admin' };
    const r = await lire();
    expect(Object.keys(r.body).sort()).toEqual(['libelle', 'ok', 'politique', 'tarifs']);
    expect(JSON.stringify(r.body)).not.toMatch(/\d/);
  });
});

describe('9. Aucun prix ne vient du client', () => {
  it('la route ne lit ni query, ni corps, ni en-tête', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/render/tarifs/route.ts'), 'utf-8',
    );
    expect(src).not.toContain('searchParams');
    expect(src).not.toContain('req.json()');
    expect(src).not.toContain('headers.get');
    // Le paramètre de requête n'est même pas nommé : il est inutilisé.
    expect(src).toContain('export async function GET(_req: NextRequest)');
  });

  it('la construction de la réponse est LITTÉRALE, pas dynamique', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/render/tarifs/route.ts'), 'utf-8',
    );
    // On lit le CODE, pas les commentaires : la documentation de la route
    // cite l'ancienne affectation dynamique pour expliquer ce qui a changé,
    // et cette citation ne doit pas faire échouer l'assertion.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // C'est ce qui a été corrigé : plus aucune clé de la base ne devient une
    // propriété de la réponse.
    expect(code).not.toMatch(/tarifs\[[^\]]+\]\s*=/);
    expect(code).toContain('tarifs: { reel, tv }');
    expect(code).toContain('new Map<string, number>()');
  });
});

describe('10. Un tarif absent est avoué, jamais inventé', () => {
  it('table vide → 503 et `tarifs: null`', async () => {
    lignesTarifs = [];
    const r = await lire();
    expect(r.status).toBe(503);
    expect(r.body.tarifs).toBeNull();
  });

  it('erreur de lecture → 503 et `tarifs: null`', async () => {
    erreurTarifs = { message: 'boom' };
    const r = await lire();
    expect(r.status).toBe(503);
    expect(r.body.tarifs).toBeNull();
  });

  it('un seul format connu → 503, pas un demi-tarif', async () => {
    lignesTarifs = [{ format: 'reel', credits: 10 }];
    const r = await lire();
    expect(r.status).toBe(503);
    expect(r.body.tarifs).toBeNull();
  });

  it('aucun zéro n est jamais rendu à la place d un prix manquant', async () => {
    for (const lignes of [[], [{ format: 'reel', credits: 10 }], [{ format: 'xyz', credits: 3 }]]) {
      lignesTarifs = lignes;
      // eslint-disable-next-line no-await-in-loop
      const r = await lire();
      expect(r.body.tarifs).toBeNull();
      expect(r.body.tarifs).not.toEqual({ reel: 0, tv: 0 });
    }
  });
});
