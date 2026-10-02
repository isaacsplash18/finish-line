import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    // Pure domain logic only — no DOM, no Supabase. `lib/data/*` is not unit
    // tested because it is a thin, typed wrapper over Postgres.
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
