import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

/** Página do sistema já logado: título, ações e conteúdo. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  // O título da aba diz em que tela a pessoa está (também lido pelo leitor de tela).
  useEffect(() => {
    document.title = `${title} · CRM Médico`;
  }, [title]);
  return (
    <section className="page-body">
      <header className="page-header">
        <h1>{title}</h1>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Panel({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="panel">
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn';
  children: ReactNode;
}) {
  return (
    <p className={`notice ${kind}`} role="note">
      {children}
    </p>
  );
}

export function Alert({ message }: { message: string | null }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Erro inesperado. Tente novamente.';

/**
 * Carrega dados da API e expõe estado de carregamento, erro e recarga. `deps` identifica o que
 * está sendo carregado; quando muda, carrega de novo e descarta respostas antigas.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: T | null; error: string | null; key: string | null }>({
    data: null,
    error: null,
    key: null,
  });
  const key = JSON.stringify([...deps, nonce]);
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ data, error: null, key }),
      (e: unknown) => alive && setState((s) => ({ data: s.data, error: errorText(e), key })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}

/** Executa uma ação (botão) e guarda o erro para mostrar na tela. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, setError };
}

export function Loading({ what }: { what: string }) {
  return <p className="muted">Carregando {what}…</p>;
}

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
/** AAAA-MM-DD → DD/MM/AAAA, sem passar por fuso horário. */
export const formatDate = (date: string) => date.split('-').reverse().join('/');

/** Data local de hoje no navegador, AAAA-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Início e fim do dia local, em ISO, para consultas por período. */
export function dayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
