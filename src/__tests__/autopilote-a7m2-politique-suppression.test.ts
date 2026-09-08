/**
 * A_7M2 — SUPPRIMER UN JEU DE CLIPS NE DOIT PLUS DÉTRUIRE UN MONTAGE RENDU.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LA BASE FAISAIT, ET POURQUOI IL A FALLU LE MESURER
 * ---------------------------------------------------------------------------
 *
 * Trois clés étrangères en cascade formaient une chaîne que personne n'avait
 * regardée bout à bout :
 *
 *   rush_clip_sets → rush_montage_plans → rush_montage_renders
 *
 * Chaque maillon, pris seul, se défendait : un plan est dérivé de son jeu de
 * clips, un rendu est dérivé de son plan. Mise bout à bout, la chaîne fait
 * qu'UNE ligne de nettoyage sur un jeu de clips efface un MP4 déjà rendu, dont
 * les octets restent sur MinIO et restent facturés. Le comportement a été
 * reproduit sur une base locale portant les migrations M3-F à A_7M avant
 * d'écrire la correction : `delete from rush_clip_sets` faisait tomber le plan
 * mono-rush ET son rendu réussi, et amputait le plan multi-rush d'une source
 * sans que rien ne le signale.
 *
 * ⚠️ MONO ET MULTI NE DIVERGEAIENT PAS : ils partageaient la même cascade. Ce
 * lot ne réconcilie donc pas deux sémantiques, il corrige une sémantique
 * unique et fausse, aux deux endroits où elle s'exprime.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI `DEFERRABLE`, ET PAS SEULEMENT `NO ACTION`
 * ---------------------------------------------------------------------------
 *
 * `RESTRICT` et `NO ACTION` sec refusent bien le `delete` direct. Ils
 * refusent AUSSI la suppression d'un compte : `delete from users` déclenche
 * deux cascades sœurs, `rush_clip_sets` et `rush_montage_plans`, dont l'ordre
 * n'est pas garanti ; la vérification tombe pendant l'instruction cascadée,
 * quand les plans ne sont pas encore partis. Un utilisateur possédant un seul
 * montage ne pourrait plus supprimer son compte — une garantie d'intégrité
 * transformée en blocage RGPD. Différer la vérification au COMMIT tient les
 * deux exigences : le `delete` isolé échoue, la suppression de compte passe.
 *
 * Ces tests lisent le SQL, pas une base : ils tiennent la DÉCISION. Le
 * comportement, lui, a été vérifié sur PostgreSQL 16 avant d'être figé ici.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Le SQL débarrassé de sa prose : un commentaire ne prouve rien. */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const MIGRATION = lire('migrations/2026-09-08-rush-montage-politique-suppression.sql');
const CODE = sansProse(MIGRATION).toLowerCase();

/** Le corps d'une contrainte recréée, prose exclue. */
const contrainte = (nom: string) => {
  const i = CODE.indexOf(`add constraint ${nom}`);
  expect(i, `contrainte ${nom} absente de la migration`).toBeGreaterThan(-1);
  return CODE.slice(i, i + 400);
};

describe('A_7M2 — un jeu de clips référencé ne se supprime plus', () => {
  it('le plan mono-rush refuse la suppression de son jeu de clips', () => {
    const c = contrainte('rush_montage_plans_jeu_proprietaire');
    expect(c).toContain('references public.rush_clip_sets (id, user_id)');
    expect(c).toContain('on delete no action');
    expect(c).not.toContain('on delete cascade');
  });

  it('la source multi-rush refuse la suppression de son jeu de clips', () => {
    const c = contrainte('rush_montage_plan_sources_jeu_proprietaire');
    expect(c).toContain('references public.rush_clip_sets (id, user_id)');
    expect(c).toContain('on delete no action');
    expect(c).not.toContain('on delete cascade');
  });

  it('mono et multi portent EXACTEMENT la même règle', () => {
    /* ⚠️ LA DIVERGENCE EST LE BUG QU'ON PRÉVIENT ICI. Deux règles voisines
       mais différentes rendraient le comportement dépendant du nombre de
       rushes, ce qu'aucun message d'erreur ne pourrait expliquer. */
    const regle = (nom: string) => {
      const m = contrainte(nom).match(/on delete ([a-z ]+?)\s*(deferrable[a-z ]*)?;/);
      return `${m?.[1]?.trim()} | ${m?.[2]?.trim() ?? ''}`;
    };
    expect(regle('rush_montage_plans_jeu_proprietaire'))
      .toBe(regle('rush_montage_plan_sources_jeu_proprietaire'));
  });
});

