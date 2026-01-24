import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chessr Admin Dashboard',
  description: 'Admin dashboard for Chessr Stockfish server',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
