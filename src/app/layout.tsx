import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Studiio - Créez des vidéos virales',
  description: 'Créez des vidéos virales en quelques clics avec Studiio, la plateforme de création vidéo IA.',
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
      <body className={`${inter.variable} bg-studiio-dark text-gray-100 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
