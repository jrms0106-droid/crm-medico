import { useState } from 'react';
import {
  type CertificateContent,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_LABELS,
  type DocumentDto,
  type DocumentKind,
  type DocumentSummaryDto,
  type ExamRequestContent,
  type PrescriptionContent,
  type ReferralContent,
  type ReportContent,
  type SessionInfo,
} from '@crm/shared';
import { ApiError, api } from '../api';
import { ReauthDialog } from '../reauth';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Panel,
  errorText,
  formatDate,
  formatDateTime,
  useAction,
  useLoad,
} from '../ui';

const STATUS_TONE: Record<string, string> = {
  draft: 'neutral',
  signed: 'ok',
  cancelled: 'warn',
  discarded: 'neutral',
};

/** Conteúdo em edição: o formulário guarda textos, que viram o conteúdo da API em `toContent`. */
type Draft = Record<string, unknown>;

const EMPTY: Record<DocumentKind, Draft> = {
  prescription: { items: [{ medication: '', instructions: '', quantity: '' }], notes: '' },
  certificate: { purpose: 'absence', days: '1', startDate: '', icd10: '', icd10Authorized: false },
  exam_request: { items: [{ exam: '', notes: '' }], clinicalIndication: '', icd10: '' },
  referral: { toSpecialty: '', reason: '', clinicalSummary: '' },
  report: { title: '', body: '' },
};

/** Tira os campos opcionais vazios (a API recusa CID vazio, por exemplo) e converte os dias. */
function toContent(kind: DocumentKind, draft: Draft): unknown {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== '' && v !== undefined)
          .map(([k, v]) => [k, clean(v)]),
      );
    }
    return value;
  };
  const content = clean(draft) as Draft;
  if (kind === 'certificate') {
    if (content.purpose === 'absence' && content.days !== undefined) {
      content.days = Number(content.days);
    } else {
      delete content.days;
    }
  }
  return content;
}

/** Conteúdo gravado → formulário (os dias voltam a ser texto). */
function toDraft(doc: DocumentDto): Draft {
  const base = { ...EMPTY[doc.kind], ...(doc.content as Draft) };
  if (doc.kind === 'certificate' && typeof base.days === 'number') base.days = String(base.days);
  return base;
}

/** Mensagem de erro da API com os detalhes de validação, para o médico saber o que corrigir. */
function fullError(e: unknown): string {
  if (e instanceof ApiError && e.details.length > 0) {
    return `${e.message} ${e.details.map((d) => d.issue).join(' ')}`;
  }
  return errorText(e);
}

const pdfUrl = (id: string) => `/api/v1/documents/${id}/pdf`;

