import { type FormEvent, useState } from 'react';
import {
  ACCESS_REPORT_ACTION_LABELS,
  ACCESS_REPORT_RESOURCE_LABELS,
  type AccessReportDto,
  type PatientDto,
  type PatientExportDto,
  type PatientSummaryDto,
  ROLE_LABELS,
  type RoleName,
  SUBJECT_REQUEST_DEADLINE_DAYS,
  SUBJECT_REQUEST_KINDS,
  SUBJECT_REQUEST_KIND_LABELS,
  SUBJECT_REQUEST_STATUS_LABELS,
  type SessionInfo,
  type SubjectRequestDto,
  type SubjectRequestKind,
} from '@crm/shared';
import { api, query } from '../api';
import { useReauth } from '../reauth';
import { href, navigate, useRoute } from '../router';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Page,
  Panel,
  formatDate,
  formatDateTime,
  todayLocal,
  useAction,
  useLoad,
} from '../ui';

/**
 * Direitos do paciente (docs/api/direitos-do-titular.md): a recepção registra e responde os
 * pedidos, gera o relatório de acessos e exporta os dados. Quem decide o acesso é a API.
 */
export function PrivacyPage() {
  const { params } = useRoute();
  const patientId = params.get('paciente');
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [version, setVersion] = useState(0);
  const list = useLoad(
    () =>
      api.get<SubjectRequestDto[]>(
        `/privacy/requests${query({ status: status === 'open' ? 'open' : undefined })}`,
      ),
    [status, version],
  );

  return (
    <Page title="Direitos do paciente">
      <Notice>
        O paciente pode pedir acesso, correção, cópia dos dados ou saber quem os acessou. Registre o
        pedido aqui: o prazo de resposta é de {SUBJECT_REQUEST_DEADLINE_DAYS} dias corridos. Prazo e
        textos de resposta a validar com o encarregado de dados.
      </Notice>
      {patientId ? (
        <NewRequestPanel
          patientId={patientId}
          onCreated={() => {
            setVersion((v) => v + 1);
            navigate('/direitos');
          }}
        />
      ) : (
        <RequestPatientPicker />
      )}
      <Panel title="Pedidos">
        <div className="inline">
          <label className="field">
            <span>Mostrar</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'all')}>
              <option value="open">Só os abertos</option>
              <option value="all">Todos</option>
            </select>
          </label>
        </div>
        <Alert message={list.error} />
        {!list.data && !list.error && <Loading what="os pedidos" />}
        {list.data && (
          <RequestTable
            requests={list.data}
            showPatient
            onChanged={() => setVersion((v) => v + 1)}
          />
        )}
      </Panel>
    </Page>
  );
}

