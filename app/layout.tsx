import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { ServiceWorkerRegistrar } from './service-worker-registrar';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Finish Line',
    template: '%s · Finish Line',
  },
  description: 'Finish what you start. Projects, routines, and two scores that keep you honest.',
  applicationName: 'Finish Line',
  appleWebApp: {
    capable: true,
    title: 'Finish Line',
    statusBarStyle: 'black-translucent',
  },
  // The PNGs and favicon.ico are generated separately (see ARCHITECTURE.md).
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#f97316',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Installed-app feel: no accidental pinch-zoom on the check-off grid.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-dvh bg-bg text-text antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