/** Documentos médicos do paciente, dentro do prontuário (docs/api/documentos.md). */
export function DocumentsPanel({
  session,
  patientId,
  canCreate,
}: {
  session: SessionInfo;
  patientId: string;
  canCreate: boolean;
}) {
  const list = useLoad(
    () => api.get<DocumentSummaryDto[]>(`/patients/${patientId}/documents`),
    [patientId],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<DocumentKind | null>(null);

  return (
    <Panel title="Documentos">
      <Notice kind="warn">
        Assinatura eletrônica interna, sem certificado ICP-Brasil. A receita simples não serve para
        medicamentos controlados nem antimicrobianos. Campos ainda sem validação médica e jurídica.
      </Notice>
      {canCreate && !newKind && (
        <div className="actions">
          {DOCUMENT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="secondary"
              onClick={() => {
                setOpenId(null);
                setNewKind(kind);
              }}
            >
              {DOCUMENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}
      {newKind && (
        <DocumentEditor
          key={`novo-${newKind}`}
          kind={newKind}
          initial={EMPTY[newKind]}
          onCancel={() => setNewKind(null)}
          onSave={async (content) => {
            const created = await api.post<DocumentDto>(`/patients/${patientId}/documents`, {
              kind: newKind,
              content,
            });
            setNewKind(null);
            setOpenId(created.id);
            list.reload();
          }}
        />
      )}
      {openId && (
        <DocumentView
          key={openId}
          session={session}
          documentId={openId}
          onChanged={list.reload}
          onClose={() => setOpenId(null)}
        />
      )}
      <Alert message={list.error} />
      {list.loading && !list.data && <Loading what="os documentos" />}
      {list.data && list.data.length === 0 && (
        <p className="muted">Nenhum documento visível para você.</p>
      )}
      <ol className="timeline">
        {list.data?.map((d) => (
          <li key={d.id}>
            <button type="button" className="entry" onClick={() => setOpenId(d.id)}>
              <span>
                {d.issuedOn ? formatDate(d.issuedOn) : formatDateTime(d.createdAt)} ·{' '}
                {DOCUMENT_KIND_LABELS[d.kind]} · {d.author.name}
              </span>
              <Badge tone={STATUS_TONE[d.status]}>{DOCUMENT_STATUS_LABELS[d.status]}</Badge>
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function DocumentView({
  session,
  documentId,
  onChanged,
  onClose,
}: {
  session: SessionInfo;
  documentId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const doc = useLoad(() => api.get<DocumentDto>(`/documents/${documentId}`), [documentId]);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [signing, setSigning] = useState(false);
  const d = doc.data;
  const mine = d?.author.id === session.user.id;

  const changed = () => {
    doc.reload();
    onChanged();
  };

  const cancel = () => {
    const reason = window.prompt('Por que cancelar este documento? (mínimo 10 caracteres)');
    if (!reason) return;
    void action.run(async () => {
      await api.post(`/documents/${documentId}/cancel`, { reason });
      changed();
    });
  };

  const discard = () =>
    action.run(async () => {
      if (!window.confirm('Descartar este rascunho?')) return;
      await api.post(`/documents/${documentId}/discard`);
      onChanged();
      onClose();
    });

  return (
    <div className="panel nested" aria-label="Documento">
      <div className="panel-head">
        <h3>{d ? DOCUMENT_KIND_LABELS[d.kind] : 'Documento'}</h3>
        <button type="button" className="link" onClick={onClose}>
          Fechar
        </button>
      </div>
      <Alert message={doc.error} />
      {doc.loading && !d && <Loading what="o documento" />}
      {d && editing ? (
        <DocumentEditor
          kind={d.kind}
          initial={toDraft(d)}
          onCancel={() => setEditing(false)}
          onSave={async (content) => {
            await api.patch(`/documents/${d.id}`, { version: d.version, content });
            setEditing(false);
            changed();
          }}
        />
      ) : (
        d && (
          <>
            <p className="muted small">
              {d.author.name} ·{' '}
              <Badge tone={STATUS_TONE[d.status]}>{DOCUMENT_STATUS_LABELS[d.status]}</Badge>
              {d.issuedOn && <> · emitido em {formatDate(d.issuedOn)}</>}
            </p>
            {d.integrity && (
              <p className={`small ${d.integrity === 'valid' ? 'ok' : 'error'}`}>
                {d.integrity === 'valid'
                  ? `Assinado em ${d.signedAt ? formatDateTime(d.signedAt) : ''}. Conteúdo íntegro.`
                  : 'Atenção: o conteúdo não confere com a assinatura.'}
              </p>
            )}
            {d.status === 'cancelled' && (
              <Notice kind="warn">Documento cancelado. Motivo: {d.cancelReason}</Notice>
            )}
            <DocumentContentView doc={d} />
            <Alert message={action.error} />
            <div className="actions">
              <a className="button secondary" href={pdfUrl(d.id)} target="_blank" rel="noreferrer">
                {d.status === 'draft' ? 'Ver PDF (rascunho)' : 'Abrir PDF'}
              </a>
              {mine && d.status === 'draft' && (
                <>
                  <button type="button" onClick={() => setSigning(true)}>
                    Assinar
                  </button>
                  <button type="button" className="secondary" onClick={() => setEditing(true)}>
                    Editar
                  </button>
                  <button type="button" className="link" onClick={() => void discard()}>
                    Descartar
                  </button>
                </>
              )}
              {mine && d.status === 'signed' && (
                <button type="button" className="secondary" onClick={cancel}>
                  Cancelar documento
                </button>
              )}
            </div>
            {signing && (
              <ReauthDialog
                session={session}
                label="Confirmar assinatura do documento"
                confirmText="Confirmar e assinar"
                onCancel={() => setSigning(false)}
                onConfirm={async () => {
                  await api.post(`/documents/${d.id}/sign`, { version: d.version });
                  setSigning(false);
                  changed();
                }}
              >
                <p>
                  <strong>Assinatura eletrônica interna, sem ICP-Brasil.</strong> Depois de
                  assinado, o documento não pode mais ser alterado; se houver erro, cancele e emita
                  outro.
                </p>
              </ReauthDialog>
            )}
          </>
        )
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd className="pre">{value}</dd>
    </div>
  );
}

function DocumentContentView({ doc }: { doc: DocumentDto }) {
  switch (doc.kind) {
    case 'prescription': {
      const c = doc.content as PrescriptionContent;
      return (
        <dl className="facts">
          <div>
            <dt>Medicamentos</dt>
            <dd>
              <ol>
                {c.items.map((item, i) => (
                  <li key={i}>
                    <strong>{item.medication}</strong>
                    {item.quantity && ` (${item.quantity})`}: {item.instructions}
                  </li>
                ))}
              </ol>
            </dd>
          </div>
          <Fact label="Observações" value={c.notes} />
        </dl>
      );
    }
    case 'certificate': {
      const c = doc.content as CertificateContent;
      return (
        <dl className="facts">
          <Fact
            label="Finalidade"
            value={
              c.purpose === 'absence'
                ? `Afastamento por ${c.days} dia(s)${c.startDate ? ` a partir de ${formatDate(c.startDate)}` : ''}`
                : 'Comparecimento'
            }
          />
          <Fact label="CID-10 (autorizado pelo paciente)" value={c.icd10} />
          <Fact label="Observações" value={c.text} />
        </dl>
      );
    }
    case 'exam_request': {
      const c = doc.content as ExamRequestContent;
      return (
        <dl className="facts">
          <div>
            <dt>Exames</dt>
            <dd>
              <ol>
                {c.items.map((item, i) => (
                  <li key={i}>
                    {item.exam}
                    {item.notes && ` (${item.notes})`}
                  </li>
                ))}
              </ol>
            </dd>
          </div>
          <Fact label="Indicação clínica" value={c.clinicalIndication} />
          <Fact label="CID-10" value={c.icd10} />
        </dl>
      );
    }
    case 'referral': {
      const c = doc.content as ReferralContent;
      return (
        <dl className="facts">
          <Fact label="Encaminho para" value={c.toSpecialty} />
          <Fact label="Motivo" value={c.reason} />
          <Fact label="Resumo clínico" value={c.clinicalSummary} />
        </dl>
      );
    }
    case 'report': {
      const c = doc.content as ReportContent;
      return (
        <dl className="facts">
          <Fact label="Título" value={c.title} />
          <Fact label="Texto" value={c.body} />
        </dl>
      );
    }
  }
}

/** Formulário do documento. Só grava quando o médico pede: o conteúdo precisa estar completo. */
function DocumentEditor({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: DocumentKind;
  initial: Draft;
  onSave: (content: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (name: string, value: unknown) => setDraft((d) => ({ ...d, [name]: value }));
  const text = (name: string) => String(draft[name] ?? '');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(toContent(kind, draft));
    } catch (e) {
      setError(fullError(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    name: string,
    label: string,
    opts: { long?: boolean; required?: boolean } = {},
  ) => (
    <label className="field">
      <span>
        {label}
        {!opts.required && ' (opcional)'}
      </span>
      {opts.long ? (
        <textarea
          name={name}
          value={text(name)}
          rows={4}
          onChange={(e) => set(name, e.target.value)}
        />
      ) : (
        <input name={name} value={text(name)} onChange={(e) => set(name, e.target.value)} />
      )}
    </label>
  );

  return (
    <form
      aria-label={`Editar ${DOCUMENT_KIND_LABELS[kind]}`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{DOCUMENT_KIND_LABELS[kind]}</h3>
      {kind === 'prescription' && (
        <>
          <ItemList
            legend="Medicamentos"
            addLabel="Adicionar medicamento"
            items={draft.items as Record<string, string>[]}
            empty={{ medication: '', instructions: '', quantity: '' }}
            fields={[
              { name: 'medication', label: 'Medicamento' },
              { name: 'instructions', label: 'Posologia' },
              { name: 'quantity', label: 'Quantidade (opcional)' },
            ]}
            onChange={(items) => set('items', items)}
          />
          {field('notes', 'Observações', { long: true })}
        </>
      )}
      {kind === 'certificate' && (
        <>
          <label className="field">
            <span>Finalidade</span>
            <select
              name="purpose"
              value={text('purpose')}
              onChange={(e) => set('purpose', e.target.value)}
            >
              <option value="absence">Afastamento</option>
              <option value="attendance">Comparecimento</option>
            </select>
          </label>
          {draft.purpose === 'absence' && (
            <div className="inline">
              <label className="field">
                <span>Dias de afastamento</span>
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  value={text('days')}
                  onChange={(e) => set('days', e.target.value)}
                />
              </label>
              <label className="field">
                <span>A partir de (opcional)</span>
                <input
                  name="startDate"
                  type="date"
                  value={text('startDate')}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </label>
            </div>
          )}
          {field('icd10', 'CID-10')}
          <label className="check">
            <input
              type="checkbox"
              name="icd10Authorized"
              checked={draft.icd10Authorized === true}
              onChange={(e) => set('icd10Authorized', e.target.checked)}
            />{' '}
            O paciente autorizou incluir o CID no atestado
          </label>
          {field('text', 'Observações', { long: true })}
        </>
      )}
      {kind === 'exam_request' && (
        <>
          <ItemList
            legend="Exames"
            addLabel="Adicionar exame"
            items={draft.items as Record<string, string>[]}
            empty={{ exam: '', notes: '' }}
            fields={[
              { name: 'exam', label: 'Exame' },
              { name: 'notes', label: 'Observação (opcional)' },
            ]}
            onChange={(items) => set('items', items)}
          />
          {field('clinicalIndication', 'Indicação clínica', { long: true })}
          {field('icd10', 'CID-10')}
        </>
      )}
      {kind === 'referral' && (
        <>
          {field('toSpecialty', 'Encaminhar para (especialidade)', { required: true })}
          {field('reason', 'Motivo', { long: true, required: true })}
          {field('clinicalSummary', 'Resumo clínico', { long: true })}
        </>
      )}
      {kind === 'report' && (
        <>
          {field('title', 'Título', { required: true })}
          {field('body', 'Texto', { long: true, required: true })}
        </>
      )}
      <Alert message={error} />
      <div className="actions">
        <button type="submit" disabled={busy}>
          Salvar rascunho
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ItemList({
  legend,
  addLabel,
  items,
  empty,
  fields,
  onChange,
}: {
  legend: string;
  addLabel: string;
  items: Record<string, string>[];
  empty: Record<string, string>;
  fields: { name: string; label: string }[];
  onChange: (items: Record<string, string>[]) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {items.map((item, i) => (
        <div key={i} className="inline">
          {fields.map((f) => (
            <label key={f.name} className="field grow">
              <span>{f.label}</span>
              <input
                aria-label={`${f.label} ${i + 1}`}
                value={item[f.name] ?? ''}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, [f.name]: e.target.value } : x)))
                }
              />
            </label>
          ))}
          {items.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              Remover
            </button>
          )}
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...items, empty])}>
        {addLabel}
      </button>
    </fieldset>
  );
}
