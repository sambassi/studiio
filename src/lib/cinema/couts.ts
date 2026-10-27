/**
 * COUT D'UN FILM — par scene, par plan, et jamais devine.
 *
 * Deux regles tenues par ce module, les deux apprises a nos frais :
 *
 *  1. UN TARIF INCONNU N'EST PAS ZERO. Un fournisseur sans tarif declare rend
 *     `null`, et l'appelant doit l'afficher comme inconnu — pas comme gratuit.
 *     C'est la regle que `fournisseurs/devis-fournisseur.ts` applique deja
 *     cote Autopilote (`MESSAGE_PRIX_INCONNU`).
 *
 *  2. LE COUT SE COMPTE AVANT, PAS APRES. `devisFilm` chiffre ce qu'un rendu
 *     VA couter a partir du plan ; `coutPaye` additionne ce que les scenes ont
 *     DEJA coute. Confondre les deux, c'est facturer deux fois une scene
 *     regeneree.
 *
 * Aucun fournisseur payant n'est actif dans ce module : `FOURNISSEURS_VISUELS`
 * les DECLARE (avec leur tarif public) sans qu'aucun appel ne soit possible,
 * et `actif: false` est ce qui garde le prototype a zero dollar.
 */
import type { Film, NiveauQualite, SceneCinema } from '@/lib/cinema/types';
import { dureeScene } from '@/lib/cinema/types';

export interface TarifFournisseurVisuel {
  id: string;
  libelle: string;
  /** USD par seconde de video produite. `null` = tarif non declare. */
  usdParSeconde: number | null;
  /** Qualites servies par ce fournisseur. */
  qualites: NiveauQualite[];
  /** `false` tant qu'aucune cle n'est branchee ET qu'aucun appel n'est autorise. */
  actif: boolean;
  /** D'ou vient le tarif. Un chiffre sans source est un chiffre invente. */
  source: string;
}

/**
 * Le catalogue. Le seul fournisseur ACTIF est local et gratuit : il dessine
 * les plans dans Remotion. Les autres sont des emplacements, pas des services
 * branches — leurs tarifs restent `null` jusqu'a verification sur la grille
 * publique du fournisseur, au jour ou on les branche.
 */
export const FOURNISSEURS_VISUELS: TarifFournisseurVisuel[] = [
  {
    id: 'cartes-remotion',
    libelle: 'Cartes de plan (Remotion, local)',
    usdParSeconde: 0,
    qualites: ['brouillon', 'standard', 'cinema'],
    actif: true,
    source: 'rendu local, aucun appel sortant',
  },
  {
    id: 'image-vers-video',
    libelle: 'Image vers video (fournisseur a brancher)',
    usdParSeconde: null,
    qualites: ['standard', 'cinema'],
    actif: false,
    source: 'tarif non verifie — a lire sur la grille du fournisseur retenu',
  },
  {
    id: 'texte-vers-video',
    libelle: 'Texte vers video (fournisseur a brancher)',
    usdParSeconde: null,
    qualites: ['cinema'],
    actif: false,
    source: 'tarif non verifie — a lire sur la grille du fournisseur retenu',
  },
];

export const MESSAGE_TARIF_INCONNU = 'Tarif non declare pour ce fournisseur.';

export function fournisseurVisuel(id: string): TarifFournisseurVisuel | null {
  return FOURNISSEURS_VISUELS.find((f) => f.id === id) ?? null;
}

/** Le fournisseur retenu pour une qualite : le premier ACTIF qui la sert. */
export function fournisseurPourQualite(qualite: NiveauQualite): TarifFournisseurVisuel | null {
  return FOURNISSEURS_VISUELS.find((f) => f.actif && f.qualites.includes(qualite)) ?? null;
}

export interface LigneDevis {
  sceneId: string;
  titre: string;
  secondes: number;
  /** `null` = cout inconnu, a afficher comme tel. */
  usd: number | null;
  /** Pourquoi cette scene est (ou n'est pas) facturee. */
  motif: 'a_produire' | 'deja_produite' | 'validee';
}

export interface DevisFilm {
  fournisseur: TarifFournisseurVisuel | null;
  lignes: LigneDevis[];
  /** Total, ou `null` des qu'une seule ligne est inconnue. */
  totalUsd: number | null;
  /** Secondes reellement a produire. */
  secondesAProduire: number;
}

/**
 * Le devis d'un rendu. `scenesAProduire` vient de `empreinte.scenesAReproduire`
 * — une scene validee et inchangee ne coute rien et doit le montrer.
 */
export function devisFilm(film: Film, scenesAProduire: readonly string[]): DevisFilm {
  const fournisseur = fournisseurPourQualite(film.qualite);
  const aProduire = new Set(scenesAProduire);

  const lignes: LigneDevis[] = film.scenes.map((scene) => {
    const secondes = dureeScene(scene);
    if (!aProduire.has(scene.id)) {
      return {
        sceneId: scene.id,
        titre: scene.titre,
        secondes,
        usd: 0,
        motif: scene.etat === 'validee' ? 'validee' : 'deja_produite',
      };
    }
    const tarif = fournisseur?.usdParSeconde ?? null;
    return {
      sceneId: scene.id,
      titre: scene.titre,
      secondes,
      usd: tarif === null ? null : Math.round(tarif * secondes * 10000) / 10000,
      motif: 'a_produire',
    };
  });

  const inconnu = lignes.some((l) => l.usd === null);
  return {
    fournisseur,
    lignes,
    totalUsd: inconnu ? null : Math.round(lignes.reduce((t, l) => t + (l.usd ?? 0), 0) * 10000) / 10000,
    secondesAProduire: Math.round(
      lignes.filter((l) => l.motif === 'a_produire').reduce((t, l) => t + l.secondes, 0) * 10,
    ) / 10,
  };
}

/** Ce que le film a DEJA coute : la somme de ce que les scenes ont paye. */
export function coutPaye(film: Pick<Film, 'scenes'>): number {
  return Math.round(film.scenes.reduce((t, s) => t + (s.coutUsd || 0), 0) * 10000) / 10000;
}

/** Inscrit sur une scene ce qu'elle vient de couter (cumulatif, jamais ecrase). */
export function inscrireCout(scene: SceneCinema, usd: number): SceneCinema {
  return { ...scene, coutUsd: Math.round(((scene.coutUsd || 0) + usd) * 10000) / 10000 };
}

/** Libelle d'un montant, avec le cas inconnu traite comme tel. */
export function libelleUsd(usd: number | null): string {
  if (usd === null) return MESSAGE_TARIF_INCONNU;
  return usd === 0 ? 'Gratuit (rendu local)' : `${usd.toFixed(4)} USD`;
}
