'use client';

/**
 * CINEMA IA — MODELES DE DEPART, pour quelqu'un qui ouvre la page pour la premiere fois.
 *
 * Trois exemples complets et MODIFIABLES : chacun remplit d'un coup le titre, l'histoire
 * (avec ses repliques entre guillemets, que le decoupage reconnait — voir
 * `scenario.citation`), le casting avec l'apparence de chaque personnage, le format, la
 * qualite et le nombre de scenes. L'ambiance n'est pas un champ a part : elle est ECRITE
 * dans les phrases de l'histoire (lumiere, lieu, matiere), parce que c'est exactement ce
 * texte qui devient la description d'un plan, puis le prompt visuel.
 *
 * ⚠️ DEUX REGLES QUI NE SE NEGOCIENT PAS :
 *
 *   1. UN MODELE N'ECRASE JAMAIS UNE SAISIE EXISTANTE SANS ACCORD. Si quelque chose a
 *      deja ete ecrit (`aDesSaisies`), le clic ARME la carte et demande une confirmation
 *      en ligne — jamais un `window.confirm`, qui bloquerait le fil de la page (meme
 *      regle que la suppression d'un film, cf. `docs/CINEMA-IA.md` 13.2).
 *   2. CHOISIR UN MODELE NE GENERE RIEN. Cela remplit des champs, et s'arrete la : aucun
 *      appel, aucun credit, aucune composition de scenario declenchee.
 *
 * Les vignettes sont des illustrations SVG STATIQUES (`public/cinema-exemples/`), une
 * par genre, sans texte incruste : aucune image generee. Les miniatures de l'Autopilote
 * (`public/styles-video/`) etaient la meme video de danse avec un titre incruste, donc
 * indiscernables entre elles et rognees en 16:9.
 */
import { useState } from 'react';
import { Info, Sparkles, FilePlus2, Check, X } from 'lucide-react';

export interface ValeursModele {
  titre: string;
  histoire: string;
  format: '16:9' | '9:16';
  qualite: string;
  nbScenes: number;
  casting: Array<{ nom: string; role: string; description: string; urlImage: string }>;
}

export interface ModeleFilm {
  id: string;
  /** Ce que la carte annonce. */
  nom: string;
  /** Le genre, en un mot. */
  theme: string;
  /** Image statique du depot — jamais une image generee. */
  vignette: string;
  /** L'ambiance visuelle, en une ligne : c'est ce que les phrases de l'histoire portent. */
  ambiance: string;
  /** Petits exemples de scenes : ce que le decoupage produira, en clair. */
  scenes: string[];
  valeurs: ValeursModele;
}

/**
 * ⚠️ AUCUNE PONCTUATION FORTE A L'INTERIEUR DES GUILLEMETS.
 *
 * `scenario.phrases` coupe le texte APRES chaque `.`, `!` ou `?` suivi d'une espace : un
 * point ou un point d'exclamation place DANS une replique scinde la phrase en deux, et la
 * replique n'est alors plus reconnue (`scenario.citation` cherche les deux guillemets dans
 * la MEME phrase). Les repliques ci-dessous se ponctuent donc a la virgule, et se ferment
 * juste avant le point final de la phrase. Eprouve par `cinema-modeles-film.test.tsx`.
 */
