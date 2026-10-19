import type { ReactNode } from 'react';

export function DevBanner() {
  return (
    <div className="banner" role="note">
      Ambiente de desenvolvimento com dados fictícios. Não use com pacientes reais.
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <main className="card">
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
      {children}
    </main>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  return (
    <p className="form-error" role="alert" aria-live="assertive">
      {message ?? ''}
    </p>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  inputMode?: 'numeric';
  pattern?: string;
  maxLength?: number;
  hint?: string;
  autoFocus?: boolean;
}) {
  const hintId = props.hint ? `${props.name}-hint` : undefined;
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        pattern={props.pattern}
        maxLength={props.maxLength}
        aria-describedby={hintId}
        autoFocus={props.autoFocus}
        required
      />
      {props.hint && (
        <small id={hintId} className="muted">
          {props.hint}
        </small>
      )}
    </label>
  );
}
