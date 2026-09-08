/**
 * A_7M — LA FONDATION SCHÉMA DU MULTI-RUSH.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE LOT NE FAIT PAS, ET POURQUOI C'EST L'ESSENTIEL
 * ---------------------------------------------------------------------------
 *
 * Un plan de montage ne sait aujourd'hui désigner qu'UN jeu de clips :
 * `clip_set_id` est une colonne obligatoire, et une clé étrangère la relie à
 * son propriétaire. Le multi-rush ne peut donc pas être « ajouté » côté
 * application : il n'y a pas d'endroit où écrire la deuxième source. Écrire
 * malgré tout le premier rush dans cette colonne, puis tenir la vraie liste
 * ailleurs, ferait mentir une colonne d'identité — et l'index d'unicité qui
 * s'appuie dessus dédoublonnerait des plans différents.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT : que la fondation soit ADDITIVE. Les plans
 * mono-rush existants gardent leur colonne, leur clé étrangère et leur index
 * d'identité ; rien n'est supprimé, rien n'est réécrit. Un plan multi-rush est
 * une forme NOUVELLE — scalaires historiques à NULL, sources en table fille —
 * qui cohabite avec l'ancienne au lieu de la remplacer.
 *
 * ⚠️ ET QUE LA PROPRIÉTÉ NE PUISSE PAS SE PERDRE EN CHEMIN. Chaque source
 * porte `user_id` et le confronte À LA FOIS au plan et au jeu de clips. Une
 * clé étrangère sur le seul `clip_set_id` laisserait un compte composer un
 * montage avec les rushes d'un autre : la base doit refuser, pas le code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Le SQL débarrassé de sa prose : un commentaire ne prouve rien. */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const MIGRATION = lire('migrations/2026-09-08-rush-montage-plan-sources.sql');
const CODE = sansProse(MIGRATION).toLowerCase();
/** La migration historique, celle que A_7M doit laisser intacte. */
const HISTORIQUE = lire('migrations/2026-09-05-rush-montage-plans.sql');

describe('A_7M — la migration est additive', () => {
  it('ne supprime aucune table ni aucune colonne', () => {
    expect(CODE).not.toContain('drop table');
    expect(CODE).not.toContain('drop column');
    expect(CODE).not.toContain('drop constraint');
    expect(CODE).not.toContain('drop index');
  });

  it('n’efface aucune ligne', () => {
    /* ⚠️ UNE MIGRATION DE FONDATION NE PERD PAS DE DONNÉES. Un `delete` ici
       détruirait des plans déjà rendus, dont le MP4 est publié. */
    expect(CODE).not.toContain('delete from');
    expect(CODE).not.toContain('truncate');
  });

  it('ne touche pas la clé étrangère historique du jeu de clips', () => {
    // Elle survit parce qu'une FK composite en MATCH SIMPLE ne contrôle rien
    // quand une de ses colonnes est NULL : le plan multi-rush passe sans
    // qu'on ait à démonter la garantie du plan mono-rush.
    expect(HISTORIQUE).toContain('rush_montage_plans_jeu_proprietaire');
    expect(CODE).not.toContain('rush_montage_plans_jeu_proprietaire');
  });

  it('laisse l’index d’identité historique gouverner le mono-rush', () => {
    expect(HISTORIQUE).toContain('rush_montage_plans_identite_unique');
    expect(CODE).not.toContain('rush_montage_plans_identite_unique on');
    /* ⚠️ ET ON NE LE REND PAS PARTIEL. Deux NULL ne se heurtent jamais dans un
       index unique Postgres : les plans multi-rush n'y entrent pas en
       collision, l'index n'a donc aucune raison d'être réécrit. */
    expect(CODE).not.toMatch(/rush_montage_plans_identite_unique[\s\S]{0,200}where/);
  });

  it('se rejoue sans erreur', () => {
    for (const forme of [
      'create unique index if not exists rush_montage_plans_id_user_key',
      'create table if not exists public.rush_montage_plan_sources',
      'create index if not exists rush_montage_plan_sources_plan_idx',
      'create index if not exists rush_montage_plan_sources_jeu_idx',
      'create unique index if not exists rush_montage_plans_identite_sources_unique',
      'add column if not exists source_set_fingerprint',
    ]) expect(CODE).toContain(forme);
  });

  it('ne relache que des contraintes, sans jamais en durcir ni changer un type', () => {
    /* ⚠️ LA SEULE ALTERATION AUTORISEE EST `drop not null`. Un `set not null`
       ferait echouer la migration sur la premiere ligne multi-rush ; un
       changement de type reecrirait des colonnes d'identite deja indexees. */
    const alterations = CODE.match(/alter column [a-z_]+ [a-z ]+/g) ?? [];
    expect(alterations.length).toBeGreaterThan(0);
    for (const a of alterations) expect(a).toMatch(/alter column [a-z_]+ drop not null/);
    expect(CODE).not.toContain('set not null');
    expect(CODE).not.toContain('set data type');
    expect(CODE).not.toContain('alter column source_set_fingerprint');
  });

  it('n’ouvre aucun droit', () => {
    // Les deux migrations rush précédentes n'en ouvrent pas non plus : les
    // lectures passent par la clé de service, jamais par PostgREST anonyme.
    expect(CODE).not.toContain('grant');
  });
});

