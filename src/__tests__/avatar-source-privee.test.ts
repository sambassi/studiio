/**
 * A_8b — LA SOURCE D'UN AVATAR EST PRIVEE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROTEGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pas un fichier : un VISAGE. La source d'un avatar est la photo — ou, pour un
 * clone video, les deux a cinq minutes de footage — de la personne elle-meme.
 * C'est la donnee la plus sensible que Studiio stocke.
 *
 * Elle etait servie par le relais public. `create` posait un `getPublicUrl` et
 * rangeait l'URL en base comme verite canonique ; le relais rend tout objet
 * d'un compartiment autorise SANS SESSION. Mesure du 2026-09-09 : 200 et
 * 4,3 Mo sur un objet du meme regime, sans le moindre cookie. Le lien etait
 * permanent, et personne ne pouvait le revoquer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TROIS PORTES, ET IL FAUT LES TROIS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. le relais public REFUSE le namespace `avatar` ;
 * 2. les routes d'envoi ne peuvent pas FABRIQUER une cle dans ce namespace —
 *    sinon le blocage en lecture rendrait illisible un objet delivre par notre
 *    propre serveur ;
 * 3. la seule lecture legitime exige une session ET la propriete.
 *
 * Fermer la premiere sans les deux autres ne fermerait rien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cleDansNamespaceAvatar, cleDansNamespaceAnalyse, purposeAcceptable,
  SEGMENT_NAMESPACE_AVATAR, BUCKET_NAMESPACE_AVATAR,
} from '@/lib/storage/acces-objet';
import {
  cleSourceAvatar, cleSourceAvatarDuCompte, typeSourceAvatar,
  TTL_SOURCE_AVATAR_SECONDES, BUCKET_AVATAR,
} from '@/lib/avatar/source';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|--)/.test(l)).join('\n');

const PROXY = sansProse(lire('src/app/storage/v1/object/public/[bucket]/[...path]/route.ts'));
const ROUTE = sansProse(lire('src/app/api/avatar/[id]/source/route.ts'));
const CREATE = sansProse(lire('src/app/api/avatar/create/route.ts'));
const SOURCE = sansProse(lire('src/lib/avatar/source.ts'));
const PAGE = sansProse(lire('src/app/dashboard/avatar/page.tsx'));

const U = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const AUTRE = '11111111-2222-4333-8444-555555555555';

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le namespace privé', () => {
  it('1.1 ⚠️ UNE CLÉ DE SOURCE EST DANS LE NAMESPACE REFUSÉ', () => {
    const cle = cleSourceAvatar(U, 'mp4', 1_700_000_000);
    expect(cle).toBe(`${U}/${SEGMENT_NAMESPACE_AVATAR}/source-1700000000.mp4`);
    expect(cleDansNamespaceAvatar(BUCKET_NAMESPACE_AVATAR, cle)).toBe(true);
  });

  it('1.2 le namespace ne mord pas sur les autres compartiments', () => {
    // Un objet `avatar` dans `videos` n'est pas une source d'avatar : le
    // refus doit rester exactement aussi large que le besoin.
    expect(cleDansNamespaceAvatar('videos', `${U}/avatar/x.mp4`)).toBe(false);
    expect(cleDansNamespaceAvatar('audio', `${U}/avatar/x.mp4`)).toBe(false);
  });

  it('1.3 ⚠️ LES FORMES ENCODÉES SONT COUVERTES', () => {
    /* Le helper relit les formes décodées : un `%61vatar` ne doit pas échapper
       au refus en désignant malgré tout le même objet. C'est la garde que les
       vignettes d'analyse ont déjà, et elle vaut ici mot pour mot. */
    for (const cle of [
      `${U}/%61vatar/source-1.mp4`,
      `${U}/avatar%2Fsource-1.mp4`,
      `${U}/avatar/sous/source-1.mp4`,
    ]) {
      expect(cleDansNamespaceAvatar('media', cle), cle).toBe(true);
    }
  });

  it('1.4 un segment `avatar` seul, sans rien autour, n’est pas une source', () => {
    // Même exigence que pour `analyse` : le segment doit être ENTOURÉ.
    expect(cleDansNamespaceAvatar('media', 'avatar')).toBe(false);
    expect(cleDansNamespaceAvatar('media', 'avatar/')).toBe(false);
  });

  it('1.5 le namespace des analyses n’a pas bougé', () => {
    // On ajoute une garde, on n'en déplace aucune.
    expect(cleDansNamespaceAnalyse('media', `${U}/analyse/a1/vignette-01.jpg`)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le relais public refuse', () => {
  it('2.1 ⚠️ LE PROXY PUBLIC INTERROGE LA GARDE AVATAR', () => {
    expect(PROXY).toContain('cleDansNamespaceAvatar(bucket, storagePath)');
  });

  it('2.2 le refus arrive AVANT tout appel au stockage', () => {
    /* Un compartiment hors liste ou un chemin douteux ne doit pas coûter une
       requête au stockage — et surtout ne doit pas permettre d'en SONDER
       l'existence. */
    const garde = PROXY.indexOf('cleDansNamespaceAvatar');
    const appel = PROXY.indexOf('cibleRecevable(bucket, storagePath)');
    expect(garde).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(garde);
  });

  it('2.3 ⚠️ ON REFUSE À L’ÉCRITURE CE QU’ON REFUSE À LA LECTURE', () => {
    /* Les routes d'envoi interpolent `purpose` tel quel dans la clé. Sans ce
       refus, un appelant obtiendrait `<userId>/avatar/…` délivrée par notre
       propre serveur, que le blocage rendrait ensuite illisible — sans
       message, sans trace, et sans qu'il puisse comprendre pourquoi. */
    expect(purposeAcceptable(SEGMENT_NAMESPACE_AVATAR)).toBe(false);
    expect(purposeAcceptable('analyse')).toBe(false);
    // Les usages légitimes restent ouverts.
    expect(purposeAcceptable('library')).toBe(true);
    expect(purposeAcceptable('rushes')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La lecture exige la session ET la propriété', () => {
  it('3.1 ⚠️ NI COMPARTIMENT NI CLÉ NE VIENNENT DU NAVIGATEUR', () => {
    // Un identifiant, et rien d'autre : il n'y a pas de clé à valider,
    // parce qu'aucune clé ne peut entrer.
    expect(ROUTE).not.toMatch(/searchParams|req\.json\(\)|params\.(bucket|cle|key)/);
  });

  it('3.2 la propriété est dans la requête, pas dans une décision après coup', () => {
    expect(ROUTE).toContain(".eq('id', params.id ?? '')");
    expect(ROUTE).toContain(".eq('user_id', userId)");
  });

  it('3.3 ⚠️ LA PROPRIÉTÉ AVANT LE STOCKAGE', () => {
    /* Interroger MinIO sur la clé d'un tiers, même pour refuser ensuite,
       ferait de cette route un révélateur d'existence. */
    const proprio = ROUTE.indexOf(".eq('user_id', userId)");
    const stockage = ROUTE.indexOf('await ouvrirSourceAvatar(cle)');
    expect(proprio).toBeGreaterThan(-1);
    expect(stockage).toBeGreaterThan(proprio);
  });

  it('3.4 la session est lue avant la base', () => {
    const auth = ROUTE.indexOf('const session = await auth()');
    const base = ROUTE.indexOf("from('user_avatars')");
    expect(auth).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(auth);
  });

  it('3.5 ⚠️ AUCUN ORACLE D’EXISTENCE — une seule réponse pour quatre causes', () => {
    /* Avatar inconnu, avatar d'autrui, source jamais enregistrée, objet
       disparu : un 403 sur l'avatar d'un tiers confirmerait son existence. */
    expect(ROUTE).toContain("status: 404");
    expect(ROUTE).not.toMatch(/status:\s*403/);
    expect((ROUTE.match(/introuvable\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('3.6 sans session, 401 avant toute lecture', () => {
    expect(ROUTE).toContain("{ ok: false, error: 'Unauthorized' }, { status: 401 }");
    const nonAuth = ROUTE.indexOf('401');
    const base = ROUTE.indexOf("from('user_avatars')");
    expect(nonAuth).toBeLessThan(base);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La clé est revalidée, même venant de notre base', () => {
  it('4.1 ⚠️ UNE CLÉ D’UN AUTRE COMPTE EST REFUSÉE', () => {
    const mienne = cleSourceAvatar(U, 'jpg', 1);
    expect(cleSourceAvatarDuCompte(mienne, U)).toBe(true);
    expect(cleSourceAvatarDuCompte(mienne, AUTRE)).toBe(false);
  });

  it('4.2 hors du namespace, ce n’est pas une source d’avatar', () => {
    expect(cleSourceAvatarDuCompte(`${U}/library/photo.jpg`, U)).toBe(false);
    expect(cleSourceAvatarDuCompte(`${U}/analyse/a/vignette-01.jpg`, U)).toBe(false);
  });

  it('4.3 les formes tordues sont refusées', () => {
    for (const cle of [
      `${U}/avatar/../autre/x.jpg`,
      `${U}/avatar//x.jpg`,
      `${U}/avatar/`,
      `https://ailleurs/${U}/avatar/x.jpg`,
      '',
      null,
      42,
    ]) {
      expect(cleSourceAvatarDuCompte(cle as never, U), String(cle)).toBe(false);
    }
  });

  it('4.4 un compte vide ne valide rien', () => {
    expect(cleSourceAvatarDuCompte(`${U}/avatar/x.jpg`, '')).toBe(false);
  });

  it('4.5 la route revalide la clé qu’elle vient de lire', () => {
    // Une ligne ancienne peut porter autre chose qu'une clé du namespace de
    // son propriétaire : la lecture filtrée ne dispense pas du contrôle.
    expect(ROUTE).toContain('cleSourceAvatarDuCompte(cle, userId)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Ce qui est servi, et comment', () => {
  it('5.1 ⚠️ LE TYPE EST DÉCIDÉ, JAMAIS LU SUR L’OBJET', () => {
    /* MinIO pose `application/octet-stream` dès qu'un téléversement n'a rien
       déclaré ; s'y fier laisserait servir en HTML, depuis notre origine, un
       fichier déposé par un autre chemin. */
    expect(typeSourceAvatar('a/avatar/x.jpg')).toBe('image/jpeg');
    expect(typeSourceAvatar('a/avatar/x.mp4')).toBe('video/mp4');
    expect(typeSourceAvatar('a/avatar/x.webm')).toBe('video/webm');
  });

  it('5.2 une extension inconnue ne se devine pas, elle se refuse', () => {
    for (const cle of ['a/avatar/x.svg', 'a/avatar/x.html', 'a/avatar/x', 'a/avatar/x.exe']) {
      expect(typeSourceAvatar(cle), cle).toBeNull();
    }
    expect(ROUTE).toContain('if (typeContenu === null) return introuvable()');
  });

  it('5.3 ⚠️ AUCUN CACHE PARTAGÉ SUR UN VISAGE', () => {
    expect(ROUTE).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(ROUTE).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(ROUTE).toContain("default-src 'none'");
  });

  it('5.4 les octets ne sont pas matérialisés', () => {
    // Ni `Buffer`, ni `arrayBuffer()`, ni fichier temporaire.
    expect(ROUTE).toContain('Readable.toWeb');
    expect(ROUTE).not.toMatch(/arrayBuffer\(\)|Buffer\.concat/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Plus aucune URL publique sur une source', () => {
  it('6.1 ⚠️ `getPublicUrl` A DISPARU DU CHEMIN AVATAR', () => {
    // C'est LE défaut d'origine, en une ligne.
    expect(CREATE).not.toContain('getPublicUrl');
  });

  it('6.2 ce qui est persisté est une CLÉ, pas une adresse', () => {
    expect(CREATE).toContain('source_object_key: sourceObjectKey');
    expect(CREATE).toContain('cleSourceAvatar(userId, ext, Date.now())');
  });

  it('6.3 ⚠️ `source_url` N’EST PLUS ÉCRITE', () => {
    /* Elle reste en base pour les lignes antérieures — les priver de leur
       source les rendrait aveugles — mais plus une seule URL publique n'y
       atterrit. */
    expect(CREATE).not.toMatch(/source_url:\s*\w/);
  });

  it('6.4 l’écran ne lit plus l’URL publique', () => {
    expect(PAGE).not.toMatch(/src=\{avatar\.source_url\}/);
    expect(PAGE).toContain('/api/avatar/${avatar.id}/source');
  });

  it('6.5 ⚠️ UNE SOURCE ILLISIBLE N’EST DEMANDÉE QU’UNE FOIS', () => {
    // Sans ce frein, un 404 coûterait une requête à chaque rendu React.
    expect(PAGE).toContain('sourceIndisponible');
    expect(PAGE).toContain('onError={() => setSourceIndisponible(true)}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le contrat de transmission — écrit, jamais appelé', () => {
  it('7.1 ⚠️ AUCUN APPEL FOURNISSEUR DANS CE MODULE', () => {
    /* Il prépare un accès, il ne s'en sert pas. Le branchement est A_8c ;
       mélanger les deux ferait de la préparation une dépense. */
    expect(SOURCE).not.toMatch(/heygen|api\.heygen|fetch\(/i);
  });

  it('7.2 le contrat n’est encore appelé nulle part', () => {
    const partout = [CREATE, ROUTE, PAGE].join('\n');
    expect(partout).not.toContain('preparerSourceAvatarPourProvider');
  });

  it('7.3 ⚠️ L’URL SIGNÉE EST COURTE', () => {
    /* Une URL signée est un droit d'accès à un visage : plus elle vit, plus la
       fenêtre pendant laquelle une fuite reste exploitable est grande. */
    expect(TTL_SOURCE_AVATAR_SECONDES).toBe(300);
    expect(TTL_SOURCE_AVATAR_SECONDES).toBeLessThanOrEqual(600);
  });

  it('7.4 ⚠️ AUCUNE URL SIGNÉE N’EST ÉCRITE EN BASE', () => {
    /* La ranger la rendrait permanente par accident — c'est le défaut
       d'origine sous un autre nom. */
    expect(SOURCE).not.toMatch(/insert\(|update\(|supabaseAdmin/);
    expect(CREATE).not.toContain('presigned');
  });

  it('7.5 ⚠️ AUCUNE URL SIGNÉE N’EST JOURNALISÉE', () => {
    // Un journal est un endroit où une adresse survit à son expiration.
    expect(SOURCE).not.toMatch(/console\.(log|warn|error)/);
    expect(ROUTE).not.toMatch(/console\.(log|warn|error)/);
  });

  it('7.6 la signature part d’un compte, jamais d’une clé du client', () => {
    expect(SOURCE).toContain('cleSourceAvatarDuCompte(cle, userId)');
    const garde = SOURCE.indexOf('cleSourceAvatarDuCompte(cle, userId)');
    const signature = SOURCE.indexOf('presignedGetObject');
    expect(garde).toBeLessThan(signature);
  });

  it('7.7 les deux modes de transport restent ouverts', () => {
    // Trancher le protocole avant de connaître l'exigence du fournisseur
    // serait décider sans savoir.
    expect(SOURCE).toContain("'url_signee_courte'");
    expect(SOURCE).toContain("'flux_serveur'");
  });

  it('7.8 le compartiment est celui des médias, pas un nouveau', () => {
    expect(BUCKET_AVATAR).toBe('media');
  });
});
