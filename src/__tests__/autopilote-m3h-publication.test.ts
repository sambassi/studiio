// @vitest-environment node
/**
 * M3-H (H4) — LA PUBLICATION ET LA LECTURE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le stockage et la base ne partagent AUCUNE transaction. Quatre défauts
 * coûteraient cher, et ce sont eux que les tests visent :
 *
 *   1. LE FAUX SUCCÈS. Un `putObject` accepté ne suffit pas ; un code 0 de
 *      ffmpeg encore moins. `reussie` n'existe qu'après le fichier ET la
 *      consignation.
 *   2. L'ORPHELIN MUET. Un objet monté que la base ne peut plus référencer
 *      doit être retiré ; si le retrait échoue, il est TRACÉ — jamais tu.
 *   3. LA PLACE PRISE DEUX FOIS. Il n'y en a qu'une : la reprendre dans le
 *      travail ferait échouer tout rendu en `capacite_saturee`.
 *   4. LA FUITE PAR LA LECTURE. Ni URL, ni compartiment, ni clé, ni motif
 *      hors vocabulaire ne doivent atteindre le navigateur.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Le stockage, doublé
// ───────────────────────────────────────────────────────────────────────────
const objetsEcrits: Array<{ bucket: string; cle: string; type: string; taille: number }> = [];
/** Ce que la relecture rendra, pour éprouver le contrôle de taille. */
let tailleRelue: number | null = null;
const objetsSupprimes: Array<{ bucket: string; cle: string }> = [];
let putCasse = false;
let removeCasse = false;

vi.mock('@/lib/storage/minio-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  clientMinio: () => ({
    putObject: async (bucket: string, cle: string, flux: unknown, taille: number,
      entetes: Record<string, string>) => {
      // ⚠️ LE FLUX EST FERMÉ, MÊME EN CAS D'ÉCHEC. Le vrai client le consomme ;
      // le laisser ouvert fait remonter son `open` APRÈS le démontage du
      // répertoire, en erreur non capturée — verte au tableau, orpheline à
      // côté.
      // Le vrai client consomme le flux et propage son erreur dans la
      // promesse ; la doublure doit au moins l'écouter, sinon l'ouverture
      // ratée remonte en erreur non capturée après le démontage.
      const f = flux as { on?: (e: string, h: () => void) => void; destroy?: () => void };
      f?.on?.('error', () => {});
      f?.destroy?.();
      if (putCasse) throw new Error('echec ecriture studiio-minio:9000');
      objetsEcrits.push({ bucket, cle, type: entetes['Content-Type'], taille });
      return {};
    },
    // Le vrai client est RELU après l'envoi : le SDK n'impose pas la taille
    // annoncée, et un multipart repris pourrait mêler deux encodages.
    statObject: async (bucket: string, cle: string) => {
      const vu = objetsEcrits.find((o) => o.bucket === bucket && o.cle === cle);
      if (!vu) throw new Error('objet absent studiio-minio:9000');
      return { size: tailleRelue ?? vu.taille };
    },
    removeObject: async (bucket: string, cle: string) => {
      if (removeCasse) throw new Error('echec suppression studiio-minio:9000');
      objetsSupprimes.push({ bucket, cle });
      return {};
    },
  }),
  lecteurMinio: () => ({ getObject: async () => 'flux' }),
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: UID } }) }));

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const RID = '55555555-5555-4555-8555-000000000001';

/**
 * Un vrai fichier local.
 *
 * ⚠️ `createReadStream` SUR UN CHEMIN ABSENT ÉMET UNE ERREUR ASYNCHRONE que
 * rien n'attrape : la suite restait verte avec quatre erreurs orphelines à
 * côté. Une couverture qui se tait sur une erreur non capturée est exactement
 * ce que ce lot a corrigé ailleurs.
 */
let atelier = '';
let fichierLocal = '';

