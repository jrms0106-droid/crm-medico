import { type FormEvent, Fragment, useEffect, useState } from 'react';
import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentDto,
  type EncounterDto,
  type PatientDto,
  type PatientSummaryDto,
  type ProfessionalDto,
  type ScheduleDto,
  type SessionInfo,
  type UnitDto,
} from '@crm/shared';
import { api, query } from '../api';
import { href, navigate, useRoute } from '../router';
import { canSee } from '../shell';
import { AppointmentMessageDraft, ScheduleSuggestionsPanel } from './assistant';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Page,
  Panel,
  dayRange,
  errorText,
  formatTime,
  todayLocal,
  useAction,
  useLoad,
} from '../ui';

const STATUS_TONE: Record<string, string> = {
  scheduled: 'neutral',
  confirmed: 'info',
  arrived: 'ok',
  completed: 'ok',
  no_show: 'warn',
  cancelled: 'warn',
  rescheduled: 'neutral',
};

/**
 * Agendas que o usuário pode abrir. A secretária vê as agendas das suas unidades; o médico,
 * só a própria (a API nega as consultas das agendas de outros médicos).
 */
async function loadSchedules(session: SessionInfo): Promise<ScheduleDto[]> {
  const units = await api.get<UnitDto[]>('/units');
  const lists = await Promise.all(
    units.map((u) => api.get<ScheduleDto[]>(`/units/${u.id}/schedules`)),
  );
  const all = lists.flat().filter((s) => s.active);
  if (canSee(session, ['secretary'])) return all;
  const professionals = await api.get<ProfessionalDto[]>('/professionals');
  const mine = professionals.filter((p) => p.userId === session.user.id).map((p) => p.id);
  return all.filter((s) => mine.includes(s.professionalId));
}

