import { LoginForm } from './LoginForm';

export const metadata = { title: 'Log in' };

/**
 * The password gate. Deliberately outside `AppShell` — no nav, no tabs, just
 * the mark and one field. See `middleware.ts` for the redirect rule and
 * `./actions.ts` for the check.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-6 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset, no optimization needed for a single icon */}
        <img src="/icons/icon-192.png" alt="" width={96} height={96} className="rounded-3xl" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Finish Line</h1>
          <p className="mt-1 text-sm text-muted">Enter the password to continue.</p>
        </div>
      </div>

      <LoginForm />
    </main>
  );
}
