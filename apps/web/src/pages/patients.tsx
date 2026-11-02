import { type FormEvent, useState } from 'react';
import {
  type PatientDto,
  type PatientSummaryDto,
  type SessionInfo,
  ageOn,
  maskCpf,
} from '@crm/shared';
import { ApiError, api } from '../api';
import { href, navigate } from '../router';
import { canSee } from '../shell';
import { PatientRemindersPanel } from './crm';
import { PatientRightsPanel } from './privacy';
import {
  Alert,
  Loading,
  Notice,
  Page,
  Panel,
  errorText,
  formatDate,
  todayLocal,
  useLoad,
} from '../ui';

export function PatientsPage({ session }: { session: SessionInfo }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PatientSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setResults(await api.post<PatientSummaryDto[]>('/patients/search', { q }));
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Page
      title="Pacientes"
      actions={
        <button type="button" onClick={() => setCreating(true)}>
          Novo paciente
        </button>
      }
    >
      {creating && (
        <NewPatientForm
          onCancel={() => setCreating(false)}
          onCreated={(p) => navigate(`/pacientes/${p.id}`)}
        />
      )}
      <Panel>
        <form className="inline" onSubmit={search} role="search">
          <label className="field grow">
            <span>Buscar por nome, CPF ou telefone</span>
            <input
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              minLength={2}
              required
            />
          </label>
          <button type="submit">Buscar</button>
        </form>
        <Alert message={error} />
        {results && results.length === 0 && <p className="muted">Nenhum paciente encontrado.</p>}
        {results && results.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Nascimento</th>
                <th>CPF</th>
                <th>Telefone</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={href(`/pacientes/${p.id}`)}>{p.displayName}</a>
                    {!p.active && <span className="muted"> (inativo)</span>}
                  </td>
                  <td>{formatDate(p.birthDate)}</td>
                  <td>{p.cpfMasked ?? '—'}</td>
                  <td>{p.primaryPhone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {canSee(session, ['doctor']) && (
        <p className="muted small">Abra o paciente para ver o prontuário.</p>
      )}
    </Page>
  );
}

function NewPatientForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (p: PatientDto) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (name: string) => String(data.get(name) ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<PatientDto>('/patients', {
        fullName: get('fullName'),
        socialName: get('socialName') || null,
        birthDate: get('birthDate'),
        cpf: get('cpf') || null,
        phones: [{ number: get('phone'), whatsapp: data.get('whatsapp') === 'on' }],
        allowPossibleDuplicate: duplicate,
      });
      onCreated(created);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
        setDuplicate(true);
        setError(`${e.message} Se tiver certeza de que é outra pessoa, envie de novo.`);
      } else if (e instanceof ApiError && e.details.length > 0) {
        setError(`${e.message} ${e.details.map((d) => d.issue).join(' ')}`);
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Novo paciente">
      <form onSubmit={submit} className="grid">
        <label className="field">
          <span>Nome completo</span>
          <input name="fullName" required minLength={3} autoComplete="off" />
        </label>
        <label className="field">
          <span>Nome social (opcional)</span>
          <input name="socialName" autoComplete="off" />
        </label>
        <label className="field">
          <span>Data de nascimento</span>
          <input name="birthDate" type="date" required />
        </label>
        <label className="field">
          <span>CPF (opcional)</span>
          <input name="cpf" inputMode="numeric" autoComplete="off" />
        </label>
        <label className="field">
          <span>Telefone com DDD</span>
          <input name="phone" inputMode="tel" required autoComplete="off" />
        </label>
        <label className="check">
          <input type="checkbox" name="whatsapp" /> Este telefone tem WhatsApp
        </label>
        <Alert message={error} />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {duplicate ? 'Cadastrar mesmo assim' : 'Cadastrar'}
          </button>
          <button type="button" className="link" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </Panel>
  );
}

export function PatientPage({ session, patientId }: { session: SessionInfo; patientId: string }) {
  const { data: patient, error } = useLoad(
    () => api.get<PatientDto>(`/patients/${patientId}`),
    [patientId],
  );
  if (error)
    return (
      <Page title="Paciente">
        <Alert message={error} />
      </Page>
    );
  if (!patient)
    return (
      <Page title="Paciente">
        <Loading what="o cadastro" />
      </Page>
    );
  const isDoctor = canSee(session, ['doctor']);
  const isSecretary = canSee(session, ['secretary']);
  return (
    <Page
      title={patient.displayName}
      actions={
        <>
          {isSecretary && (
            <a className="button" href={href(`/agenda?paciente=${patient.id}`)}>
              Agendar consulta
            </a>
          )}
          {isSecretary && (
            <a className="button" href={href(`/financeiro?paciente=${patient.id}`)}>
              Nova cobrança
            </a>
          )}
          {isDoctor && (
            <a className="button" href={href(`/prontuario/${patient.id}`)}>
              Prontuário
            </a>
          )}
        </>
      }
    >
      {!patient.active && <Notice kind="warn">Cadastro inativo.</Notice>}
      <Panel title="Cadastro">
        <dl className="facts">
          <dt>Nome completo</dt>
          <dd>{patient.fullName}</dd>
          {patient.socialName && (
            <>
              <dt>Nome social</dt>
              <dd>{patient.socialName}</dd>
            </>
          )}
          <dt>Nascimento</dt>
          <dd>
            {formatDate(patient.birthDate)} ({ageOn(patient.birthDate, todayLocal())} anos)
          </dd>
          <dt>CPF</dt>
          <dd>{patient.cpf ? maskCpf(patient.cpf) : '—'}</dd>
          <dt>Telefones</dt>
          <dd>
            {patient.phones.map((p) => `${p.number}${p.whatsapp ? ' (WhatsApp)' : ''}`).join(', ')}
          </dd>
          <dt>E-mail</dt>
          <dd>{patient.email ?? '—'}</dd>
        </dl>
      </Panel>
      {isSecretary && <PatientRemindersPanel patient={patient} />}
      {isSecretary && <PatientRightsPanel session={session} patient={patient} />}
    </Page>
  );
}
