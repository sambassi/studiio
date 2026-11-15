'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, Library, Share2, Calendar, Shield, Settings, Menu, X, UserSquare2, Wand2, Clapperboard, Film } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ETAT_INTERACTIF_SANS_FOND, ETAT_SELECTION } from '@/lib/ui/etats';

interface EntreeMenu {
  icon: typeof LayoutDashboard;
  key: string;
  href: string;
  color: string;
  /** Affichee seulement si le serveur confirme l'acces a Cinema IA (`cinemaDisponible`). */
  siCinema?: true;
}

const menuKeys: EntreeMenu[] = [
  { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard', color: '#7C3AED' },
  // Une SEULE entree « Creer ». Le parcours guide, longtemps second sous
  // « Creer (simple) », EST desormais `/dashboard/creer` : garder deux entrees
  // renverrait vers deux editeurs concurrents. On conserve son icone et sa
  // couleur (Wand2 / violet), pas celles de l'ancien editeur.
  { icon: Wand2, key: 'create', href: '/dashboard/creer', color: '#A855F7' },
  // `Film`, pas `Clapperboard` (deja pris par « Media ») : l'audit d'icones
  // (CLAUDE.md, point E) note la famille Film/Video/Clapperboard deja chargee.
  { icon: Film, key: 'cinema', href: '/dashboard/cinema', color: '#F43F5E', siCinema: true },
  { icon: UserSquare2, key: 'avatar', href: '/dashboard/avatar', color: '#EC4899' },
  { icon: Calendar, key: 'calendar', href: '/dashboard/calendar', color: '#3B82F6' },
  { icon: Library, key: 'library', href: '/dashboard/library', color: '#8B5CF6' },
  // `Clapperboard` plutot que `Film` : l'audit d'icones (CLAUDE.md, point E)
  // note que `Film` porte deja quatre sens differents dans l'editeur.
  { icon: Clapperboard, key: 'media', href: '/dashboard/media', color: '#10B981' },
  { icon: Share2, key: 'social', href: '/dashboard/social', color: '#06B6D4' },
  { icon: Settings, key: 'settings', href: '/dashboard/settings', color: '#6B7280' },
];

/**
 * Libellé d'une entrée de navigation — MISE EN PAGE SEULEMENT, aucun texte n'est raccourci.
 *
 * La barre fait 256 px (`w-64`) quelle que soit la langue, et l'intitulé n'en reçoit qu'une
 * part : 256 − padding de la barre − padding de l'entrée − pastille d'icône − écart. Le
 * français tient large, mais l'allemand (« Soziale Netzwerke ») et le kiswahili (« Vyombo vya
 * habari ») arrivaient à moins de 15 px du bord : la première traduction un peu plus longue
 * repassait à la ligne au milieu d'un mot, sans que rien ne borne le résultat.
 *
 * - `min-w-0` : sans lui un élément flex refuse de descendre sous sa largeur de plus long mot
 *   et DÉBORDE hors de la barre au lieu de se replier.
 * - `break-words` : garantit qu'un mot composé très long (allemand) se coupe DANS la barre.
 * - `leading-tight` + `text-balance` : si un repli est inévitable, les deux lignes sont serrées
 *   et de longueur comparable — un retour maîtrisé, pas un débordement.
 *
 * Sur une seule ligne — tous les libellés français actuels — ces règles n'ont aucun effet
 * visible : le rendu français reste celui d'avant.
 */
const CLASSE_LIBELLE = 'min-w-0 font-medium text-sm leading-tight text-balance break-words';

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [credits, setCredits] = useState<number | null>(null);
  const [libelleFacturation, setLibelleFacturation] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isAdmin = session?.user?.email === 'contact.artboost@gmail.com';
  const t = useTranslations('sidebar');

  /**
   * Cinema IA n'apparaît QUE si le serveur confirme qu'il est réellement utilisable pour
   * ce compte — même route que la page elle-même (`GET /api/cinema/films`), aucun nouvel
   * endpoint. `CINEMA_ACTIVE` est fermé par défaut (voir `lib/cinema/garde.ts`) : sans ce
   * contrôle, l'entrée mènerait tout le monde vers une page qui refuse tout en 404. Le menu
   * dit la vérité, comme l'écran lui-même le fait déjà pour le mode de génération.
   */
  const [cinemaDisponible, setCinemaDisponible] = useState(false);

  useEffect(() => {
    let actif = true;
    fetch('/api/cinema/films')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (actif && data?.ok === true) setCinemaDisponible(true); })
      .catch(() => { /* indisponible : l'entrée reste cachée, comme si le module n'existait pas */ });
    return () => { actif = false; };
  }, []);

  useEffect(() => {
    async function fetchCredits() {
      try {
        const res = await fetch('/api/credits/balance');
        const data = await res.json();
        // La route rend `{ ok, balance }`, pas `{ success, data.credits }` :
        // cette lecture-ci echouait en silence et affichait 0.
        if (!data?.ok) return;
        if (typeof data.balance === 'number') { setCredits(data.balance); setLibelleFacturation(null); }
        else if (data.libelle) { setCredits(null); setLibelleFacturation(data.libelle); }
      } catch {
        // Silently fail - will show placeholder
      }
    }
    fetchCredits();
    // Le solde affiche ici ne bougeait plus jamais apres le premier chargement : une
    // operation payante ailleurs (ex. Cinema IA) annonce ce changement par cet evenement
    // plutot que par une dependance directe entre pages sans rapport.
    window.addEventListener('studiio:credits-changed', fetchCredits);
    return () => window.removeEventListener('studiio:credits-changed', fetchCredits);
  }, []);

  // Close sidebar when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const handleNavClick = () => {
    setIsOpen(false);
  };

  const SidebarContent = () => (
    <>
      <Link href="/" className="text-2xl font-bold text-gradient mb-8 block">
        Studiio
      </Link>

      <nav className="space-y-1.5 flex-1">
        {menuKeys.filter((e) => !e.siCinema || cinemaDisponible).map(({ icon: Icon, key, href, color }) => {
          // Le `+ '/'` borne la comparaison sur un segment complet. Sans lui,
          // `/dashboard/creer` etant un prefixe de `/dashboard/creer-avance`,
          // l'entree « Creer » s'allumerait sur l'ancien editeur. Les
          // sous-routes reelles (`/dashboard/x/y`) restent bien detectees.
          const isActive =
            pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
          return (
            <Link
              key={href}
              href={href}
              onClick={handleNavClick}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl ${ETAT_INTERACTIF_SANS_FOND} ${
                isActive
                  ? ETAT_SELECTION
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {/* Barre à gauche de l'entrée active : la forme double la couleur. */}
              {isActive && <span aria-hidden data-barre className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-purple-400" />}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}20`, color }}
              >
                <Icon size={18} />
              </div>
              <span className={`${CLASSE_LIBELLE} ${isActive ? 'text-white' : ''}`}>{t(key)}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            onClick={handleNavClick}
            aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl ${ETAT_INTERACTIF_SANS_FOND} ${
              pathname.startsWith('/admin')
                ? ETAT_SELECTION
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {pathname.startsWith('/admin') && <span aria-hidden data-barre className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-purple-400" />}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#F59E0B20', color: '#F59E0B' }}>
              <Shield size={18} />
            </div>
            <span className={CLASSE_LIBELLE}>{t('admin')}</span>
          </Link>
        )}
      </nav>

      <div className="space-y-4">
        <LanguageSelector variant="sidebar" />
        <div className="card-base p-4">
          <div className="text-xs text-gray-500 mb-2">{t('creditsAvailable')}</div>
          <div className="text-2xl font-bold text-studiio-accent mb-4">
            {credits !== null
              ? credits.toLocaleString()
              : libelleFacturation !== null
                /* `block leading-snug text-balance` : ce libellé hérite sinon de
                   l'interligne du `text-2xl` du nombre de crédits (32 px). En français
                   (« Frais partenaires uniquement ») comme en kiswahili, il tient sur deux
                   lignes séparées par un vide de la hauteur d'une ligne entière. Les deux
                   lignes sont désormais serrées et de longueur comparable. */
                ? <span data-facturation-libelle className="block text-sm font-medium leading-snug text-balance text-gray-400">{t.fr(libelleFacturation)}</span>
                : '...'}
          </div>
          {/* Pas de `block` ici : c'est un utilitaire, il gagne sur le `inline-flex`
              de .button-base, ce qui neutralise le centrage vertical. `w-full`
              suffit a occuper la largeur. */}
          <Link href="/dashboard/settings?tab=abonnement" className="w-full button-primary text-center">
            {t('buy')}
          </Link>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      {/* `px-5` et non `p-6` : la barre garde sa largeur (`w-64`, dont dépend le `lg:ml-64`
          des pages), mais rend 8 px au contenu — c'est autant de marge gagnée pour les
          intitulés les plus longs, sans qu'aucun texte ne soit raccourci. */}
      <aside className="hidden lg:flex fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 px-5 py-6 z-50 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`lg:hidden fixed top-0 left-0 z-50 p-4 text-gray-400 hover:text-white mt-4 rounded-lg ${ETAT_INTERACTIF_SANS_FOND}`}
        title={t.fr('Menu')}
      >
        <Menu size={24} />
      </button>

      {/* Mobile Sidebar Backdrop */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`lg:hidden fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 px-5 py-6 z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={() => setIsOpen(false)}
          className={`absolute top-6 right-5 text-gray-400 hover:text-white rounded-md ${ETAT_INTERACTIF_SANS_FOND}`}
          title={t.fr('Fermer')}
        >
          <X size={24} />
        </button>

        <div className="mt-8">
          <SidebarContent />
        </div>
      </aside>
    </>
  );
}