describe('A_7M — un plan peut désormais n’avoir aucun scalaire historique', () => {
  it('rend nullables les quatre colonnes qui interdisaient le multi-rush', () => {
    for (const colonne of [
      'clip_set_id', 'clip_set_version', 'candidate_set_id', 'analysis_id',
    ]) expect(CODE).toContain(`alter column ${colonne} drop not null`);
  });

  it('mais ne les supprime pas', () => {
    /* ⚠️ ELLES RESTENT LA FORME DU MONO-RUSH. Les supprimer casserait tout ce
       qui lit un plan aujourd'hui, pour un gain nul : un plan mono-rush est un
       plan multi-rush à une source, et il n'a pas à être réécrit. */
    for (const colonne of [
      'clip_set_id', 'clip_set_version', 'candidate_set_id', 'analysis_id',
    ]) expect(CODE).not.toContain(`drop column ${colonne}`);
  });
});

describe('A_7M — les sources d’un plan', () => {
  it('sont ordonnées, et l’ordre est unique', () => {
    // La clé primaire porte l'ordre : deux sources au même rang seraient deux
    // montages différents selon qui lit la table en premier.
    expect(CODE).toContain('primary key (plan_id, ordinal)');
    expect(CODE).toContain('check (ordinal >= 0 and ordinal <= 63)');
  });

  it('ne peuvent pas répéter le même jeu de clips', () => {
    /* ⚠️ SINON LA DIVERSITÉ DE A_7b SERAIT UN MENSONGE : un plan « trois
       rushes » pourrait être trois fois le même. */
    expect(CODE).toContain(
      'constraint rush_montage_plan_sources_jeu_unique unique (plan_id, clip_set_id)',
    );
  });

  it('portent une version de jeu qui existe', () => {
    expect(CODE).toContain('clip_set_version integer not null check (clip_set_version >= 1)');
  });

  it('appartiennent au même compte que leur plan ET que leur jeu', () => {
    // Les deux clés étrangères sont COMPOSITES et partagent la colonne
    // `user_id` de la ligne : c'est ce partage, et non deux contrôles séparés,
    // qui rend l'emprunt impossible.
    expect(CODE).toContain('foreign key (plan_id, user_id)');
    expect(CODE).toContain('references public.rush_montage_plans (id, user_id)');
    expect(CODE).toContain('foreign key (clip_set_id, user_id)');
    expect(CODE).toContain('references public.rush_clip_sets (id, user_id)');
  });

  it('exigent la cible composite qui rend cette clé possible', () => {
    // `references (id, user_id)` demande un index unique sur ce couple ;
    // la clé primaire seule sur `id` ne suffit pas.
    expect(CODE).toContain(
      'create unique index if not exists rush_montage_plans_id_user_key\n'
      + '  on public.rush_montage_plans (id, user_id)',
    );
  });

  it('disparaissent avec leur plan', () => {
    const table = CODE.slice(CODE.indexOf('create table if not exists public.rush_montage_plan_sources'));
    expect(table.match(/on delete cascade/g)?.length).toBe(2);
  });
});

describe('A_7M — l’identité d’un plan multi-rush', () => {
  it('repose sur une empreinte des sources ordonnées', () => {
    expect(CODE).toContain('source_set_fingerprint text');
    expect(CODE).toContain('length(source_set_fingerprint) between 8 and 128');
  });

  it('ne s’applique qu’aux plans qui en ont une', () => {
    /* ⚠️ INDEX PARTIEL. Sans le `where`, les plans mono-rush entreraient tous
       avec une empreinte NULL — inoffensif en Postgres, mais l'index dirait
       alors gouverner des lignes qu'il ne gouverne pas. */
    expect(CODE).toContain('where source_set_fingerprint is not null');
  });

  it('distingue les mêmes sources rendues dans deux formats', () => {
    for (const dimension of [
      'algorithme', 'methode_materialisation', 'algorithme_plan',
      'format', 'duree_cible_secondes',
    ]) {
      const index = CODE.slice(CODE.indexOf('rush_montage_plans_identite_sources_unique'));
      expect(index.slice(0, 400)).toContain(dimension);
    }
  });
});

describe('A_7M — la reprise des plans existants', () => {
  it('donne à chaque plan mono-rush sa source de rang 0', () => {
    expect(CODE).toContain('insert into public.rush_montage_plan_sources');
    expect(CODE).toContain('select p.id, p.user_id, 0, p.clip_set_id, p.clip_set_version');
  });

  it('ignore les plans qui n’ont rien à reprendre', () => {
    expect(CODE).toContain('where p.clip_set_id is not null');
    expect(CODE).toContain('and p.clip_set_version is not null');
  });

  it('se rejoue sans doublon', () => {
    expect(CODE).toContain('on conflict do nothing');
  });

  it('n’invente pas d’empreinte pour eux', () => {
    /* ⚠️ UN PLAN REPRIS RESTE MONO-RUSH. Lui poser une empreinte le ferait
       basculer sous le nouvel index d'identité, et deux plans historiques
       légitimement distincts s'y heurteraient. */
    expect(CODE).not.toMatch(/update\s+public\.rush_montage_plans/);
  });
});

describe('A_7M — le lot s’arrête à la fondation', () => {
  it('ne touche pas la limite de clips du moteur', async () => {
    // §3 : A_7M ne modifie pas CLIPS_MAX. La monter est une décision de A_7b,
    // pas un effet de bord d'une migration.
    const { CLIPS_MAX } = await import('@/lib/autopilot/analyse/clip-contrat');
    expect(CLIPS_MAX).toBe(6);
  });

  it('ne change pas encore la forme JSON d’un plan', () => {
    // §21 : `sourceRushId` par segment, pool global, diversité et rendu
    // multi-entrée sont des lots applicatifs. La table existe avant qu'on
    // s'en serve — c'est l'ordre voulu.
    const contrat = lire('src/lib/autopilot/analyse/montage-contrat.ts');
    expect(contrat).not.toContain('sourceRushId');
    expect(contrat).not.toContain('sourceSetFingerprint');
  });
});
