import { useState } from 'react';
import {
  type AuditChainReportDto,
  type AuditEventDto,
  type EmergencyAccessDto,
  ROLE_LABELS,
  type UnitDto,
  type UserAccountDto,
} from '@crm/shared';
import { api, query } from '../api';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Page,
  Panel,
  formatDateTime,
  useAction,
  useLoad,
} from '../ui';

const OUTCOME_LABELS = { allowed: 'Permitido', denied: 'Negado', not_found: 'Não encontrado' };
const ISSUE_LABELS = {
  gap: 'evento faltando antes deste',
  link: 'ligação com o anterior quebrada',
  content: 'conteúdo alterado',
};

export function AuditPage() {
  const [outcome, setOutcome] = useState('');
  const events = useLoad(
    () => api.get<AuditEventDto[]>(`/audit/events${query({ outcome, limit: 100 })}`),
    [outcome],
  );
  const [report, setReport] = useState<AuditChainReportDto | null>(null);
  const verify = useAction();

  return (
    <Page
      title="Auditoria"
      actions={
        <button
          type="button"
          onClick={() =>
            void verify.run(async () =>
              setReport(await api.get<AuditChainReportDto>('/audit/verify')),
            )
          }
          disabled={verify.busy}
        >
          Verificar a trilha
        </button>
      }
    >
      <Alert message={verify.error} />
      {report && (
        <Panel title="Resultado da verificação">
          {report.valid ? (
            <p className="ok" role="status">
              Trilha íntegra: {report.checked} eventos conferidos, nenhum alterado ou faltando.
            </p>
          ) : (
            <div role="alert">
              <p className="error">Trilha com problemas: {report.problems.length} encontrados.</p>
              <ul>
                {report.problems.map((p) => (
                  <li key={`${p.chainSeq}-${p.issue}`}>
                    Evento nº {p.chainSeq}: {ISSUE_LABELS[p.issue]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.headHash && (
            <p className="muted small">
              Último resumo (nº {report.headSeq}): <code>{report.headHash}</code>
            </p>
          )}
        </Panel>
      )}
      <EmergencyReviews />
      <Panel title="Eventos">
        <label className="field">
          <span>Resultado</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(OUTCOME_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Alert message={events.error} />
        {events.loading && !events.data && <Loading what="os eventos" />}
        {events.data && (
          <table>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Quando</th>
                <th>Ação</th>
                <th>Recurso</th>
                <th>Resultado</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td>{e.chainSeq}</td>
                  <td>{formatDateTime(e.occurredAt)}</td>
                  <td>{e.action}</td>
                  <td>{e.resourceType}</td>
                  <td>
                    <Badge tone={e.outcome === 'allowed' ? 'ok' : 'warn'}>
                      {OUTCOME_LABELS[e.outcome]}
                    </Badge>
                  </td>
                  <td>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

function EmergencyReviews() {
  const list = useLoad(() => api.get<EmergencyAccessDto[]>('/emergency-access/reviews'), []);
  const action = useAction();
  const review = (id: string, outcome: 'appropriate' | 'inappropriate') => {
    const notes = window.prompt('Observação da revisão:');
    if (!notes) return;
    void action.run(async () => {
      await api.post(`/emergency-access/${id}/review`, { outcome, notes });
      list.reload();
    });
  };
  if (!list.data || list.data.length === 0) return null;
  return (
    <Panel title="Acessos emergenciais para revisar">
      <Alert message={action.error} />
      <ul>
        {list.data.map((a) => (
          <li key={a.id}>
            {formatDateTime(a.startsAt)} · {a.requestedBy.name}: {a.justification}{' '}
            <button type="button" className="secondary" onClick={() => review(a.id, 'appropriate')}>
              Adequado
            </button>{' '}
            <button
              type="button"
              className="secondary"
              onClick={() => review(a.id, 'inappropriate')}
            >
              Inadequado
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function SettingsPage() {
  const users = useLoad(() => api.get<UserAccountDto[]>('/admin/users'), []);
  const units = useLoad(() => api.get<UnitDto[]>('/units'), []);
  return (
    <Page title="Configurações">
      <Notice>
        Criar e alterar usuários, unidades e agendas ainda é feito pela API. As telas de edição
        entram numa próxima entrega.
      </Notice>
      <Panel title="Unidades">
        <Alert message={units.error} />
        <ul>
          {units.data?.map((u) => (
            <li key={u.id}>
              {u.name} ({u.timezone}){!u.active && ' · inativa'}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Usuários">
        <Alert message={users.error} />
        {users.data && (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfis</th>
                <th>Duas etapas</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
                  <td>{u.mfaEnabled ? 'Ativa' : 'Não ativada'}</td>
                  <td>{u.active ? 'Ativo' : 'Inativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}
