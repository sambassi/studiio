'use client';

/**
 * CINEMA IA — LA COQUE DU PARCOURS : une etape a la fois, un apercu permanent.
 *
 * Fidele a la maquette validee (`studiio_cinema_design/index.html`) :
 *
 *   ┌ en-tete (titre, reprise de projet, quota)
 *   ├ barre des 5 etapes — Histoire / Personnages / Scenes / Apercu / Export
 *   ├ zone de travail : SEULE l'etape active est rendue, et elle defile SEULE
 *   │  + apercu permanent a droite (ordinateur) / compact en haut (mobile)
 *   └ pied fixe : Retour / Continuer, deux petits boutons
 *
 * ⚠️ POURQUOI LA PAGE NE DEFILE PAS. La hauteur est bornee a l'ecran et c'est la zone de
 * travail, elle seule, qui defile : sans cela on retombe sur la page interminable ou l'apercu
 * disparaissait des qu'on ecrivait. Sur mobile, l'apercu devient une bande compacte en haut
 * (`flex-col-reverse` : il est APRES dans le DOM, donc apres le formulaire pour le clavier et
 * les lecteurs d'ecran, mais AU-DESSUS a l'ecran).
 *
 * Cette coque ne connait aucune donnee de film : elle place, elle n'decide pas. Le contenu de
 * chaque etape, l'apercu et les actions viennent de la page.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, type LucideIcon } from 'lucide-react';

export interface EtapeWizard {
  titre: string;
  icone: LucideIcon;
  /** Faux : l'etape n'est pas encore atteignable (et on dit pourquoi dans `empeche`). */
  accessible: boolean;
  /** Raison lisible quand l'etape est hors d'atteinte. */
  empeche?: string;
}