// ⚠️ `rendreEtPublier` N'EST PAS IMPORTÉE ICI, ET C'EST DÉLIBÉRÉ. Ce fichier
// éprouve le téléversement et la lecture ; l'orchestration, elle, est
// RÉELLEMENT EXÉCUTÉE dans `autopilote-m3h-finalisation.test.ts`. L'importer
// sans l'appeler avait fait croire à une couverture qui n'existait pas —
// TypeScript le signalait lui-même (`TS6133`).
import { produireMontage, type Finalisation } from '@/lib/autopilot/analyse/rendu';
import { renduPublic } from '@/lib/autopilot/analyse/rendu-presentation';
import {
  BUCKET_RENDUS_MONTAGE, CHAMPS_INTERDITS_RENDU, CONTENT_TYPE_RENDU, cleRendu,
  METHODE_RENDU,
} from '@/lib/autopilot/analyse/rendu-contrat';
import {
  prendrePlaceRendu, reinitialiserCapacite, rendusMontageEnCoursMaintenant,
} from '@/lib/autopilot/analyse/capacite';
import type { RenduMontage } from '@/lib/autopilot/analyse/rendu-service';
import type { MesureRendu } from '@/lib/autopilot/analyse/rendu-ffmpeg';

const SRC = {
  orchestration: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu.ts'),
  moteur: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-ffmpeg.ts'),
  presentation: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-presentation.ts'),
  routeEtat: resolve(process.cwd(), 'src/app/api/autopilot/rendus-montage/[renduId]/route.ts'),
  routeFichier: resolve(process.cwd(), 'src/app/api/autopilot/rendus-montage/[renduId]/fichier/route.ts'),
  routePost: resolve(process.cwd(), 'src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts'),
};

const MESURE: MesureRendu = {
  octets: 4242, dureeMesureeSecondes: 25.02, largeur: 1080, hauteur: 1920,
  fpsMesure: 30, codecVideo: 'h264', pixelFormat: 'yuv420p',
  aAudio: true, codecAudio: 'aac', frequenceAudio: 48_000,
};

function unRendu(over: Partial<RenduMontage> = {}): RenduMontage {
  return {
    id: RID, userId: UID, montagePlanId: 'p1', montagePlanVersion: 1,
    methodeRendu: METHODE_RENDU, etat: 'en_attente', etape: null,
    resultat: null, motifEchec: null, usage: {},
    createdAt: '2026-09-06T10:00:00Z', startedAt: null, completedAt: null,
    updatedAt: '2026-09-06T10:00:00Z',
    ...over,
  } as RenduMontage;
}

beforeAll(() => {
  atelier = mkdtempSync(join(tmpdir(), 'm3h-publication-'));
  fichierLocal = join(atelier, 'montage.mp4');
  writeFileSync(fichierLocal, Buffer.alloc(MESURE.octets, 0x66));
});
afterAll(() => { if (atelier) rmSync(atelier, { recursive: true, force: true }); });

