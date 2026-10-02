'use client';

import { useActionState } from 'react';

import { Button, Input } from '@/components';
import { loginAction, type LoginActionResult } from './actions';

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginActionResult | null, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-3">
      <Input
        label="Password"
        name="password"
        type="password"
        autoFocus
        required
        autoComplete="current-password"
        error={state?.ok === false ? state.error : undefined}
      />
      <Button type="submit" variant="primary" block loading={isPending}>
        Enter
      </Button>
    </form>
  );
}
