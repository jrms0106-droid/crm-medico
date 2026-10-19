import { type FormEvent, useState } from 'react';
import { ApiError } from './api';

/** Envia um formulário, controla "enviando…" e transforma erros da API em mensagem para a tela. */
export function useSubmit(action: (data: FormData) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action(new FormData(event.currentTarget));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro inesperado. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return { onSubmit, error, busy };
}

export const text = (data: FormData, name: string) => String(data.get(name) ?? '');