beforeEach(() => {
  reinitialiserCapacite();
  objetsEcrits.length = 0;
  objetsSupprimes.length = 0;
  putCasse = false;
  removeCasse = false;
  tailleRelue = null;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-4. La place : une seule, et transmise', () => {
  it('LA PLACE DÉJÀ TENUE EST RÉUTILISÉE, jamais reprise', async () => {
    // ⚠️ LE TEST QUI ATTRAPE LE DÉFAUT FATAL. La route prend la place AVANT
    // de créer la ligne — sinon une saturation laisserait une ligne qui
    // occuperait l'index actif. Si le travail en redemandait une seconde,
    // TOUT rendu échouerait en `capacite_saturee` : il n'y en a qu'une.
    const place = prendrePlaceRendu()!;
    expect(rendusMontageEnCoursMaintenant()).toBe(1);

    const r = await produireMontage(
      { userId: UID, plan: { plans: [], usage: {} } as never }, undefined, place,
    );
    // Le refus vient du plan vide, PAS de la capacité.
    expect(r.motif).toBe('plan_non_conforme');
    expect(r.motif).not.toBe('capacite_saturee');
  });

  it('sans place tenue, elle est prise — et rendue', async () => {
    const r = await produireMontage({
      userId: UID, plan: { plans: [], usage: {} } as never,
    });
    expect(r.motif).toBe('plan_non_conforme');
    expect(rendusMontageEnCoursMaintenant()).toBe(0);
  });

  it('la route TRANSMET sa place au travail', () => {
    const src = readFileSync(SRC.routePost, 'utf8');
    // La place est prise dans la route, puis passée — jamais reprise.
    expect(src).toContain('place = prendrePlaceRendu()');
    expect(src).toMatch(/rendreEtPublier\([\s\S]*?\n\s*place,\n\s*\)/);
    const orch = readFileSync(SRC.orchestration, 'utf8');
    expect(orch).toContain('placeTenue ?? prendrePlaceRendu()');
  });

  it('un rendu réussi identique est servi AVANT toute capacité', () => {
    // ⚠️ L'ORDRE COMPTE. Chercher l'existant après avoir pris la place
    // referait payer une capacité pour un fichier déjà prêt.
    const src = readFileSync(SRC.routePost, 'utf8');
    const corps = /export async function POST\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(corps.indexOf('lireRenduReussiIdentique'))
      .toBeLessThan(corps.indexOf('prendrePlaceRendu'));
    expect(corps.indexOf('lireRenduReussiIdentique'))
      .toBeLessThan(corps.indexOf('creerRendu'));
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('5-12. L’atomicité : les quatre issues, et leurs compensations', () => {
  function finalisation(over: Partial<Finalisation> = {}): {
    f: Finalisation; consignes: unknown[]; clotures: unknown[];
  } {
    const consignes: unknown[] = [];
    const clotures: unknown[] = [];
    return {
      consignes, clotures,
      f: {
        consigner: async (bucket, cle, mesure, usage) => {
          consignes.push({ bucket, cle, mesure, usage });
          return 'consigne';
        },
        clore: async (motif, usage) => { clotures.push({ motif, usage }); },
        ...over,
      },
    };
  }

  /** Court-circuite la production : on éprouve la publication seule. */
  async function publier(
    f: Finalisation, resultat: { ok: boolean; motif?: string; abandonne?: boolean },
  ) {
    const { televerserRendu } = await import('@/lib/autopilot/analyse/rendu-ffmpeg');
    const usage: Record<string, unknown> = {};
    if (!resultat.ok) {
      await f.clore((resultat.motif ?? 'encodage_echoue') as never, usage);
      return { usage, publie: null };
    }
    const envoi = await televerserRendu(UID, RID, fichierLocal, MESURE.octets);
    if (!envoi.ok) {
      await f.clore(envoi.motif, usage);
      return { usage, publie: null };
    }
    return { usage, publie: { bucket: envoi.bucket, cle: envoi.cle } };
  }

  it('CAS A — le téléversement échoue : aucun objet, aucune réussite', async () => {
    putCasse = true;
    const { f, consignes, clotures } = finalisation();
    const r = await publier(f, { ok: true });
    expect(r.publie).toBeNull();
    expect(objetsEcrits).toHaveLength(0);
    expect(consignes).toHaveLength(0);
    expect(clotures).toEqual([{ motif: 'televersement_echoue', usage: {} }]);
  });

  it('CAS B — tout réussit : la CLÉ, le COMPARTIMENT et le TYPE sont les bons', async () => {
    const { f, consignes } = finalisation();
    const r = await publier(f, { ok: true });
    expect(r.publie).toEqual({
      bucket: BUCKET_RENDUS_MONTAGE, cle: cleRendu(UID, RID),
    });
    expect(objetsEcrits).toHaveLength(1);
    expect(objetsEcrits[0].bucket).toBe('videos');
    expect(objetsEcrits[0].cle).toBe(`${UID}/autopilote/montages/${RID}/montage.mp4`);
    // Le type est DÉCIDÉ par nous, jamais lu sur l'objet — c'est ce qui évite
    // qu'un dépôt en `text/html` soit servi depuis l'origine de la session.
    expect(objetsEcrits[0].type).toBe(CONTENT_TYPE_RENDU);
    expect(consignes).toHaveLength(0);
  });

  it('UN OBJET TRONQUÉ N’EST PAS UN TÉLÉVERSEMENT RÉUSSI', async () => {
    // ⚠️ LE SDK N'IMPOSE PAS LA TAILLE ANNONCÉE : un fichier tronqué monte en
    // 200 sans un mot. Et au-delà de la taille de partie, il REPREND un envoi
    // multiple inachevé — deux encodages ne sont pas garantis identiques, si
    // bien qu'un rejeu pourrait assembler un fichier mêlant les deux. Relire
    // la taille attrape les deux cas.
    const { televerserRendu } = await import('@/lib/autopilot/analyse/rendu-ffmpeg');
    tailleRelue = 17;
    const envoi = await televerserRendu(UID, RID, fichierLocal, MESURE.octets);
    expect(envoi.ok).toBe(false);
    expect((envoi as { motif: string }).motif).toBe('televersement_echoue');
    // La relecture est bien faite sur la source, pas seulement supposée.
    const src = readFileSync(SRC.moteur, 'utf8');
    expect(src).toContain('.statObject(BUCKET_RENDUS_MONTAGE, cle)');
    expect(src).toContain('!== octets');
  });

  it('LE BUDGET COMPTE L’ENVOI MULTIPLE, pas une seule requête', async () => {
    // ⚠️ LA BORNE EST PAR REQUÊTE. Au-delà de la taille de partie, le SDK
    // découpe : une initialisation, N parties, un assemblage — chacune bornée.
    // N'en compter qu'une rendait de nouveau fausse l'affirmation « aucun
    // travail ne peut dépasser le budget ».
    const c = await import('@/lib/autopilot/analyse/rendu-contrat');
    expect(c.PARTIES_TELEVERSEMENT).toBeGreaterThan(1);
    expect(c.PARTIES_TELEVERSEMENT)
      .toBe(Math.ceil(c.RENDU_OCTETS_MAX / c.OCTETS_PAR_PARTIE));
    expect(c.PEREMPTION_RENDU_MS).toBeGreaterThan(c.BUDGET_RENDU_MAX_MS);
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-contrat.ts'), 'utf8',
    );
    expect(src).toContain('PARTIES_TELEVERSEMENT * TIMEOUT_TELEVERSEMENT_RENDU_MS');
  });

  it('LE RELAIS PUBLIC NE SERT PLUS LES MONTAGES', async () => {
    // ⚠️ SANS CETTE FERMETURE, LA ROUTE AUTHENTIFIÉE NE PROTÉGEAIT RIEN. Le
    // montage vit dans `videos`, un compartiment de la liste blanche : le
    // relais ouvert le rendait SANS COOKIE, et le propriétaire — qui connaît
    // les deux identifiants de la clé — pouvait en faire un lien public,
    // permanent et irrévocable.
    const { cleDansNamespaceMontage } = await import('@/lib/storage/acces-objet');
    expect(cleDansNamespaceMontage('videos', cleRendu(UID, RID))).toBe(true);
    // Un autre compartiment, ou une clé sans le segment, ne sont pas visés.
    expect(cleDansNamespaceMontage('media', cleRendu(UID, RID))).toBe(false);
    expect(cleDansNamespaceMontage('videos', `${UID}/autopilote/clips/x.mp4`)).toBe(false);
    // Et le relais l'applique.
    const relais = readFileSync(
      resolve(process.cwd(), 'src/app/storage/v1/object/public/[bucket]/[...path]/route.ts'),
      'utf8',
    );
    expect(relais).toContain('if (cleDansNamespaceMontage(bucket, storagePath)) return false;');
  });

  it('CAS C — la base refuse : l’objet est RETIRÉ', async () => {
    const { televerserRendu, supprimerObjetRendu } =
      await import('@/lib/autopilot/analyse/rendu-ffmpeg');
    const envoi = await televerserRendu(UID, RID, fichierLocal, 42);
    expect(envoi.ok).toBe(true);
    expect(await supprimerObjetRendu(BUCKET_RENDUS_MONTAGE, cleRendu(UID, RID))).toBe(true);
    expect(objetsSupprimes).toEqual([
      { bucket: 'videos', cle: cleRendu(UID, RID) },
    ]);
  });

  it('CAS C bis — LE RETRAIT ÉCHOUE : l’orphelin est TRACÉ, jamais tu', async () => {
    // ⚠️ NE JAMAIS MENTIR SUR CE QUI RESTE. Un objet qu'on n'a pas su retirer
    // occupe le stockage pour toujours ; l'écrire transforme une fuite
    // invisible en une fuite recensée, qu'une purge saura reprendre.
    removeCasse = true;
    const src = readFileSync(SRC.orchestration, 'utf8');
    const bloc = /async function compenser\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(bloc).toContain('supprimerObjetRendu');
    expect(bloc).toContain("usage.orphelins");
    // Compartiment et clé, RIEN D'AUTRE — pas d'URL, pas la sortie du SDK.
    expect(bloc).toContain('{ bucket: objet.bucket, cle: objet.cle }');
    // Ce qui entre dans le relevé ne porte QUE ces deux champs — ni message
    // du SDK, ni URL, ni chemin.
    const ecrit = /usage\.orphelins = \[([^\]]*)\]/.exec(bloc)![1];
    expect(ecrit).toBe('...deja, { bucket: objet.bucket, cle: objet.cle }');
    // ⚠️ ET AU JOURNAL AUSSI : quand la ligne a disparu, le relevé ne sera
    // jamais écrit et la trace en mémoire s'évanouirait avec le processus.
    expect(bloc).toContain('orphelin non supprimé');
  });

  it('UN JET DE LA CONSIGNATION NE LAISSE PAS D’ORPHELIN MUET', () => {
    // La persistance peut REFUSER par une exception — contrainte de base,
    // socle absent — et cela ne passe pas par une valeur de retour.
    const src = readFileSync(SRC.orchestration, 'utf8');
    const bloc = /let issue: IssueConsignation;[\s\S]*?if \(issue === 'consigne'\)/.exec(src)![0];
    expect(bloc).toContain('try {');
    expect(bloc).toContain('} catch {');
    expect(bloc).toContain("issue = 'non_consigne'");
    // Et tout ce qui n'est pas une consignation compense.
    expect(src).toContain('await compenser(objet, resultat.usage)');
  });

  it('`reussie` N’EXISTE QUE PAR LA CONSIGNATION', () => {
    // Aucun autre chemin n'écrit cet état : ni le moteur, ni le
    // téléversement, ni la mesure.
    for (const f of [SRC.orchestration, SRC.moteur]) {
      const s = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(s).not.toMatch(/etat:\s*'reussie'/);
    }
    // Seule la route l'écrit, et seulement dans `consigner`.
    const route = readFileSync(SRC.routePost, 'utf8');
    expect((route.match(/etat: 'reussie'/g) ?? []).length).toBe(1);
    const consigner = /consigner: async \(([\s\S]*?)\n {8}\},/.exec(route)![1];
    expect(consigner).toContain("etat: 'reussie'");
    expect(consigner).toContain('resultat: { ...mesure, bucket, cle }');
    // Et la base l'exige aussi : un `reussie` sans fichier est refusé.
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/2026-09-06-rush-montage-renders.sql'), 'utf8',
    );
    expect(sql).toContain("check (etat <> 'reussie' or resultat ? 'cle')");
  });

  it('AUCUNE URL n’est produite ni persistée sur le chemin de publication', () => {
    for (const f of [SRC.orchestration, SRC.moteur, SRC.presentation]) {
      const s = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(s).not.toMatch(/presignedGetObject|presignedPutObject|signeurPublic/);
      expect(s).not.toMatch(/https?:\/\//);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('13-20. La lecture : ce que le navigateur voit, et ne voit pas', () => {
  it('LA PROJECTION N’EXPOSE AUCUN CHAMP INTERNE', () => {
    const p = renduPublic(unRendu({
      etat: 'reussie',
      resultat: { ...MESURE, bucket: 'videos', cle: cleRendu(UID, RID) } as never,
      usage: { orphelins: [{ bucket: 'videos', cle: 'secret' }], encodageMs: 1 },
      completedAt: '2026-09-06T10:05:00Z',
    }));
    const texte = JSON.stringify(p);
    // ⚠️ NI COMPARTIMENT, NI CLÉ, NI RELEVÉ. `usage.orphelins` nomme des
    // objets du stockage : le rendre renseignerait sur ce qui traîne.
    expect(texte).not.toContain('videos');
    expect(texte).not.toContain('orphelins');
    expect(texte).not.toContain('secret');
    expect(texte).not.toContain(METHODE_RENDU);
    expect(texte).not.toContain('montagePlanId');
    expect(texte).not.toContain('encodageMs');
    expect(texte).not.toMatch(/https?:\/\//);
    // Ce qu'un écran a réellement besoin de savoir.
    expect(p.video).toMatchObject({
      dureeSecondes: 25.02, largeur: 1080, hauteur: 1920, octets: 4242,
    });
    expect(p.video!.chemin).toBe(`/api/autopilot/rendus-montage/${RID}/fichier`);
  });

  it('AUCUNE PROGRESSION INVENTÉE', () => {
    const p = renduPublic(unRendu({ etat: 'en_cours', etape: 'encodage' }));
    expect(p.etape).toBe('encodage');
    // M3-H ne sait pas qu'il est à 43 % : il sait quelle étape il traverse.
    expect(JSON.stringify(p)).not.toMatch(/progress|pourcent|percent|43/i);
    expect(p.video).toBeNull();
    expect(p.motif).toBeNull();
  });

  it('LE MOTIF EXPOSÉ EST TOUJOURS DU VOCABULAIRE FERMÉ', () => {
    expect(renduPublic(unRendu({ etat: 'echouee', motifEchec: 'encodage_echoue' })).motif)
      .toBe('encodage_echoue');
    // ⚠️ UN MESSAGE INTERNE NE SORT PAS. Une ligne écrite par une version
    // ancienne pourrait en porter un ; il est filtré à la projection.
    expect(renduPublic(unRendu({
      etat: 'echouee',
      motifEchec: 'ffmpeg: /tmp/studiio-m3h-ab/src-00.mp4 Invalid data',
    })).motif).toBeNull();
    // Et un rendu en cours n'a pas de motif, même s'il en portait un.
    expect(renduPublic(unRendu({ etat: 'en_cours', motifEchec: 'encodage_echoue' })).motif)
      .toBeNull();
  });

  it('UNE RÉUSSITE SANS FICHIER N’EXPOSE PAS DE CHEMIN', () => {
    // La base l'interdit, la relecture le rattrape — et la projection ne
    // fabrique pas un lien vers un fichier qui n'existe pas.
    expect(renduPublic(unRendu({ etat: 'reussie', resultat: null })).video).toBeNull();
  });

  it('LA ROUTE FICHIER : la clé vient de la BASE et est REVALIDÉE', () => {
    const src = readFileSync(SRC.routeFichier, 'utf8');
    // Le client n'envoie qu'un identifiant de rendu.
    expect(src).toContain('lireRenduParId(session.user.id, params.renduId)');
    expect(src).not.toMatch(/params\.(bucket|cle|path)/);
    expect(src).toContain('cleValide(rendu.resultat.cle, session.user.id)');
    // Le type est décidé ici, avec ses deux gardes.
    expect(src).toContain("'Content-Type': CONTENT_TYPE_RENDU");
    expect(src).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(src).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    // Inconnu, d'autrui, pas encore prêt : une seule et même réponse.
    expect((src.match(/introuvable\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('AUCUNE URL SIGNÉE : le dépôt n’en a pas d’atteignable, et c’est écrit', () => {
    const minio = readFileSync(
      resolve(process.cwd(), 'src/lib/storage/minio-client.ts'), 'utf8',
    );
    // ⚠️ VÉRIFIÉ SUR LA SOURCE, PAS SUPPOSÉ. Le signeur de lecture est
    // INTERNE, et sa propre documentation dit que son URL ne doit jamais
    // sortir du serveur ; le signeur public ne sait signer qu'un dépôt.
    expect(minio).toContain('ne doit JAMAIS');
    expect(minio).toContain('presignedPutObject');
    const corps = /export function signeurPublic\(\)[\s\S]*?\n\}/.exec(minio)![0];
    expect(corps).toContain('presignedPutObject');
    // ⚠️ IL NE SAIT SIGNER QU'UN DÉPÔT. C'est ce qui rend impossible une URL
    // de lecture atteignable par un navigateur.
    expect(corps).not.toContain('presignedGetObject');
    // Le relais public, lui, répond sans session — par nécessité.
    const relais = readFileSync(
      resolve(process.cwd(), 'src/app/storage/v1/object/public/[bucket]/[...path]/route.ts'),
      'utf8',
    );
    expect(relais).toContain('CE QUE CETTE ROUTE NE FAIT PAS : DEMANDER UNE SESSION');
    // Donc les deux routes M3-H exigent une session, chacune.
    for (const f of [SRC.routeEtat, SRC.routeFichier]) {
      expect(readFileSync(f, 'utf8')).toContain('const session = await auth()');
    }
  });

  it('LA ROUTE D’ÉTAT N’ÉCRIT RIEN', () => {
    const src = readFileSync(SRC.routeEtat, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Consulter l'avancement ne doit pas le terminer : un écran qui
    // rafraîchit toutes les cinq secondes tuerait le rendu qu'il regarde.
    expect(src).not.toMatch(/majRendu|creerRendu|recupererRendusInterrompus/);
    expect(src).toContain('lireRenduParId');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('21-26. Ce que H4 ne fait pas', () => {
  const sources = () => Object.values(SRC).map((p) => readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/CHAMPS_INTERDITS_RENDU/g, ''));

  it('AUCUN crédit, AUCUN fournisseur, AUCUN modèle de langage', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/@\/lib\/credits|credit_transactions|debiter/);
      expect(s).not.toMatch(/from '@\/lib\/rendus|tarifs_rendu/);
      expect(s).not.toMatch(/anthropic|groq|openai/i);
    }
  });

  it('AUCUN `render_jobs`, `rendus`, `videos` ni `scheduled_posts`', () => {
    for (const s of sources()) {
      expect(s).not.toContain('render_jobs');
      expect(s).not.toMatch(/from\('rendus'\)|from\('videos'\)|scheduled_posts/);
    }
  });

  it('AUCUNE DÉCISION VIDÉO : le fichier publié est celui qui a été validé', () => {
    // Le moteur porte légitimement les paramètres d'encodage — c'est lui qui
    // encode. Ce que la PUBLICATION ne doit pas contenir, c'est un paramètre
    // qui rejugerait ce que la mesure a déjà validé.
    for (const f of [SRC.presentation, SRC.routeEtat, SRC.routeFichier, SRC.routePost]) {
      const s = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(s).not.toMatch(/libx264|crf|preset|scale=|crop=|xfade|concat=/i);
    }
    // La publication reçoit un chemin et une mesure : elle ne réencode rien.
    const orch = readFileSync(SRC.orchestration, 'utf8');
    expect(orch).toContain('demande.userId, renduId, fichier, mesure.octets,');
  });

  it('AUCUN `force`, AUCUN `regenerate` VENANT DU CLIENT', () => {
    // ⚠️ `force: true` de `rm` est une option du système de fichiers, pas un
    // paramètre de rendu : la garde vise ce que le NAVIGATEUR pourrait
    // envoyer, et les deux noms sont dans la liste des champs refusés.
    expect(CHAMPS_INTERDITS_RENDU as readonly string[]).toContain('force');
    expect(CHAMPS_INTERDITS_RENDU as readonly string[]).toContain('regenerate');
    const route = readFileSync(SRC.routePost, 'utf8');
    expect(route).toContain('for (const interdit of CHAMPS_INTERDITS_RENDU)');
    // Et aucune route ne lit ces noms depuis le corps.
    for (const f of [SRC.routePost, SRC.routeEtat, SRC.routeFichier]) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/corps\.(force|regenerate)/);
    }
  });

  it('AUCUNE SECONDE MIGRATION : H2 suffit', () => {
    const migrations = readFileSync(
      resolve(process.cwd(), 'migrations/2026-09-06-rush-montage-renders.sql'), 'utf8',
    );
    // Tout ce que H4 persiste tient dans les colonnes de H2.
    for (const colonne of ['resultat', 'usage', 'etat', 'etape', 'completed_at']) {
      expect(migrations).toContain(colonne);
    }
  });

  it('les modules M3-A à M3-G ne sont pas réécrits', () => {
    const cap = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/capacite.ts'), 'utf8',
    );
    for (const existant of ['MAX_EXTRACTIONS_SIMULTANEES', 'MAX_AUDIO_SIMULTANEES',
      'MAX_TRANSCRIPTIONS_SIMULTANEES', 'MAX_JEUX_CLIPS_SIMULTANES']) {
      expect(cap).toContain(`export const ${existant} = 1;`);
    }
  });
});
