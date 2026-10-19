import { useEffect, useState } from 'react';
import type { HealthResponse } from '@crm/shared';
import { fetchHealth } from './api';

type State = { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ready', health }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="page">
      <div className="banner" role="note">
        Ambiente de desenvolvimento com dados fictícios. Não use com pacientes reais.
      </div>
      <main className="card">
        <h1>CRM Médico</h1>
        <p className="muted">Fundação do sistema (Etapa 0)</p>
        <section aria-live="polite">
          {state.kind === 'loading' && <p>Verificando o servidor…</p>}
          {state.kind === 'error' && (
            <p className="status status-error">Não foi possível falar com o servidor.</p>
          )}
          {state.kind === 'ready' && (
            <ul className="checks">
              <li className={state.health.status === 'ok' ? 'ok' : 'warn'}>
                Servidor: {state.health.status === 'ok' ? 'funcionando' : 'com problemas'}
              </li>
              <li className={state.health.database === 'ok' ? 'ok' : 'warn'}>
                Banco de dados: {state.health.database === 'ok' ? 'conectado' : 'indisponível'}
              </li>
              <li className="warn">Uso clínico: ainda não aprovado</li>
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
