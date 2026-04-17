import type { Metadata } from 'next'
import { Inter, Anton, Syne, Bebas_Neue, Poppins, Space_Grotesk, Montserrat, Oswald, Playfair_Display, Raleway, Roboto_Condensed, Lora, Dancing_Script, Permanent_Marker } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import PWAInstallPrompt from '@/components/PWAInstallPrompt'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-anton' })
const syne = Syne({ subsets: ['latin'], variable: '--font-syne' })
const bebasNeue = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas' })
const poppins = Poppins({ weight: ['400', '600', '700', '800'], subsets: ['latin'], variable: '--font-poppins' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' })
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' })
const oswald = Oswald({ subsets: ['latin'], variable: '--font-oswald' })
const playfairDisplay = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' })
const raleway = Raleway({ subsets: ['latin'], variable: '--font-raleway' })
const robotoCondensed = Roboto_Condensed({ subsets: ['latin'], variable: '--font-roboto-condensed' })
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' })
const dancingScript = Dancing_Script({ subsets: ['latin'], variable: '--font-dancing' })
const permanentMarker = Permanent_Marker({ weight: '400', subsets: ['latin'], variable: '--font-marker' })


export const metadata: Metadata = {
  title: 'Studiio - Créez des vidéos virales',
  description: 'Créez des vidéos virales en quelques clics avec Studiio, la plateforme de création vidéo IA.',
  manifest: '/manifest.json',
  themeColor: '#7C3AED',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Studiio - Créez des vidéos virales',
    description: 'Plateforme de création vidéo IA',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#7C3AED" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Studiio" />
      </head>
      <body className={`${inter.variable} ${anton.variable} ${syne.variable} ${bebasNeue.variable} ${poppins.variable} ${spaceGrotesk.variable} ${montserrat.variable} ${oswald.variable} ${playfairDisplay.variable} ${raleway.variable} ${robotoCondensed.variable} ${lora.variable} ${dancingScript.variable} ${permanentMarker.variable} font-sans bg-studiio-dark text-gray-100 antialiased`}>
        <Providers>{children}</Providers>
        <PWAInstallPrompt />
      </body>
    </html>
  )
}
