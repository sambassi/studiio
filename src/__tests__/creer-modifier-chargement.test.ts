import { describe, it, expect, vi } from 'vitest';
import { chargerPostAModifier, type ChargementPost } from '../lib/creer/loadPost';

/**
 * Chargement d'un contenu existant — la LECTURE, et rien d'autre.
 *
 * Ce que ces tests verrouillent :
 *
 * 1. **Aucun effet de bord.** Ouvrir un contenu ne rend rien, ne débite aucun
 *    crédit, ne publie rien, ne programme rien et n'active pas l'Autopilote.
 *    C'est vérifié en inspectant TOUS les appels réseau émis : une seule
 *    requête, en `GET`. Un test qui se contenterait de regarder le résultat
 *    laisserait passer un débit déclenché en chemin.
 *
 * 2. **Le refus est un refus.** Le serveur filtre déjà sur `user_id`
 *    (`GET /api/posts/[id]` : `.eq('user_id', session.user.id)`), si bien que
 *    le contenu d'un autre utilisateur ressort en 404. Le module doit rendre
 *    une issue distincte et n'exposer AUCUNE donnée — pas même l'existence de
 *    la ligne.
 *
 * 3. **Chaque échec a son nom.** Session expirée, refus, introuvable, réponse
 *    illisible et panne réseau mènent à cinq issues différentes : l'écran doit
 *    pouvoir dire ce qui s'est passé, jamais « une erreur est survenue ».
 *
 * Aucun `user_id` n'est envoyé : il vient de la session côté serveur.
 */

/** Fausse réponse `fetch`, au plus près de la vraie. */
function reponse(status: number, corps: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
  } as Response;
}

const POST = {
  id: 'post-42',
  title: 'TITRE',
  caption: 'legende',
  status: 'draft',
  scheduled_date: '2026-09-01',
  platforms: ['instagram'],
  metadata: { subtitle: 'sous-titre', musicVolume: 0 },
};

describe('propriétaire autorisé', () => {
  it('rend le post tel que le serveur l\'a renvoyé', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: POST }));
    const r = await chargerPostAModifier('post-42', f);
    expect(r).toEqual<ChargementPost>({ kind: 'ok', post: POST });
  });

  it('interroge la bonne route, en GET, une seule fois', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: POST }));
    await chargerPostAModifier('post-42', f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/posts/post-42');
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
  });

  it('encode l\'identifiant plutôt que de le coller dans l\'URL', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: POST }));
    await chargerPostAModifier('post 42/../autre', f);
    expect(f.mock.calls[0][0]).toBe('/api/posts/post%2042%2F..%2Fautre');
  });

  it('n\'envoie aucun corps, et surtout aucun `user_id`', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: POST }));
    await chargerPostAModifier('post-42', f);
    const init = f.mock.calls[0][1];
    expect(init?.body).toBeUndefined();
  });
});

describe('aucun effet de bord au chargement', () => {
  it('ne touche ni les crédits, ni le rendu, ni la publication', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true, data: POST }));
    await chargerPostAModifier('post-42', f);

    const urls = f.mock.calls.map((c) => String(c[0]));
    const methodes = f.mock.calls.map((c) => String(c[1]?.method ?? 'GET').toUpperCase());

    expect(urls).toEqual(['/api/posts/post-42']);
    expect(methodes).toEqual(['GET']);
    for (const interdit of [
      '/api/credits/deduct', '/api/render', '/api/render/batch',
      '/api/posts/publish', '/api/autopilot',
    ]) {
      expect(urls.some((u) => u.includes(interdit))).toBe(false);
    }
  });

  it('n\'écrit rien : aucune requête autre que GET, même en cas d\'échec', async () => {
    for (const status of [401, 403, 404, 500]) {
      const f = vi.fn().mockResolvedValue(reponse(status, { success: false }));
      await chargerPostAModifier('post-42', f);
      expect(f.mock.calls.every((c) => String(c[1]?.method ?? 'GET').toUpperCase() === 'GET'))
        .toBe(true);
    }
  });
});

describe('refus et absences — chacun son nom', () => {
  it('401 : la session a expiré', async () => {
    const f = vi.fn().mockResolvedValue(reponse(401, { success: false, error: 'Unauthorized' }));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'session' });
  });

  it('403 : le contenu ne vous appartient pas', async () => {
    const f = vi.fn().mockResolvedValue(reponse(403, { success: false, error: 'Forbidden' }));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'refuse' });
  });

  it('404 : introuvable — c\'est aussi la réponse au contenu d\'un autre', async () => {
    // `GET /api/posts/[id]` filtre sur `user_id` : le post d'autrui ressort
    // « not found ». Le module ne cherche pas a deviner laquelle des deux
    // situations s'est produite — il refuse, sans rien exposer.
    const f = vi.fn().mockResolvedValue(reponse(404, { success: false, error: 'Post not found' }));
    const r = await chargerPostAModifier('post-dautrui', f);
    expect(r).toEqual<ChargementPost>({ kind: 'introuvable' });
    expect(JSON.stringify(r)).not.toContain('metadata');
  });

  it('un contenu refusé ne laisse filtrer aucune donnée', async () => {
    // Meme si le serveur bavardait, le module ne doit rien remonter.
    const f = vi.fn().mockResolvedValue(
      reponse(403, { success: false, error: 'Forbidden', data: POST }),
    );
    const r = await chargerPostAModifier('post-42', f);
    expect(r).toEqual<ChargementPost>({ kind: 'refuse' });
    expect(JSON.stringify(r)).not.toContain('TITRE');
  });

  it('500 : une panne serveur n\'est pas un contenu absent', async () => {
    const f = vi.fn().mockResolvedValue(reponse(500, { success: false }));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'erreur' });
  });
});

describe('réponses abîmées et panne réseau', () => {
  it('un 200 sans `success` est illisible, pas un post vide', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: false }));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'erreur' });
  });

  it('un 200 sans données est illisible', async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { success: true }));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'erreur' });
  });

  it('un corps qui n\'est pas du JSON ne fait pas exploser l\'écran', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError('pas du JSON'); },
    } as unknown as Response);
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'erreur' });
  });

  it('une coupure réseau a sa propre issue — elle se réessaie', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await chargerPostAModifier('post-42', f)).toEqual<ChargementPost>({ kind: 'reseau' });
  });

  it('un identifiant vide n\'atteint jamais le réseau', async () => {
    const f = vi.fn();
    expect(await chargerPostAModifier('   ', f)).toEqual<ChargementPost>({ kind: 'erreur' });
    expect(f).not.toHaveBeenCalled();
  });
});
