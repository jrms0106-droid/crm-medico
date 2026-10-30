import { useEffect, useState } from 'react';
import { type HealthResponse, ROLE_LABELS, type SessionInfo } from '@crm/shared';
import { api } from '../api';
import { href } from '../router';
import { canSee } from '../shell';
import { Page, Panel } from '../ui';

export function HomePage({ session }: { session: SessionInfo }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null));
  }, []);

  return (
    <Page title={`Olá, ${session.user.name}`}>
      <p className="muted">{session.user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</p>
      <Panel>
        <ul className="checks" aria-live="polite">
          <li className={health?.status === 'ok' ? 'ok' : 'warn'}>
            Servidor:{' '}
            {health ? (health.status === 'ok' ? 'funcionando' : 'com problemas') : 'verificando…'}
          </li>
          <li className={session.mfaEnabled ? 'ok' : 'warn'}>
            Verificação em duas etapas: {session.mfaEnabled ? 'ativa' : 'não ativada'}
          </li>
          <li className="warn">Uso clínico: ainda não aprovado</li>
        </ul>
      </Panel>
      <Panel title="Atalhos">
        <ul className="shortcuts">
          {canSee(session, ['secretary']) && (
            <>
              <li>
                <a href={href('/pacientes')}>Cadastrar ou buscar paciente</a>
              </li>
              <li>
                <a href={href('/agenda')}>Marcar consulta e registrar chegada</a>
              </li>
              <li>
                <a href={href('/financeiro')}>Cobranças e pagamentos</a>
              </li>
            </>
          )}
          {canSee(session, ['doctor']) && (
            <li>
              <a href={href('/agenda')}>Minha agenda de hoje</a>
            </li>
          )}
          {canSee(session, ['admin']) && (
            <>
              <li>
                <a href={href('/auditoria')}>Auditoria e verificação da trilha</a>
              </li>
              <li>
                <a href={href('/configuracoes')}>Usuários, unidades e tabela de preços</a>
              </li>
              <li>
                <a href={href('/financeiro')}>Relatório financeiro e estornos</a>
              </li>
            </>
          )}
        </ul>
      </Panel>
    </Page>
  );
}