export const MODELES_FILM: readonly ModeleFilm[] = [
  {
    id: 'aventure',
    nom: 'L’ascension',
    theme: 'Aventure',
    vignette: '/cinema-exemples/aventure.svg',
    ambiance: 'Lumiere froide d’avant l’aube, contre-jour, grain de pellicule.',
    scenes: [
      'Le camp de base dans la brume, sacs prets',
      'La paroi : Lina s’engage, Theo assure',
      'La corde ripe, un regard suffit',
      'Le sommet au premier soleil',
    ],
    valeurs: {
      titre: 'L’ascension',
      histoire: 'Lina quitte le camp de base avant l’aube, dans une brume qui colle a la pierre. '
        + 'Theo verifie les cordes sans un mot, la lampe frontale posee sur le granit mouille. '
        + 'Lina s’engage sur la paroi et le vent se leve d’un coup. '
        + 'Theo crie : « Ne regarde pas en bas, regarde la prise ». '
        + 'La corde ripe sur une arete et le silence revient, plus lourd. '
        + 'Lina repond : « Je tiens bon, assure et j’avance ». '
        + 'Le premier soleil touche le sommet et la brume s’ouvre sous leurs pieds.',
      format: '16:9',
      qualite: 'cinema',
      nbScenes: 4,
      casting: [
        { nom: 'Lina', role: 'protagoniste', description: 'tresse brune, veste coupe-vent orange, mains poudrees de magnesie', urlImage: '' },
        { nom: 'Theo', role: 'second', description: 'casque gris, barbe courte, baudrier charge de mousquetons', urlImage: '' },
      ],
    },
  },
  {
    id: 'romance',
    nom: 'Deux cafes',
    theme: 'Romance',
    vignette: '/cinema-exemples/romance.svg',
    ambiance: 'Lumiere douce de fin de journee, tons chauds, cadres epures.',
    scenes: [
      'Le comptoir presque vide, pluie derriere la vitre',
      'Claire laisse un mot sur la soucoupe',
      'Sami lit, hesite, rattrape la porte',
      'Le trottoir mouille, deux cafes refroidissent',
    ],
    valeurs: {
      titre: 'Deux cafes',
      histoire: 'Claire pousse la porte du cafe presque vide, la pluie derriere la vitre et la lumiere basse du soir. '
        + 'Sami essuie le comptoir sans lever les yeux, la vapeur de la machine entre eux deux. '
        + 'Claire commande deux cafes et en pose un devant lui. '
        + 'Claire dit : « Celui-la est le tien, assieds-toi cinq minutes ». '
        + 'Sami hesite, le torchon encore a la main, et finit par s’asseoir. '
        + 'Sami repond : « Cinq minutes, pas plus ». '
        + 'Les deux tasses refroidissent pendant que la pluie s’arrete sur le trottoir.',
      format: '9:16',
      qualite: 'standard',
      nbScenes: 4,
      casting: [
        { nom: 'Claire', role: 'protagoniste', description: 'carre blond, manteau beige trempe, echarpe fine', urlImage: '' },
        { nom: 'Sami', role: 'protagoniste', description: 'tablier noir, chemise retroussee, montre usee', urlImage: '' },
      ],
    },
  },
  {
    id: 'publicite',
    nom: 'Trente secondes',
    theme: 'Publicite cinematique',
    vignette: '/cinema-exemples/publicite.svg',
    ambiance: 'Contrastes nets, fond sombre, un seul objet eclaire au centre.',
    scenes: [
      'Salle vide avant l’ouverture, lumiere rasante',
      'Maya enchaine, la respiration donne le rythme',
      'Le coach annonce le dernier tour',
      'Plan final sur le produit, fond noir',
    ],
    valeurs: {
      titre: 'Trente secondes',
      histoire: 'La salle est encore vide et la lumiere rase le sol caoutchoute. '
        + 'Maya pose ses mains sur la barre, le souffle court, le fond reste noir autour d’elle. '
        + 'Maya se dit : « Trente secondes, juste trente ». '
        + 'Karim declenche le chronometre et sa voix remplit la salle. '
        + 'Karim annonce : « Dernier tour, tout ce qu’il te reste ». '
        + 'Maya tient jusqu’au signal et laisse retomber ses bras. '
        + 'Le dernier plan ne montre que la bouteille posee sur le banc, eclairee seule sur le fond noir.',
      format: '9:16',
      qualite: 'standard',
      nbScenes: 4,
      casting: [
        { nom: 'Maya', role: 'protagoniste', description: 'cheveux attaches, debardeur gris, epaules marquees', urlImage: '' },
        { nom: 'Karim', role: 'coach', description: 'sweat noir, sifflet au cou, chronometre a la main', urlImage: '' },
      ],
    },
  },
];

/**
 * Detail replie derriere une icone d'information — meme principe que `Detail` dans
 * `app/dashboard/cinema/page.tsx` (l'ecran reste epure, l'information reste accessible,
 * cf. `docs/UX-PREMIUM.md`). Garde ici pour que ce composant ne dependent pas d'un module
 * de page.
 */