describe('A_7M2 — la suppression de compte reste possible', () => {
  it('les deux clés sont différées au COMMIT', () => {
    /* Sans `deferrable initially deferred`, la cascade de `delete from users`
       échoue : la vérification tombe avant que les plans du compte ne soient
       partis. Mesuré, pas supposé — les trois variantes ont été jouées. */
    for (const nom of [
      'rush_montage_plans_jeu_proprietaire',
      'rush_montage_plan_sources_jeu_proprietaire',
    ]) expect(contrainte(nom)).toContain('deferrable initially deferred');
  });

  it('n’emploie ni RESTRICT ni NO ACTION immédiat', () => {
    expect(CODE).not.toContain('on delete restrict');
    // Un `no action` non suivi de `deferrable` serait la variante qui bloque
    // la suppression de compte.
    expect(CODE).not.toMatch(/on delete no action\s*;/);
  });
});

describe('A_7M2 — le rendu et le plan gardent leur sémantique propre', () => {
  it('ne touche pas la clé étrangère du rendu vers son plan', () => {
    /* ⚠️ SECONDE POLITIQUE, SECOND AUDIT. Supprimer un plan supprime encore
       son rendu réussi. C'est un choix DISTINCT — séparer « plan technique »
       et « MP4 publié » — que ce lot se garde de trancher au passage. Ce
       qu'il corrige, c'est qu'on ne puisse plus l'atteindre PAR ACCIDENT
       depuis un jeu de clips. */
    expect(CODE).not.toContain('rush_montage_renders');
  });

  it('laisse les sources tomber avec leur plan', () => {
    /* Une ligne de source n'a aucune valeur hors de son plan : elle EST la
       relation. La cascade plan → sources est la seule qui reste légitime. */
    expect(CODE).not.toContain('rush_montage_plan_sources_plan_proprietaire');
  });

  it('ne remonte pas la chaîne : ni rush, ni analyse, ni candidats', () => {
    for (const table of ['rushes', 'rush_analyses', 'rush_candidate_sets']) {
      expect(CODE).not.toContain(table);
    }
  });
});

describe('A_7M2 — la migration ne détruit rien', () => {
  it('ne crée ni ne supprime aucune table ni colonne', () => {
    expect(CODE).not.toContain('create table');
    expect(CODE).not.toContain('drop table');
    expect(CODE).not.toContain('drop column');
    expect(CODE).not.toContain('add column');
  });

  it('n’efface aucune ligne et n’installe aucune purge', () => {
    /* ⚠️ AUCUN NETTOYAGE SILENCIEUX. Un lot qui resserre une règle de
       suppression est exactement celui où l'on serait tenté d'ajouter un
       « ménage » — et où ce ménage détruirait des montages publiés. */
    expect(CODE).not.toContain('delete from');
    expect(CODE).not.toContain('truncate');
    expect(CODE).not.toContain('create trigger');
    expect(CODE).not.toContain('cron');
  });

  it('se rejoue sans erreur', () => {
    /* Les deux `drop constraint` sont gardés par un `if exists` portant sur
       la règle actuelle, et les `add` par un `if not exists` : un second
       passage ne fait rien. Vérifié sur PostgreSQL 16. */
    expect(CODE).toContain('if exists (');
    expect(CODE).toContain('if not exists (');
    expect((CODE.match(/drop constraint/g) ?? []).length).toBe(2);
  });
});
