import { useEffect, useRef, useState } from 'react';
import {
  CARE_STATE_LABELS,
  type CareAccessDto,
  type PatientDto,
  RECORD_STATUS_LABELS,
  type RecordContent,
  type RecordDto,
  type RecordSensitivity,
  type RecordSummaryDto,
  type SessionInfo,
} from '@crm/shared';
import { ApiError, api, query } from '../api';
import { ReauthDialog } from '../reauth';
import { DocumentsPanel } from './documents';
import { type InsertedField, NotesOrganizer, RecordSummaryPanel } from './clinical-assistant';
import { ClinicalCopyButton } from './privacy';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Page,
  Panel,
  errorText,
  formatDate,
  formatDateTime,
  useAction,
  useLoad,
} from '../ui';

const KIND_LABELS = { consultation: 'Consulta', evolution: 'Evolução', addendum: 'Adendo' };
const SENSITIVITY_LABELS: Record<RecordSensitivity, string> = {
  normal: 'Normal',
  elevated: 'Elevada (ex.: saúde mental)',
  restricted: 'Restrita',
};
const STATUS_TONE: Record<string, string> = {
  draft: 'neutral',
  finalized: 'info',
  signed: 'ok',
  rectified: 'warn',
  archived: 'neutral',
  discarded: 'neutral',
};

const TEXT_FIELDS: {
  name: 'chiefComplaint' | 'anamnesis' | 'physicalExam' | 'plan';
  label: string;
}[] = [
  { name: 'chiefComplaint', label: 'Motivo da consulta' },
  { name: 'anamnesis', label: 'Anamnese' },
  { name: 'physicalExam', label: 'Exame físico' },
  { name: 'plan', label: 'Conduta' },
];

