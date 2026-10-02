'use client';

import { useEffect } from 'react';

/**
 * Registers `/sw.js` so Finish Line is installable to the home screen
 * (PRD §10.3, acceptance §13.7).
 *
 * Deliberately minimal: registration only, in production only. The service
 * worker itself does not pre-cache app shell HTML — this app is always
 * server-rendered against live data and a stale shell would show stale scores.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability is a nice-to-have; never break the app over it.
      });
    };

    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
