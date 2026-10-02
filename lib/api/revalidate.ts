/**
 * Cache revalidation after API mutations — the same paths the screens' server
 * actions revalidate, so the PWA reflects changes made through the API.
 */

import 'server-only';

import { revalidatePath } from 'next/cache';

import type { UUID } from '@/lib/types';

/** Mirrors `revalidateProjectPaths` in app/projects/actions.ts. */
export function revalidateProjectScreens(id?: UUID): void {
  revalidatePath('/projects');
  if (id) revalidatePath(`/projects/${id}`);
  revalidatePath('/');
  // Settings lists projects (reward assignment, key-date linking, import).
  revalidatePath('/settings');
}

/** Mirrors `revalidateRoutineScreens` in app/routines/actions.ts. */
export function revalidateRoutineScreens(): void {
  revalidatePath('/routines');
  revalidatePath('/settings');
  revalidatePath('/');
}

/**
 * Mirrors `revalidateSettingsScreens` in app/settings/actions.ts — rewards,
 * key dates and recomputes can touch every screen.
 */
export function revalidateAllScreens(): void {
  revalidatePath('/settings');
  revalidatePath('/routines');
  revalidatePath('/projects');
  revalidatePath('/projects/[id]', 'page');
  revalidatePath('/');
}
