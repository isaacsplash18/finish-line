import type { MetadataRoute } from 'next';

import { config } from '@/lib/config';

/**
 * PWA manifest (PRD §10.3, §11.2, acceptance §13.7).
 *
 * Icon assets:
 *   public/icons/icon-192.png  — 192×192, maskable-safe padding
 *   public/icons/icon-512.png  — 512×512
 *   app/favicon.ico            — 32×32, served at /favicon.ico by the App
 *                                Router file convention
 * Flat geometric mark (chequered flag / arrow crossing a line), near-black
 * background, single orange accent. No default Next.js favicon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.appName,
    short_name: config.appName,
    description: 'Finish what you start.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#f97316',
    categories: ['productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
