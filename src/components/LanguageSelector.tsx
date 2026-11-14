'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useSetLocale, useTranslations } from '@/i18n/client';
import { locales, localeNames, localeBadges, localeStatus, type Locale } from '@/i18n/config';

interface LanguageSelectorProps {
  variant?: 'sidebar' | 'navbar' | 'footer';
}

/** Globe SVG (jamais d'emoji : règle du projet). */
function IconeGlobe({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" />
    </svg>
  );
}

function IconeCoche() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Sélecteur de langue unique, partagé par la page publique, la barre latérale et la barre
 * du haut. Menu rendu dans un PORTAIL en position fixe : aucune barre ni aucun conteneur
 * `overflow: hidden` ne peut le rogner ou le recouvrir (même piège qu'ailleurs, vérifié
 * dans un navigateur). Les langues peu couvertes le disent honnêtement.
 */
export function LanguageSelector({ variant = 'sidebar' }: LanguageSelectorProps) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTranslations('languageSelector');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const placer = useCallback(() => {
    if (!bouton.current) return;
    const r = bouton.current.getBoundingClientRect();
    const marge = 12;
    const largeur = Math.min(240, window.innerWidth - 2 * marge);
    const top = r.bottom + 8;
    // Aligné sur le bouton, mais jamais hors de l'écran ; ouvert vers le HAUT si la place manque en bas.
    const left = Math.max(marge, Math.min(r.right - largeur, window.innerWidth - largeur - marge));
    const placeBas = window.innerHeight - top - marge;
    if (placeBas < 220 && r.top > placeBas) {
      setPos({ top: Math.max(marge, r.top - 8 - Math.min(420, r.top - 2 * marge)), left, maxHeight: Math.min(420, r.top - 2 * marge) });
    } else {
      setPos({ top, left, maxHeight: Math.max(160, placeBas) });
    }
  }, []);

  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    placer();
    const dehors = (e: Event) => {
      const c = e.target as Node;
      if (bouton.current?.contains(c) || menu.current?.contains(c)) return;
      setOpen(false);
    };
    const clavier = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); bouton.current?.focus(); } };
    const defil = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('touchstart', dehors);
    document.addEventListener('keydown', clavier);
    window.addEventListener('resize', placer);
    window.addEventListener('scroll', defil, true);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('touchstart', dehors);
      document.removeEventListener('keydown', clavier);
      window.removeEventListener('resize', placer);
      window.removeEventListener('scroll', defil, true);
    };
  }, [open, placer]);

  const choisir = (loc: Locale) => { setLocale(loc); setOpen(false); bouton.current?.focus(); };
  const etiquette = (loc: Locale) => {
    const st = localeStatus[loc];
    return st === 'partial' ? t('partial') : st === 'draft' ? t('beta') : '';
  };

  const classeBouton = variant === 'sidebar'
    ? 'w-full text-gray-400 hover:text-white hover:bg-gray-800'
    : 'text-gray-400 hover:text-white hover:bg-gray-800';

  return (
    <div className="relative inline-block" style={variant === 'sidebar' ? { display: 'block' } : undefined}>
      <button
        ref={bouton}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('label')} : ${localeNames[locale]}`}
        title={`${t('label')} : ${localeNames[locale]}`}
        data-testid="lang-selector-btn"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition text-sm font-medium min-h-[44px] ${classeBouton}`}
      >
        <IconeGlobe />
        <span data-testid="lang-active-badge">{localeBadges[locale]}</span>
        <svg className={`w-3 h-3 ml-auto transition ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menu}
          role="listbox"
          aria-label={t('label')}
          data-testid="lang-menu"
          className="py-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-y-auto"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.min(240, window.innerWidth - 24), maxHeight: pos.maxHeight, zIndex: 10050 }}
        >
          {locales.map((loc) => {
            const actif = locale === loc;
            const note = etiquette(loc);
            return (
              <button
                key={loc}
                type="button"
                role="option"
                aria-selected={actif}
                lang={loc}
                data-testid={`lang-${loc}`}
                onClick={() => choisir(loc)}
                className={`w-full flex items-center gap-3 px-3 text-sm text-left transition min-h-[44px] ${
                  actif ? 'bg-studiio-primary/15 text-studiio-primary' : 'text-gray-200 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="w-7 shrink-0 text-xs font-semibold opacity-70">{localeBadges[loc]}</span>
                <span className="flex-1 min-w-0 truncate">{localeNames[loc]}</span>
                {note && <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">{note}</span>}
                {actif && <IconeCoche />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