function InfoCourte({ texte, libelle }: { texte: string; libelle: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-label={libelle}
        aria-expanded={ouvert}
        className="text-slate-500 hover:text-violet-300 transition-colors"
      >
        <Info className="w-4 h-4" />
      </button>
      {ouvert && <span className="text-xs text-slate-400">{texte}</span>}
    </span>
  );
}

export default function ModelesFilm({ aDesSaisies, surAppliquer, surPartirDeZero }: {
  /** Vrai des que l'utilisateur a quelque chose a perdre : la confirmation devient obligatoire. */
  aDesSaisies: boolean;
  surAppliquer: (modele: ModeleFilm) => void;
  surPartirDeZero: () => void;
}) {
  /** Carte armee, en attente de confirmation. `'zero'` pour « partir de zero ». */
  const [arme, setArme] = useState<string | null>(null);

  const choisir = (modele: ModeleFilm) => {
    if (!aDesSaisies) { surAppliquer(modele); return; }
    if (arme === modele.id) { surAppliquer(modele); setArme(null); return; }
    setArme(modele.id);
  };

  const partirDeZero = () => {
    if (!aDesSaisies) { surPartirDeZero(); return; }
    if (arme === 'zero') { surPartirDeZero(); setArme(null); return; }
    setArme('zero');
  };

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
        Partir d’un exemple
        <InfoCourte
          libelle="Ce qu’un exemple remplit"
          texte="Un exemple remplit le titre, l’histoire avec ses repliques, les personnages et leur apparence, le format et le nombre de scenes. Tout reste modifiable, et rien n’est genere : aucun credit n’est utilise."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {MODELES_FILM.map((m) => {
          const enAttente = arme === m.id;
          return (
            <div
              key={m.id}
              className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                enAttente ? 'border-violet-500/70 bg-violet-500/10' : 'border-slate-800 bg-slate-900/40 hover:border-violet-500/40'
              }`}
            >
              <button
                type="button"
                onClick={() => choisir(m)}
                aria-label={`Utiliser l’exemple ${m.nom} (${m.theme})`}
                className="block w-full text-left"
              >
                <span className="relative block overflow-hidden bg-slate-950" style={{ aspectRatio: '16 / 9' }}>
                  {/* Image STATIQUE du depot. eslint-disable : meme choix que le reste de
                      cet ecran, qui n'utilise pas `next/image` pour des visuels decoratifs. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.vignette} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
                  <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,10,15,0.1) 0%, rgba(10,10,15,0.85) 100%)' }} />
                  <span className="absolute bottom-2 left-3 right-3 block">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">{m.theme}</span>
                    <span className="block text-sm font-bold leading-tight">{m.nom}</span>
                  </span>
                </span>
                <span className="block px-3 py-2">
                  <span className="block text-[11px] leading-snug text-slate-400">{m.ambiance}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {m.valeurs.format} · {m.valeurs.nbScenes} scenes · {m.valeurs.casting.length} personnages
                  </span>
                </span>
              </button>

              <div className="flex items-start gap-2 px-3 pb-3">
                <InfoCourte
                  libelle={`Scenes de l’exemple ${m.nom}`}
                  texte={m.scenes.map((s, i) => `${i + 1}. ${s}`).join('  ·  ')}
                />
                {enAttente && (
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-violet-200">
                    Remplacer votre saisie ?
                    <button
                      type="button"
                      onClick={() => choisir(m)}
                      className="inline-flex items-center gap-1 rounded-md border border-violet-500/60 px-2 py-1 font-semibold hover:bg-violet-500/20"
                    >
                      <Check className="w-3.5 h-3.5" /> Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => setArme(null)}
                      aria-label="Annuler le remplacement"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500"
                    >
                      <X className="w-3.5 h-3.5" /> Annuler
                    </button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={partirDeZero}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-violet-500/50"
        >
          <FilePlus2 className="w-3.5 h-3.5" /> Partir de zero
        </button>
        {arme === 'zero' && (
          <span className="flex flex-wrap items-center gap-2 text-[11px] text-violet-200">
            Vider les champs ?
            <button
              type="button"
              onClick={partirDeZero}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/60 px-2 py-1 font-semibold hover:bg-violet-500/20"
            >
              <Check className="w-3.5 h-3.5" /> Confirmer
            </button>
            <button
              type="button"
              onClick={() => setArme(null)}
              aria-label="Annuler le vidage des champs"
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500"
            >
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
