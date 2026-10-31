import { type FormEvent, useState } from 'react';
import {
  AI_DECISION_LABELS,
  type AiFeature,
  type AiFeatureDto,
  type AiRequestDto,
  MESSAGE_PURPOSE_LABELS,
  type MessageDraftDto,
  type MessagePurpose,
  type RequestTriageDto,
  TRIAGE_CATEGORY_LABELS,
  TRIAGE_URGENT_NOTICE,
} from '@crm/shared';
import { api } from '../api';
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

type Guarded = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Revisão humana da sugestão (docs/api/ia-nivel-1.md): a secretária edita, copia e marca como
 * usada, ou descarta. A decisão só é registrada uma vez.
 */
function DraftReview({
  requestId,
  text,
  notice,
  onDecided,
}: {
  requestId: string;
  text: string;
  notice: string;
  onDecided?: () => void;
}) {
  const [value, setValue] = useState(text);
  const [decided, setDecided] = useState<string | null>(null);
  const action = useAction();
  const decide = (decision: 'accepted' | 'discarded') =>
    void action.run(async () => {
      if (decision === 'accepted') {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Sem acesso à área de transferência: a secretária copia à mão.
        }
      }
      await api.post(`/ai/requests/${requestId}/decision`, {
        decision,
        ...(decision === 'accepted' ? { edited: value !== text } : {}),
      });
      setDecided(
        decision === 'accepted' ? 'Texto copiado e marcado como usado.' : 'Sugestão descartada.',
      );
      onDecided?.();
    });
  return (
    <div className="ai-draft">
      <Notice kind="warn">{notice}</Notice>
      <label className="field">
        <span>Sugestão (revise e edite antes de usar)</span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          maxLength={1000}
          disabled={decided !== null}
        />
      </label>
      {decided ? (
        <p role="status">{decided}</p>
      ) : (
        <div className="inline">
          <button type="button" onClick={() => decide('accepted')} disabled={action.busy}>
            Copiar e marcar como usado
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => decide('discarded')}
            disabled={action.busy}
          >
            Descartar
          </button>
        </div>
      )}
      <Alert message={action.error} />
    </div>
  );
}

