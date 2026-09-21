import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Les classes d'état partagées (`ETAT_INTERACTIF`, `ETAT_SELECTION`…)
    // vivent dans un module pur hors `components/` : sans cette entrée, elles
    // seraient purgées en production et le survol/focus disparaîtrait.
    './src/lib/ui/**/*.ts',
  ],
  theme: {
    extend: {
      colors: {
        studiio: {
          primary: '#7C3AED',
          accent: '#EC4899',
          dark: '#0A0A0F',
        }
      },
      fontFamily: {
        sans: ['var(--font-inter)'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
export default config
