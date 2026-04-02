'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale, useSetLocale } from '@/i18n/client';
import { locales, localeNames, localeFlags, type Locale } from '@/i18n/config';

interface LanguageSelectorProps {
  variant?: 'sidebar' | 'navbar' | 'footer';
}

export function LanguageSelector({ variant = 'sidebar' }: LanguageSelectorProps) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (loc: Locale) => {
    setLocale(loc);
    setOpen(false);
  };

  if (variant === 'footer') {
    return (
      <div className="flex items-center gap-2">
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleSelect(loc)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              locale === loc
                ? 'bg-white/20 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {localeFlags[loc]} {loc.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition text-sm font-medium ${
          variant === 'navbar'
            ? 'text-gray-400 hover:text-white hover:bg-gray-800'
            : 'w-full text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
      >
        <span>{localeFlags[locale]}</span>
        <span>{locale.toUpperCase()}</span>
        <svg className={`w-3 h-3 ml-auto transition ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden ${
          variant === 'navbar' ? 'right-0 w-36' : 'left-0 right-0'
        }`}>
          {locales.map((loc) => (
            <button
              key={loc}
              onClick={() => handleSelect(loc)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition ${
                locale === loc
                  ? 'bg-studiio-primary/10 text-studiio-primary'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <span>{localeFlags[loc]}</span>
              <span>{localeNames[loc]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