export function AgendaPage({ session }: { session: SessionInfo }) {
  const { params } = useRoute();
  const schedules = useLoad(() => loadSchedules(session), [session.user.id]);
  const [chosen, setScheduleId] = useState<string>('');
  const scheduleId = chosen || schedules.data?.[0]?.id || '';
  const [date, setDate] = useState(todayLocal());
  const [version, setVersion] = useState(0);

  if (schedules.error)
    return (
      <Page title="Agenda">
        <Alert message={schedules.error} />
      </Page>
    );
  if (!schedules.data)
    return (
      <Page title="Agenda">
        <Loading what="as agendas" />
      </Page>
    );
  if (schedules.data.length === 0) {
    return (
      <Page title="Agenda">
        <Notice>Nenhuma agenda disponível para você.</Notice>
      </Page>
    );
  }
  const isSecretary = canSee(session, ['secretary']);
  return (
    <Page title="Agenda">
      <Panel>
        <div className="inline">
          <label className="field">
            <span>Agenda</span>
            <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
              {schedules.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.professionalName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Dia</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        </div>
      </Panel>
      {scheduleId && (
        <DayList
          key={`${scheduleId}-${date}-${version}`}
          session={session}
          scheduleId={scheduleId}
          date={date}
        />
      )}
      {isSecretary && scheduleId && (
        <BookingForm
          key={`book-${scheduleId}-${date}`}
          scheduleId={scheduleId}
          date={date}
          initialPatientId={params.get('paciente')}
          onBooked={() => setVersion((v) => v + 1)}
        />
      )}
      {isSecretary && scheduleId && (
        <ScheduleSuggestionsPanel
          key={`ia-${scheduleId}-${date}-${version}`}
          scheduleId={scheduleId}
          date={date}
        />
      )}
    </Page>
  );
}

function DayList({
  session,
  scheduleId,
  date,
}: {
  session: SessionInfo;
  scheduleId: string;
  date: string;
}) {
  const list = useLoad(
    () =>
      api.get<AppointmentDto[]>(`/schedules/${scheduleId}/appointments${query(dayRange(date))}`),
    [scheduleId, date],
  );
  const action = useAction();
  const isSecretary = canSee(session, ['secretary']);
  const isDoctor = canSee(session, ['doctor']);
  const [drafting, setDrafting] = useState<string | null>(null);

  const act = (id: string, verb: string, body: object = {}) =>
    action.run(async () => {
      await api.post(`/appointments/${id}/${verb}`, body);
      list.reload();
    });

  const start = (a: AppointmentDto) =>
    action.run(async () => {
      const encounter = await api.post<EncounterDto>(`/appointments/${a.id}/encounter`);
      navigate(`/prontuario/${a.patient.id}?atendimento=${encounter.id}`);
    });

  const cancel = (a: AppointmentDto) => {
    const reason = window.prompt('Motivo do cancelamento:');
    if (reason) void act(a.id, 'cancel', { reason, requestedBy: 'patient' });
  };

  return (
    <Panel title="Consultas do dia">
      <Alert message={list.error ?? action.error} />
      {list.loading && !list.data && <Loading what="as consultas" />}
      {list.data && list.data.length === 0 && <p className="muted">Nenhuma consulta neste dia.</p>}
      {list.data && list.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Horário</th>
              <th>Paciente</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((a) => (
              <Fragment key={a.id}>
                <tr>
                  <td>
                    {formatTime(a.startsAt)}–{formatTime(a.endsAt)}
                  </td>
                  <td>
                    <a href={href(`/pacientes/${a.patient.id}`)}>{a.patient.displayName}</a>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[a.status]}>
                      {APPOINTMENT_STATUS_LABELS[a.status]}
                    </Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      {isSecretary && a.status === 'scheduled' && (
                        <button type="button" onClick={() => void act(a.id, 'confirm')}>
                          Confirmar
                        </button>
                      )}
                      {isSecretary && (a.status === 'scheduled' || a.status === 'confirmed') && (
                        <>
                          <button type="button" onClick={() => void act(a.id, 'check-in')}>
                            Registrar chegada
                          </button>
                          <button type="button" className="link" onClick={() => cancel(a)}>
                            Cancelar
                          </button>
                        </>
                      )}
                      {isSecretary && a.status === 'arrived' && (
                        <a
                          className="button small"
                          href={href(
                            `/financeiro?paciente=${a.patient.id}&consulta=${a.id}&unidade=${a.unitId}`,
                          )}
                        >
                          Cobrar
                        </a>
                      )}
                      {isDoctor && a.status === 'arrived' && (
                        <button type="button" onClick={() => void start(a)} disabled={action.busy}>
                          Iniciar atendimento
                        </button>
                      )}
                      {isDoctor && (
                        <a href={href(`/prontuario/${a.patient.id}`)} className="small">
                          Prontuário
                        </a>
                      )}
                      {isSecretary && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setDrafting(drafting === a.id ? null : a.id)}
                        >
                          Mensagem (IA)
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {drafting === a.id && (
                  <tr>
                    <td colSpan={4}>
                      <AppointmentMessageDraft appointmentId={a.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function BookingForm({
  scheduleId,
  date,
  initialPatientId,
  onBooked,
}: {
  scheduleId: string;
  date: string;
  initialPatientId: string | null;
  onBooked: () => void;
}) {
  const [patient, setPatient] = useState<{ id: string; displayName: string } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PatientSummaryDto[]>([]);
  const [slot, setSlot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const slots = useLoad(
    () =>
      api.get<{ startsAt: string; endsAt: string }[]>(
        `/schedules/${scheduleId}/availability${query({ date })}`,
      ),
    [scheduleId, date],
  );

  useEffect(() => {
    if (!initialPatientId) return;
    api.get<PatientDto>(`/patients/${initialPatientId}`).then(
      (p) => setPatient({ id: p.id, displayName: p.displayName }),
      () => undefined,
    );
  }, [initialPatientId]);

  async function search(event: FormEvent) {
    event.preventDefault();
    try {
      setFound(await api.get<PatientSummaryDto[]>(`/patients${query({ q, limit: 10 })}`));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function book() {
    if (!patient || !slot) return;
    setError(null);
    try {
      await api.post('/appointments', { scheduleId, patientId: patient.id, startsAt: slot });
      setDone(`Consulta marcada para ${patient.displayName} às ${formatTime(slot)}.`);
      setSlot('');
      slots.reload();
      onBooked();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const upcoming = (slots.data ?? []).filter((s) => new Date(s.startsAt) > new Date());

  return (
    <Panel title="Marcar consulta">
      {done && <p role="status">{done}</p>}
      {patient ? (
        <p>
          Paciente: <strong>{patient.displayName}</strong>{' '}
          <button type="button" className="link" onClick={() => setPatient(null)}>
            trocar
          </button>
        </p>
      ) : (
        <>
          <form className="inline" onSubmit={search}>
            <label className="field grow">
              <span>Paciente</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
            </label>
            <button type="submit">Buscar paciente</button>
          </form>
          <ul className="picks">
            {found.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => setPatient({ id: p.id, displayName: p.displayName })}
                >
                  {p.displayName}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <fieldset className="slots">
        <legend>Horários livres</legend>
        {slots.loading && <Loading what="os horários" />}
        {!slots.loading && upcoming.length === 0 && (
          <p className="muted">Nenhum horário livre neste dia.</p>
        )}
        {upcoming.map((s) => (
          <label key={s.startsAt} className="slot">
            <input
              type="radio"
              name="slot"
              value={s.startsAt}
              checked={slot === s.startsAt}
              onChange={() => setSlot(s.startsAt)}
            />
            {formatTime(s.startsAt)}
          </label>
        ))}
      </fieldset>
      <Alert message={error ?? slots.error} />
      <button type="button" onClick={() => void book()} disabled={!patient || !slot}>
        Agendar
      </button>
    </Panel>
  );
}
