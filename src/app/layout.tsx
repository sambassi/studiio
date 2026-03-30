import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Studiio - Cr\u00e9ez des vid\u00e9os virales',
  description: 'Cr\u00e9ez des vid\u00e9os virales en quelques clics avec Studiio, la plateforme de cr\u00e9ation vid\u00e9o IA.',
  openGraph: {
    title: 'Studiio - Cr\u00e9ez des vid\u00e9os virales',
    description: 'Plateforme de cr\u00e9ation vid\u00e9o IA',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="scroll-smooth">
      <body className={`${inter.variable} bg-studiio-dark text-gray-100 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
