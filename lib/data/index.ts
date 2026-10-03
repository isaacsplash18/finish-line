/**
 * Server-side data access for Finish Line.
 *
 * Import from `@/lib/data` in server components, server actions and route
 * handlers. Everything here runs on the server only (`server-only` is imported
 * by each module) and throws `DomainError` subclasses that are safe to render.
 *
 * There is deliberately no client-side data layer: mutations go through server
 * actions, reads go through server components.
 */

export * from './errors';
export * from './projects';
export * from './rewards';
export * from './routines';
export * from './key-dates';
export * from './scores';
export * from './dashboard';
// v2 (SPEC-V2.md)
export * from './progress-events';
export * from './moves';
export * from './reviews';
export * from './seasons';
export * from './github';