export default function WizardCinema({
  etapes, active, surAller, entete, apercu, children,
  actionPrincipale, chargement = false,
}: {
  etapes: readonly EtapeWizard[];
  active: number;
  surAller: (i: number) => void;
  entete: React.ReactNode;
  apercu: React.ReactNode;
  children: React.ReactNode;
  /**
   * L'action primaire de l'etape — le SEUL gros bouton de l'ecran. `null` sur la derniere
   * etape (l'export a son propre bouton dans la zone de travail).
   */
  actionPrincipale: { libelle: string; onClick: () => void; desactive?: boolean; titre?: string } | null;
  chargement?: boolean;
}) {
  const zone = useRef<HTMLDivElement | null>(null);

  // Changer d'etape remet la zone de travail en haut : on ne reprend jamais au milieu
  // d'un formulaire qu'on n'a pas encore lu.
  // `scrollTop` et non `scrollTo` : la methode n'existe pas partout (jsdom), et une
  // remise a zero n'a pas besoin d'animation.
  useEffect(() => { if (zone.current) zone.current.scrollTop = 0; }, [active]);

  const etape = etapes[active];

  return (
    <div className="cinema-wizard flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40" data-wizard="cinema">
      {/* La hauteur depend de la mise en page du tableau de bord (barre de 4rem + marges du
          `main` : 1rem sur mobile, 2rem a partir de `lg`). Une regle CSS reelle, et non une
          classe Tailwind arbitraire : ces dernieres sont purgees en production (CLAUDE.md). */}
      <style>{`
        /* Hauteur minimale modeste : une fenetre basse (1280x620) doit tenir sans deborder. */
        .cinema-wizard{height:calc(100vh - 6rem);min-height:420px}
        /* Mobile : l'apercu reste visible en haut, mais COMPACT — sinon il mange l'ecran et
           recouvre la barre des etapes. Il defile chez lui ; « Agrandir » donne le plein ecran. */
        .cinema-apercu{max-height:235px;--hauteur-cadre:140px}
        /* L'extrait d'exemple y reste ENTIER (16:9, jamais rogne) : un cadre de 262 px de large
           fait 147 px de haut, il tient dans la bande sans qu'on ait a la faire defiler. */
        .cinema-apercu [data-ratio-exemple]{width:min(100%,262px);margin-inline:auto}
        /* La bulle de chat du tableau de bord est fixe (bas droite, 56 px + 16 px de marge) : le pied
           de page lui laisse sa place, sinon elle recouvre « Continuer ». Specificite 0,2,0 pour
           l'emporter sur les classes de marge d'utilite. */
        .cinema-wizard .cinema-pied{padding-right:5.25rem}
        @media(min-width:1024px){.cinema-wizard{height:calc(100vh - 8rem)}.cinema-apercu{max-height:none;width:clamp(360px,36vw,520px);--hauteur-cadre:min(52vh,520px)}.cinema-apercu [data-ratio-exemple]{width:100%}}
      `}</style>
      <header className="shrink-0 border-b border-slate-800 px-4 py-3 sm:px-6">{entete}</header>

      {/* Barre des etapes : chiffre + nom sur grand ecran, chiffre seul sur mobile. */}
      <nav aria-label="Etapes de Cinema IA" className="shrink-0 overflow-x-auto border-b border-slate-800 bg-slate-950/60 px-3 py-2.5 sm:px-6">
        <ol className="flex items-center gap-1.5">
          {etapes.map((e, i) => {
            const Icone = e.icone;
            const courante = i === active;
            const titre = e.accessible ? e.titre : (e.empeche ?? e.titre);
            return (
              <li key={e.titre} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="hidden h-px w-5 bg-slate-700 sm:block" />}
                <button
                  type="button"
                  onClick={() => surAller(i)}
                  disabled={!e.accessible}
                  aria-current={courante ? 'step' : undefined}
                  title={titre}
                  aria-label={`Etape ${i + 1} sur ${etapes.length} : ${titre}`}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    courante
                      ? 'border-violet-500/70 bg-violet-500/15 text-violet-100'
                      : e.accessible
                        ? 'border-slate-800 text-slate-300 hover:border-violet-500/40'
                        : 'cursor-not-allowed border-slate-800/60 text-slate-600'
                  }`}
                >
                  <Icone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="tabular-nums text-[10px] opacity-70">{String(i + 1).padStart(2, '0')}</span>
                  <span className="hidden font-medium sm:inline">{e.titre}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Zone de travail. Mobile : apercu compact EN HAUT (colonne inversee). */}
      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <section
          ref={zone}
          aria-label={`Etape ${active + 1} : ${etape?.titre ?? ''}`}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          <div className="mx-auto w-full" style={{ maxWidth: 705 }}>{children}</div>
        </section>

        <aside
          aria-label="Apercu permanent"
          className="cinema-apercu shrink-0 overflow-y-auto border-b border-slate-800 px-4 py-3 lg:border-b-0 lg:border-l lg:px-5 lg:py-5"
          style={{ background: 'radial-gradient(circle at 67% 15%, rgba(24,26,49,0.9) 0%, rgba(11,16,28,0.9) 52%, rgba(10,14,24,0.95) 100%)' }}
        >
          {apercu}
        </aside>
      </div>

      <footer className="cinema-pied flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/80 px-4 py-2.5 sm:px-6">
        <p className="min-w-0 truncate text-[11px] text-slate-400">
          Etape {active + 1} sur {etapes.length} · <span className="font-semibold text-slate-200">{etape?.titre}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => surAller(active - 1)}
            disabled={active === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:border-violet-500/50 disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Retour
          </button>
          {actionPrincipale && (
            <button
              type="button"
              onClick={actionPrincipale.onClick}
              disabled={actionPrincipale.desactive || chargement}
              title={actionPrincipale.titre}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {actionPrincipale.libelle} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** L'en-tete d'une etape : surtitre, titre, phrase d'accroche — la grammaire de la maquette. */
export function TitreEtape({ numero, total, icone: Icone, titre, phrase }: {
  numero: number; total: number; icone: LucideIcon; titre: string; phrase: string;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">
        <Icone className="h-3.5 w-3.5" aria-hidden="true" />
        Etape {String(numero).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </p>
      <h2 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">{titre}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">{phrase}</p>
    </div>
  );
}