/** Rascunho de mensagem para uma consulta, aberto pela agenda. */
export function AppointmentMessageDraft({ appointmentId }: { appointmentId: string }) {
  const [purpose, setPurpose] = useState<Exclude<MessagePurpose, 'notice'>>('confirmation');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<MessageDraftDto | null>(null);
  const action = useAction();
  const generate = (event: FormEvent) => {
    event.preventDefault();
    setDraft(null);
    void action.run(async () =>
      setDraft(
        await api.post<MessageDraftDto>('/ai/message-drafts', {
          purpose,
          appointmentId,
          ...(note.trim() ? { note } : {}),
        }),
      ),
    );
  };
  return (
    <div className="ai-panel">
      <form className="inline" onSubmit={generate} aria-label="Rascunho de mensagem">
        <label className="field">
          <span>Motivo</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
            {(['confirmation', 'reschedule', 'no_show'] as const).map((p) => (
              <option key={p} value={p}>
                {MESSAGE_PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Observação (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </label>
        <button type="submit" disabled={action.busy}>
          Gerar rascunho
        </button>
      </form>
      <Alert message={action.error} />
      {draft && (
        <DraftReview
          key={draft.requestId}
          requestId={draft.requestId}
          text={draft.text}
          notice={draft.notice}
        />
      )}
    </div>
  );
}

/** Assistente da recepção (IA nível 1): classificação de pedidos, avisos e histórico. */
export function AssistantPage() {
  const features = useLoad(() => api.get<AiFeatureDto[]>('/ai/features'), []);
  const history = useLoad(() => api.get<AiRequestDto[]>('/ai/requests'), []);
  const enabled = (f: AiFeature) => features.data?.find((x) => x.feature === f)?.enabled ?? false;
  return (
    <Page title="Assistente (IA)">
      <Notice>
        O assistente ajuda só em tarefas administrativas: separar os pedidos que chegam e escrever
        mensagens. Ele não lê o prontuário, não dá orientação de saúde e não faz nada sozinho; tudo
        é sugestão para você revisar. Por enquanto as respostas vêm de um modelo simulado, sem
        nenhum serviço de IA contratado. O rascunho de mensagem para uma consulta fica na Agenda.
      </Notice>
      <Alert message={features.error} />
      {!features.data && !features.error && <Loading what="o assistente" />}
      {features.data && (
        <>
          <TriagePanel enabled={enabled('request_triage')} onUsed={history.reload} />
          <NoticePanel enabled={enabled('message_draft')} onUsed={history.reload} />
        </>
      )}
      <Panel title="Meu histórico">
        <Alert message={history.error} />
        {history.data && history.data.length === 0 && <p className="muted">Nenhum uso ainda.</p>}
        {history.data && history.data.length > 0 && <HistoryTable rows={history.data} showOutput />}
      </Panel>
    </Page>
  );
}

const disabledNotice = (
  <p className="muted">Desligado. O administrador liga esta funcionalidade em Configurações.</p>
);

function TriagePanel({ enabled, onUsed }: { enabled: boolean; onUsed: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<RequestTriageDto | null>(null);
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    void action.run(async () => {
      setResult(await api.post<RequestTriageDto>('/ai/request-triage', { text }));
      onUsed();
    });
  };
  return (
    <Panel title="Classificar pedido de paciente">
      {!enabled ? (
        disabledNotice
      ) : (
        <form onSubmit={submit} aria-label="Classificar pedido">
          <label className="field">
            <span>Mensagem do paciente</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={2000}
              required
            />
          </label>
          <button type="submit" disabled={action.busy}>
            Classificar
          </button>
        </form>
      )}
      <Alert message={action.error} />
      {result && (
        <>
          <p role="status">
            Categoria: <strong>{TRIAGE_CATEGORY_LABELS[result.category]}</strong>
          </p>
          {result.urgent && <Notice kind="warn">{TRIAGE_URGENT_NOTICE}</Notice>}
          <DraftReview
            key={result.requestId}
            requestId={result.requestId}
            text={result.suggestedReply}
            notice={result.notice}
            onDecided={onUsed}
          />
        </>
      )}
    </Panel>
  );
}

function NoticePanel({ enabled, onUsed }: { enabled: boolean; onUsed: () => void }) {
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<MessageDraftDto | null>(null);
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDraft(null);
    void action.run(async () => {
      setDraft(await api.post<MessageDraftDto>('/ai/message-drafts', { purpose: 'notice', note }));
      onUsed();
    });
  };
  return (
    <Panel title="Aviso administrativo">
      {!enabled ? (
        disabledNotice
      ) : (
        <form onSubmit={submit} aria-label="Aviso administrativo">
          <label className="field">
            <span>O que o aviso deve dizer</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              required
            />
          </label>
          <button type="submit" disabled={action.busy}>
            Gerar rascunho
          </button>
        </form>
      )}
      <Alert message={action.error} />
      {draft && (
        <DraftReview
          key={draft.requestId}
          requestId={draft.requestId}
          text={draft.text}
          notice={draft.notice}
          onDecided={onUsed}
        />
      )}
    </Panel>
  );
}

function HistoryTable({ rows, showOutput }: { rows: AiRequestDto[]; showOutput: boolean }) {
  return (
    <table aria-label="Usos do assistente">
      <thead>
        <tr>
          <th>Quando</th>
          <th>Uso</th>
          {!showOutput && <th>Quem</th>}
          <th>Modelo</th>
          {showOutput && <th>Sugestão</th>}
          <th>Revisão</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{formatDateTime(r.createdAt)}</td>
            <td>
              {r.feature === 'request_triage' ? 'Classificação' : 'Rascunho'}
              <div className="muted small">{r.purpose}</div>
            </td>
            {!showOutput && <td>{r.user.name}</td>}
            <td className="small">
              {r.model.provider}/{r.model.model} v{r.model.version}
            </td>
            {showOutput && <td className="small">{r.output}</td>}
            <td>
              <Badge
                tone={
                  r.decision === 'draft' ? 'info' : r.decision === 'accepted' ? 'ok' : 'neutral'
                }
              >
                {AI_DECISION_LABELS[r.decision]}
              </Badge>
              {r.edited && <div className="muted small">com edição</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Configurações: interruptor de cada funcionalidade de IA e o uso de todos, sem o texto. */
export function AiSettingsSection({ guarded }: { guarded: Guarded }) {
  const features = useLoad(() => api.get<AiFeatureDto[]>('/ai/features'), []);
  const usage = useLoad(() => api.get<AiRequestDto[]>('/ai/requests'), []);
  const action = useAction();
  const toggle = (f: AiFeatureDto) =>
    void action.run(async () => {
      await guarded(() => api.put(`/ai/features/${f.feature}`, { enabled: !f.enabled }));
      features.reload();
    });
  return (
    <Panel title="Assistente de IA (nível 1, administrativo)">
      <p className="muted">
        Cada funcionalidade começa desligada. Hoje as respostas vêm de um modelo simulado, sem
        enviar dados para fora; contratar um serviço de IA depende de autorização e de avaliação de
        contrato e privacidade.
      </p>
      <Alert message={features.error ?? action.error} />
      <ul>
        {features.data?.map((f) => (
          <li key={f.feature}>
            {f.label}:{' '}
            <Badge tone={f.enabled ? 'ok' : 'neutral'}>{f.enabled ? 'Ligado' : 'Desligado'}</Badge>{' '}
            <button type="button" className="link" onClick={() => toggle(f)} disabled={action.busy}>
              {f.enabled ? 'Desligar' : 'Ligar'}
            </button>
          </li>
        ))}
      </ul>
      <h3>Uso recente</h3>
      <Alert message={usage.error} />
      {usage.data && usage.data.length === 0 && <p className="muted">Nenhum uso ainda.</p>}
      {usage.data && usage.data.length > 0 && <HistoryTable rows={usage.data} showOutput={false} />}
    </Panel>
  );
}