export function RecordPage({
  session,
  patientId,
  encounterId,
}: {
  session: SessionInfo;
  patientId: string;
  encounterId: string | null;
}) {
  const patient = useLoad(() => api.get<PatientDto>(`/patients/${patientId}`), [patientId]);
  const access = useLoad(
    () => api.get<CareAccessDto>(`/patients/${patientId}/care-access`),
    [patientId],
  );
  const [showArchived, setShowArchived] = useState(false);
  const timeline = useLoad(
    () =>
      api.get<RecordSummaryDto[]>(
        `/patients/${patientId}/records${query({ includeArchived: showArchived || undefined })}`,
      ),
    [patientId, showArchived],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const action = useAction();

  const refresh = () => {
    timeline.reload();
    access.reload();
  };

  const create = () =>
    action.run(async () => {
      const created = await api.post<RecordDto>(`/patients/${patientId}/records`, {});
      setOpenId(created.id);
      timeline.reload();
    });

  const closeEncounter = () =>
    action.run(async () => {
      await api.post(`/encounters/${encounterId}/close`, {});
      window.location.hash = `/prontuario/${patientId}`;
      access.reload();
    });

  const name = patient.data?.displayName ?? '';
  const can = access.data?.can;
  return (
    <Page
      title={name ? `Prontuário de ${name}` : 'Prontuário'}
      actions={
        <>
          {can?.createRecords && (
            <button type="button" onClick={() => void create()} disabled={action.busy}>
              Novo registro
            </button>
          )}
          {access.data?.state && ['started', 'follow_up', 'closed'].includes(access.data.state) && (
            <ClinicalCopyButton session={session} patientId={patientId} />
          )}
          {encounterId && access.data?.state === 'started' && (
            <button type="button" className="secondary" onClick={() => void closeEncounter()}>
              Encerrar atendimento
            </button>
          )}
        </>
      }
    >
      <Notice kind="warn">
        Formulário genérico e assinatura eletrônica interna, ainda sem validação médica e jurídica.
        Não use com pacientes reais.
      </Notice>
      <Alert message={patient.error ?? access.error ?? action.error} />
      {access.data && (
        <p className="muted">
          Vínculo: {access.data.state ? CARE_STATE_LABELS[access.data.state] : 'sem vínculo'}
          {access.data.emergencyUntil &&
            ` · acesso emergencial até ${formatDateTime(access.data.emergencyUntil)}`}
        </p>
      )}
      {openId && (
        <RecordView
          key={openId}
          session={session}
          recordId={openId}
          onChanged={refresh}
          onOpen={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
      {can?.viewHistory && (
        <RecordSummaryPanel session={session} patientId={patientId} onOpen={setOpenId} />
      )}
      <Panel title="Linha do tempo">
        <label className="check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{' '}
          Mostrar arquivados
        </label>
        <Alert message={timeline.error} />
        {timeline.loading && !timeline.data && <Loading what="os registros" />}
        {timeline.data && timeline.data.length === 0 && (
          <p className="muted">Nenhum registro visível para você.</p>
        )}
        <ol className="timeline">
          {timeline.data?.map((r) => (
            <li key={r.id}>
              <button type="button" className="entry" onClick={() => setOpenId(r.id)}>
                <span>
                  {formatDate(r.clinicalDate)} · {KIND_LABELS[r.kind]} · {r.author.name}
                </span>
                <Badge tone={STATUS_TONE[r.status]}>{RECORD_STATUS_LABELS[r.status]}</Badge>
                {r.sensitivity !== 'normal' && <Badge tone="warn">Sensível</Badge>}
              </button>
              {r.contentHidden ? (
                <p className="muted small">Conteúdo sensível: abrir exige justificativa.</p>
              ) : (
                r.content?.chiefComplaint && <p className="small">{r.content.chiefComplaint}</p>
              )}
            </li>
          ))}
        </ol>
      </Panel>
      {can && (can.viewHistory || can.viewOwnRecords) && (
        <DocumentsPanel session={session} patientId={patientId} canCreate={can.createRecords} />
      )}
    </Page>
  );
}

function RecordView({
  session,
  recordId,
  onChanged,
  onOpen,
  onClose,
}: {
  session: SessionInfo;
  recordId: string;
  onChanged: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<RecordDto | null>(null);
  const [needsJustification, setNeedsJustification] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<RecordDto>(`/records/${recordId}`).then(
      (r) => alive && setRecord(r),
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) setNeedsJustification(true);
        else setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [recordId]);

  const openJustified = async (justification: string) => {
    setError(null);
    try {
      setRecord(await api.get<RecordDto>(`/records/${recordId}${query({ justification })}`));
      setNeedsJustification(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const updated = (r: RecordDto) => {
    setRecord(r);
    onChanged();
  };

  return (
    <Panel>
      <div className="panel-head">
        <h2>Registro</h2>
        <button type="button" className="link" onClick={onClose}>
          Fechar
        </button>
      </div>
      <Alert message={error} />
      {needsJustification && <JustificationForm onSubmit={(j) => void openJustified(j)} />}
      {record &&
        (record.status === 'draft' && record.author.id === session.user.id ? (
          <DraftEditor session={session} initial={record} onChange={updated} />
        ) : (
          <RecordReadOnly
            session={session}
            record={record}
            onChange={updated}
            onOpen={(id) => {
              onChanged();
              onOpen(id);
            }}
          />
        ))}
    </Panel>
  );
}

function JustificationForm({ onSubmit }: { onSubmit: (justification: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <Notice kind="warn">
        Registro sensível de outro profissional. Para abrir, escreva por que precisa ver. A
        justificativa fica gravada e na auditoria.
      </Notice>
      <label className="field">
        <span>Justificativa</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} minLength={10} required />
      </label>
      <button type="submit">Abrir com justificativa</button>
    </form>
  );
}

function RecordMeta({ record }: { record: RecordDto }) {
  return (
    <p className="muted small">
      {KIND_LABELS[record.kind]} de {formatDate(record.clinicalDate)} · {record.author.name} ·{' '}
      <Badge tone={STATUS_TONE[record.status]}>{RECORD_STATUS_LABELS[record.status]}</Badge>
      {record.sensitivity !== 'normal' && (
        <> · sensibilidade {SENSITIVITY_LABELS[record.sensitivity]}</>
      )}
      {record.justification && <> · justificativa: {record.justification}</>}
    </p>
  );
}

function ContentView({ content }: { content: RecordContent }) {
  return (
    <dl className="facts">
      {TEXT_FIELDS.map(
        (f) =>
          content[f.name] && (
            <div key={f.name}>
              <dt>{f.label}</dt>
              <dd className="pre">{content[f.name]}</dd>
            </div>
          ),
      )}
      {content.hypotheses && content.hypotheses.length > 0 && (
        <div>
          <dt>Hipóteses</dt>
          <dd>
            <ul>
              {content.hypotheses.map((h, i) => (
                <li key={i}>
                  {h.description}
                  {h.icd10 && ` (CID-10 ${h.icd10})`}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}

function RecordReadOnly({
  session,
  record,
  onChange,
  onOpen,
}: {
  session: SessionInfo;
  record: RecordDto;
  onChange: (r: RecordDto) => void;
  onOpen: (id: string) => void;
}) {
  const action = useAction();
  const [signing, setSigning] = useState(false);
  const mine = record.author.id === session.user.id;

  const post = (verb: string, body: object = {}) =>
    action.run(async () =>
      onChange(await api.post<RecordDto>(`/records/${record.id}/${verb}`, body)),
    );

  const correction = (verb: 'rectify' | 'addendum') => {
    const justification = window.prompt(
      verb === 'rectify'
        ? 'Por que retificar? (mínimo 10 caracteres)'
        : 'Por que adicionar um adendo? (mínimo 10 caracteres)',
    );
    if (!justification) return;
    void action.run(async () => {
      const created = await api.post<RecordDto>(`/records/${record.id}/${verb}`, { justification });
      onOpen(created.id);
    });
  };

  return (
    <>
      <RecordMeta record={record} />
      {record.integrity && (
        <p className={`small ${record.integrity === 'valid' ? 'ok' : 'error'}`}>
          {record.integrity === 'valid'
            ? `Assinado em ${record.signedAt ? formatDateTime(record.signedAt) : ''}. Conteúdo íntegro.`
            : 'Atenção: o conteúdo não confere com a assinatura.'}
        </p>
      )}
      {record.rectifiedById && (
        <Notice kind="warn">
          Este registro foi retificado.{' '}
          <button type="button" className="link" onClick={() => onOpen(record.rectifiedById ?? '')}>
            Ver a retificação
          </button>
        </Notice>
      )}
      {record.rectifiesId && (
        <p className="small">
          Retifica{' '}
          <button type="button" className="link" onClick={() => onOpen(record.rectifiesId ?? '')}>
            o registro original
          </button>
        </p>
      )}
      <ContentView content={record.content} />
      <Alert message={action.error} />
      {mine && (
        <div className="actions">
          {record.status === 'finalized' && (
            <>
              <button type="button" onClick={() => setSigning(true)}>
                Assinar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const reason = window.prompt('Motivo para reabrir:');
                  if (reason) void post('reopen', { reason });
                }}
              >
                Reabrir
              </button>
            </>
          )}
          {record.status === 'signed' && (
            <button type="button" className="secondary" onClick={() => correction('rectify')}>
              Retificar
            </button>
          )}
          {(record.status === 'signed' || record.status === 'rectified') && (
            <button type="button" className="secondary" onClick={() => correction('addendum')}>
              Adendo
            </button>
          )}
        </div>
      )}
      {signing && (
        <ReauthDialog
          session={session}
          label="Confirmar assinatura"
          confirmText="Confirmar e assinar"
          onCancel={() => setSigning(false)}
          onConfirm={async () => {
            onChange(
              await api.post<RecordDto>(`/records/${record.id}/sign`, { version: record.version }),
            );
            setSigning(false);
          }}
        >
          <p>
            <strong>Assinatura eletrônica interna.</strong> Depois de assinado, o registro não pode
            mais ser alterado; correções só por retificação ou adendo.
          </p>
        </ReauthDialog>
      )}
    </>
  );
}

const AUTOSAVE_MS = 3000;

/** Rascunho: salva sozinho alguns segundos depois de parar de digitar. */
function DraftEditor({
  session,
  initial,
  onChange,
}: {
  session: SessionInfo;
  initial: RecordDto;
  onChange: (r: RecordDto) => void;
}) {
  const [content, setContent] = useState<RecordContent>(initial.content);
  const [sensitivity, setSensitivity] = useState<RecordSensitivity>(initial.sensitivity);
  const [version, setVersion] = useState(initial.version);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>('Rascunho salvo.');
  const [conflict, setConflict] = useState(false);
  const action = useAction();
  const timer = useRef<number | undefined>(undefined);

  const save = async (): Promise<RecordDto | null> => {
    try {
      const saved = await api.patch<RecordDto>(`/records/${initial.id}`, {
        version,
        content,
        sensitivity,
      });
      setVersion(saved.version);
      setDirty(false);
      setConflict(false);
      setStatus(`Salvo às ${new Date().toLocaleTimeString('pt-BR')}.`);
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setConflict(true);
      setStatus(errorText(e));
      return null;
    }
  };

  useEffect(() => {
    if (!dirty || conflict) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, sensitivity, dirty, conflict]);

  const edit = (patch: Partial<RecordContent>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  /** Texto aceito do assistente: vai para o fim de cada campo, sem apagar o que já existe. */
  const insert = (fields: InsertedField[]) => {
    setContent((c) => {
      const next = { ...c };
      for (const { field, text } of fields) {
        const current = next[field]?.trim();
        next[field] = current ? `${current}\n${text}` : text;
      }
      return next;
    });
    setDirty(true);
  };

  const finalize = () =>
    action.run(async () => {
      window.clearTimeout(timer.current);
      const saved = dirty ? await save() : null;
      if (dirty && !saved) return;
      onChange(
        await api.post<RecordDto>(`/records/${initial.id}/finalize`, {
          version: saved?.version ?? version,
        }),
      );
    });

  const discard = () =>
    action.run(async () => {
      if (!window.confirm('Descartar este rascunho?')) return;
      onChange(await api.post<RecordDto>(`/records/${initial.id}/discard`));
    });

  /** Em conflito, busca a versão atual e mantém o texto da tela para o médico decidir. */
  const reloadVersion = () =>
    action.run(async () => {
      const current = await api.get<RecordDto>(`/records/${initial.id}`);
      setVersion(current.version);
      setConflict(false);
      setStatus('Versão atual carregada. Seu texto continua na tela; salve para sobrescrever.');
    });

  const hypotheses = content.hypotheses ?? [];
  return (
    <form onSubmit={(e) => e.preventDefault()} aria-label="Editar rascunho">
      <p className="muted small">
        {KIND_LABELS[initial.kind]} de {formatDate(initial.clinicalDate)} · rascunho de{' '}
        {session.user.name}
        {initial.justification && <> · justificativa: {initial.justification}</>}
      </p>
      <NotesOrganizer session={session} patientId={initial.patientId} onInsert={insert} />
      {TEXT_FIELDS.map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}</span>
          <textarea
            name={f.name}
            value={content[f.name] ?? ''}
            onChange={(e) => edit({ [f.name]: e.target.value })}
            rows={f.name === 'anamnesis' ? 5 : 3}
          />
        </label>
      ))}
      <fieldset>
        <legend>Hipóteses diagnósticas</legend>
        {hypotheses.map((h, i) => (
          <div key={i} className="inline">
            <label className="field grow">
              <span>Descrição</span>
              <input
                value={h.description}
                onChange={(e) =>
                  edit({
                    hypotheses: hypotheses.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label className="field">
              <span>CID-10 (opcional)</span>
              <input
                value={h.icd10 ?? ''}
                onChange={(e) =>
                  edit({
                    hypotheses: hypotheses.map((x, j) =>
                      j === i ? { ...x, icd10: e.target.value || undefined } : x,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="link"
              onClick={() => edit({ hypotheses: hypotheses.filter((_, j) => j !== i) })}
            >
              Remover
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => edit({ hypotheses: [...hypotheses, { description: '' }] })}
        >
          Adicionar hipótese
        </button>
      </fieldset>
      <label className="field">
        <span>Sensibilidade</span>
        <select
          value={sensitivity}
          onChange={(e) => {
            setSensitivity(e.target.value as RecordSensitivity);
            setDirty(true);
          }}
        >
          {Object.entries(SENSITIVITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="small" role="status">
        {dirty ? 'Alterações não salvas…' : status}
      </p>
      {conflict && (
        <Notice kind="warn">
          Este registro foi salvo em outra janela.{' '}
          <button type="button" className="link" onClick={() => void reloadVersion()}>
            Carregar a versão atual
          </button>
        </Notice>
      )}
      <Alert message={action.error} />
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void save()} disabled={!dirty}>
          Salvar rascunho
        </button>
        <button type="button" onClick={() => void finalize()} disabled={action.busy || conflict}>
          Finalizar
        </button>
        <button type="button" className="link" onClick={() => void discard()}>
          Descartar
        </button>
      </div>
    </form>
  );
}