function RequestPatientPicker() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PatientSummaryDto[] | null>(null);
  const action = useAction();
  const search = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      setFound(await api.get<PatientSummaryDto[]>(`/patients${query({ q, limit: 10 })}`));
    });
  };
  return (
    <Panel title="Novo pedido">
      <form className="inline" onSubmit={search} aria-label="Buscar paciente para o pedido">
        <label className="field grow">
          <span>Paciente</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
        </label>
        <button type="submit" disabled={action.busy}>
          Buscar paciente
        </button>
      </form>
      <Alert message={action.error} />
      {found && found.length === 0 && <p className="muted">Nenhum paciente encontrado.</p>}
      <ul className="picks">
        {found?.map((p) => (
          <li key={p.id}>
            <a href={href(`/direitos?paciente=${p.id}`)}>{p.displayName}</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NewRequestPanel({ patientId, onCreated }: { patientId: string; onCreated: () => void }) {
  const patient = useLoad(() => api.get<PatientDto>(`/patients/${patientId}`), [patientId]);
  const [kind, setKind] = useState<SubjectRequestKind>('access');
  const [details, setDetails] = useState('');
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post<SubjectRequestDto>('/privacy/requests', { patientId, kind, details });
      setDetails('');
      onCreated();
    });
  };

  if (patient.error) return <Alert message={patient.error} />;
  if (!patient.data) return <Loading what="o paciente" />;
  return (
    <Panel title={`Novo pedido de ${patient.data.displayName}`}>
      <form className="grid" onSubmit={submit} aria-label="Novo pedido do paciente">
        <label className="field">
          <span>O que o paciente pediu</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as SubjectRequestKind)}>
            {SUBJECT_REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {SUBJECT_REQUEST_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Detalhes (opcional)</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={3}
          />
        </label>
        {kind === 'deletion' && (
          <Notice kind="warn">
            O prontuário tem guarda obrigatória por lei e não é eliminado. Responda o pedido
            explicando isso para o que for dado clínico.
          </Notice>
        )}
        <Alert message={action.error} />
        <div className="actions">
          <button type="submit" disabled={action.busy}>
            Registrar pedido
          </button>
          <a href={href('/direitos')}>Cancelar</a>
        </div>
      </form>
    </Panel>
  );
}

function RequestTable({
  requests,
  showPatient,
  onChanged,
}: {
  requests: SubjectRequestDto[];
  showPatient: boolean;
  onChanged: () => void;
}) {
  const [answering, setAnswering] = useState<string | null>(null);
  if (requests.length === 0) return <p className="muted">Nenhum pedido.</p>;
  return (
    <table aria-label="Pedidos do paciente">
      <thead>
        <tr>
          {showPatient && <th>Paciente</th>}
          <th>Pedido</th>
          <th>Registrado</th>
          <th>Prazo</th>
          <th>Situação</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id}>
            {showPatient && (
              <td>
                <a href={href(`/pacientes/${r.patient.id}`)}>{r.patient.name}</a>
              </td>
            )}
            <td>
              {SUBJECT_REQUEST_KIND_LABELS[r.kind]}
              {r.details && <div className="muted small">{r.details}</div>}
            </td>
            <td>
              {formatDateTime(r.createdAt)}
              <div className="muted small">por {r.createdBy.name}</div>
            </td>
            <td>
              {formatDate(r.dueOn)} {r.overdue && <Badge tone="warn">Vencido</Badge>}
            </td>
            <td>
              <Badge
                tone={r.status === 'open' ? 'info' : r.status === 'completed' ? 'ok' : 'neutral'}
              >
                {SUBJECT_REQUEST_STATUS_LABELS[r.status]}
              </Badge>
              {r.status === 'open' &&
                (answering === r.id ? (
                  <ResolveForm
                    request={r}
                    onCancel={() => setAnswering(null)}
                    onDone={() => {
                      setAnswering(null);
                      onChanged();
                    }}
                  />
                ) : (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={() => setAnswering(r.id)}>
                      Responder
                    </button>
                  </>
                ))}
              {r.resolution && (
                <div className="muted small">
                  {r.resolution}
                  {r.resolvedBy && r.resolvedAt && (
                    <>
                      {' '}
                      ({r.resolvedBy.name}, {formatDateTime(r.resolvedAt)})
                    </>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResolveForm({
  request,
  onCancel,
  onDone,
}: {
  request: SubjectRequestDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'completed' | 'denied'>('completed');
  const [resolution, setResolution] = useState('');
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!window.confirm('A resposta não pode ser desfeita. Registrar?')) return;
    void action.run(async () => {
      await api.post(`/privacy/requests/${request.id}/resolve`, { status, resolution });
      onDone();
    });
  };
  return (
    <form className="dialog" onSubmit={submit} aria-label="Responder pedido">
      <label className="field">
        <span>Resultado</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'completed' | 'denied')}
        >
          <option value="completed">Atendido</option>
          <option value="denied">Negado</option>
        </select>
      </label>
      <label className="field">
        <span>Resposta dada ao paciente</span>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          minLength={3}
          maxLength={1000}
          rows={3}
          required
        />
      </label>
      <Alert message={action.error} />
      <div className="actions">
        <button type="submit" disabled={action.busy}>
          Registrar resposta
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  allowed: 'Permitido',
  denied: 'Negado',
  not_found: 'Não encontrado',
};

const roleText = (roles: string[]) => roles.map((r) => ROLE_LABELS[r as RoleName] ?? r).join(', ');

/** Na ficha do paciente, para a recepção: pedidos, relatório de acessos e exportação. */
export function PatientRightsPanel({
  session,
  patient,
}: {
  session: SessionInfo;
  patient: PatientDto;
}) {
  const [version, setVersion] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const requests = useLoad(
    () => api.get<SubjectRequestDto[]>(`/privacy/requests${query({ patientId: patient.id })}`),
    [patient.id, version],
  );
  return (
    <Panel title="Direitos do paciente">
      <div className="actions">
        <a className="button secondary" href={href(`/direitos?paciente=${patient.id}`)}>
          Registrar pedido
        </a>
        <button type="button" className="secondary" onClick={() => setShowReport((s) => !s)}>
          {showReport ? 'Fechar relatório de acessos' : 'Relatório de acessos'}
        </button>
        <ExportButton session={session} patient={patient} />
      </div>
      {showReport && <AccessReport patientId={patient.id} />}
      <Alert message={requests.error} />
      {requests.data && requests.data.length > 0 && (
        <RequestTable
          requests={requests.data}
          showPatient={false}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </Panel>
  );
}

function ExportButton({ session, patient }: { session: SessionInfo; patient: PatientDto }) {
  const { guarded, dialog } = useReauth(
    session,
    'O arquivo traz o CPF e todo o cadastro, então exportar exige a senha de novo.',
  );
  const action = useAction();
  const [done, setDone] = useState(false);
  const exportData = () => {
    setDone(false);
    void action.run(async () => {
      const data = await guarded(() => api.get<PatientExportDto>(`/patients/${patient.id}/export`));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dados-do-paciente-${todayLocal()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    });
  };
  return (
    <>
      <button type="button" className="secondary" onClick={exportData} disabled={action.busy}>
        Exportar dados
      </button>
      {dialog}
      <Alert message={action.error} />
      {done && (
        <p role="status" className="muted">
          Arquivo gerado. Entregue ao paciente por meio seguro; ele traz o CPF. A cópia do
          prontuário não vai nesse arquivo.
        </p>
      )}
    </>
  );
}

function AccessReport({ patientId }: { patientId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const report = useLoad(
    () =>
      api.get<AccessReportDto>(
        `/patients/${patientId}/access-report${query({ from: range.from, to: range.to })}`,
      ),
    [patientId, range.from, range.to],
  );
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setRange({ from, to });
  };
  return (
    <section aria-label="Relatório de acessos">
      <form className="inline" onSubmit={apply} aria-label="Período do relatório">
        <label className="field">
          <span>De (opcional)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>Até (opcional)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" className="secondary">
          Filtrar
        </button>
        <button type="button" className="secondary" onClick={() => window.print()}>
          Imprimir
        </button>
      </form>
      <Alert message={report.error} />
      {!report.data && !report.error && <Loading what="o relatório" />}
      {report.data && (
        <>
          <p className="muted small">
            Gerado em {formatDateTime(report.data.generatedAt)}. Mostra quem acessou e quando, sem o
            conteúdo clínico.
            {report.data.truncated && ' Só as 2000 linhas mais recentes: use um período menor.'}
          </p>
          {report.data.entries.length === 0 ? (
            <p className="muted">Nenhum acesso no período.</p>
          ) : (
            <table aria-label="Acessos aos dados do paciente">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O que</th>
                  <th>Ação</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {report.data.entries.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{formatDateTime(e.at)}</td>
                    <td>
                      {e.who ? (
                        <>
                          {e.who.name}
                          <div className="muted small">{roleText(e.who.roles)}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {ACCESS_REPORT_RESOURCE_LABELS[e.resourceType] ?? e.resourceType}
                      {e.emergency && (
                        <>
                          {' '}
                          <Badge tone="warn">Emergencial</Badge>
                        </>
                      )}
                    </td>
                    <td>{ACCESS_REPORT_ACTION_LABELS[e.action] ?? e.action}</td>
                    <td>{OUTCOME_LABELS[e.outcome] ?? e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
