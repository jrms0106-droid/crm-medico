import { type FormEvent, type ReactNode, useState } from 'react';
import type { SessionInfo } from '@crm/shared';
import { ApiError, api } from './api';
import { Alert, useAction } from './ui';

/** Confirmação de identidade (senha e, se houver, código) antes de uma ação crítica. */
export function ReauthDialog({
  session,
  label,
  confirmText,
  children,
  onCancel,
  onConfirm,
}: {
  session: SessionInfo;
  label: string;
  confirmText: string;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await action.run(async () => {
      await api.reauth(
        String(data.get('password') ?? ''),
        String(data.get('code') ?? '') || undefined,
      );
      await onConfirm();
    });
  }
  return (
    <form className="dialog" onSubmit={submit} aria-label={label}>
      {children}
      <input type="hidden" name="username" autoComplete="username" value={session.user.email} />
      <label className="field">
        <span>Sua senha</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {session.mfaEnabled && (
        <label className="field">
          <span>Código de 6 dígitos</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
      )}
      <Alert message={action.error} />
      <div className="actions">
        <button type="submit" disabled={action.busy}>
          {confirmText}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

interface Pending {
  run: () => Promise<void>;
  cancel: () => void;
}

/**
 * Executa uma ação e, se a API pedir reautenticação (403 REAUTH_REQUIRED), mostra a
 * confirmação de identidade e repete a ação depois dela.
 */
export function useReauth(
  session: SessionInfo,
  reason = 'Mudanças de acesso exigem a senha de novo.',
) {
  const [pending, setPending] = useState<Pending | null>(null);

  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'REAUTH_REQUIRED')) throw e;
      return new Promise<T>((resolve, reject) =>
        setPending({
          run: async () => {
            try {
              resolve(await fn());
            } catch (err) {
              reject(err);
            }
          },
          cancel: () => reject(e),
        }),
      );
    }
  }

  const dialog = pending ? (
    <ReauthDialog
      session={session}
      label="Confirmar identidade"
      confirmText="Confirmar"
      onCancel={() => {
        pending.cancel();
        setPending(null);
      }}
      onConfirm={async () => {
        await pending.run();
        setPending(null);
      }}
    >
      <p>
        <strong>Confirme sua identidade.</strong> {reason}
      </p>
    </ReauthDialog>
  ) : null;

  return { guarded, dialog };
}
