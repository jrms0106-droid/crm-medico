import { type FormEvent, useState } from 'react';
import {
  MESSAGE_KIND_LABELS,
  MESSAGE_STATUS_LABELS,
  type MessageDto,
  type MessageStatus,
  type PatientDto,
} from '@crm/shared';
import { api, query } from '../api';
import { href } from '../router';
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

/** Lembretes ao paciente (docs/api/crm-e-lembretes.md). O envio é simulado. */
const SIMULATED_NOTICE =
  'Envio simulado: nenhuma mensagem sai do sistema até a clínica contratar um serviço de ' +
  'WhatsApp autorizado.';

const STATUS_TONE: Record<MessageStatus, string> = {
  queued: 'info',
  sent: 'ok',
  failed: 'warn',
  cancelled: 'neutral',
};

export function RemindersPage() {
  const [status, setStatus] = useState<MessageStatus | ''>('');
  const [version, setVersion] = useState(0);
  const list = useLoad(
    () => api.get<MessageDto[]>(`/crm/messages${query({ status: status || undefined })}`),
    [status, version],
  );
  return (
    <Page title="Lembretes">
      <Notice>
        O sistema envia um lembrete pelo WhatsApp entre 2 e 24 horas antes da consulta, só para quem
        autorizou no cadastro. {SIMULATED_NOTICE}
      </Notice>
      <Panel>
        <div className="inline">
          <label className="field">
            <span>Situação</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MessageStatus | '')}
            >
              <option value="">Todas</option>
              {(Object.keys(MESSAGE_STATUS_LABELS) as MessageStatus[]).map((s) => (
                <option key={s} value={s}>
                  {MESSAGE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Alert message={list.error} />
        {!list.data && !list.error && <Loading what="os lembretes" />}
        {list.data && (
          <MessageTable
            messages={list.data}
            showPatient
            onChanged={() => setVersion((v) => v + 1)}
          />
        )}
      </Panel>
    </Page>
  );
}

function MessageTable({
  messages,
  showPatient,
  onChanged,
}: {
  messages: MessageDto[];
  showPatient: boolean;
  onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  if (messages.length === 0) return <p className="muted">Nenhum lembrete.</p>;
  return (
    <table aria-label="Lembretes">
      <thead>
        <tr>
          {showPatient && <th>Paciente</th>}
          <th>Consulta</th>
          <th>Mensagem</th>
          <th>Situação</th>
        </tr>
      </thead>
      <tbody>
        {messages.map((m) => (
          <tr key={m.id}>
            {showPatient && (
              <td>
                <a href={href(`/pacientes/${m.patient.id}`)}>{m.patient.name}</a>
                <div className="muted small">{m.toNumberMasked}</div>
              </td>
            )}
            <td>
              {formatDateTime(m.appointment.startsAt)}
              <div className="muted small">{m.unit.name}</div>
            </td>
            <td>
              <div className="muted small">{MESSAGE_KIND_LABELS[m.kind] ?? m.kind}</div>
              {m.body}
            </td>
            <td>
              <Badge tone={STATUS_TONE[m.status]}>{MESSAGE_STATUS_LABELS[m.status]}</Badge>
              {m.sentAt && <div className="muted small">{formatDateTime(m.sentAt)}</div>}
              {m.lastError && <div className="muted small">Erro: {m.lastError}</div>}
              {m.cancelReason && (
                <div className="muted small">
                  {m.cancelReason}
                  {m.cancelledBy && ` (${m.cancelledBy.name})`}
                </div>
              )}
              {m.status === 'queued' &&
                (cancelling === m.id ? (
                  <CancelForm
                    message={m}
                    onCancel={() => setCancelling(null)}
                    onDone={() => {
                      setCancelling(null);
                      onChanged();
                    }}
                  />
                ) : (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={() => setCancelling(m.id)}>
                      Cancelar lembrete
                    </button>
                  </>
                ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CancelForm({
  message,
  onCancel,
  onDone,
}: {
  message: MessageDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post(`/crm/messages/${message.id}/cancel`, { reason });
      onDone();
    });
  };
  return (
    <form className="dialog" onSubmit={submit} aria-label="Cancelar lembrete">
      <label className="field">
        <span>Motivo</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          maxLength={200}
          required
        />
      </label>
      <Alert message={action.error} />
      <div className="actions">
        <button type="submit" disabled={action.busy}>
          Confirmar cancelamento
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Voltar
        </button>
      </div>
    </form>
  );
}

/** Na ficha do paciente, para a recepção: autorização de lembretes e o que já foi gerado. */
export function PatientRemindersPanel({ patient }: { patient: PatientDto }) {
  const [current, setCurrent] = useState(patient);
  const [version, setVersion] = useState(0);
  const action = useAction();
  const messages = useLoad(
    () => api.get<MessageDto[]>(`/crm/messages${query({ patientId: patient.id })}`),
    [patient.id, version],
  );
  const comm = current.communication;
  const authorized = comm.appointmentReminders && comm.channels.includes('whatsapp');
  const hasWhatsapp = current.phones.some((p) => p.whatsapp);

  const toggle = () =>
    void action.run(async () => {
      const channels = authorized
        ? comm.channels.filter((c) => c !== 'whatsapp')
        : [...new Set([...comm.channels, 'whatsapp' as const])];
      const updated = await api.patch<PatientDto>(`/patients/${current.id}`, {
        version: current.version,
        communication: { ...comm, channels, appointmentReminders: !authorized },
      });
      setCurrent(updated);
      setVersion((v) => v + 1);
    });

  return (
    <Panel title="Lembretes por WhatsApp">
      <p>
        {authorized ? (
          <Badge tone="ok">Autorizado</Badge>
        ) : (
          <Badge tone="neutral">Não autorizado</Badge>
        )}{' '}
        {authorized
          ? 'O paciente recebe lembrete antes das consultas.'
          : 'O paciente não recebe lembretes.'}
      </p>
      {!hasWhatsapp && !authorized && (
        <p className="muted small">Cadastre um telefone com WhatsApp para poder autorizar.</p>
      )}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={toggle}
          disabled={action.busy || (!hasWhatsapp && !authorized)}
        >
          {authorized ? 'Registrar que não autoriza' : 'Registrar autorização'}
        </button>
      </div>
      <Alert message={action.error} />
      <p className="muted small">{SIMULATED_NOTICE} A mudança fica no histórico do cadastro.</p>
      <Alert message={messages.error} />
      {messages.data && messages.data.length > 0 && (
        <MessageTable
          messages={messages.data}
          showPatient={false}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </Panel>
  );
}
