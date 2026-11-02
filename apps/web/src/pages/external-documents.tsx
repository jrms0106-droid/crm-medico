import { useState } from 'react';
import {
  EXTERNAL_DOCUMENT_KIND_LABELS,
  EXTERNAL_DOCUMENT_KINDS,
  EXTERNAL_DOCUMENT_MIN_DATE,
  EXTERNAL_DOCUMENT_STATUS_LABELS,
  type ExternalDocumentDto,
  type SessionInfo,
} from '@crm/shared';
import { api } from '../api';
import { Alert, Badge, Loading, Notice, Panel, formatDate, todayLocal, useLoad } from '../ui';
import { text, useSubmit } from '../useSubmit';

const CFM_URL = 'https://prescricaoeletronica.cfm.org.br/';

/**
 * Documentos emitidos na plataforma do CFM e só registrados aqui
 * (docs/api/documentos-externos.md). O CRM não emite, não assina e não confere o código.
 */
export function ExternalDocumentsPanel({
  session,
  patientId,
  canCreate,
}: {
  session: SessionInfo;
  patientId: string;
  canCreate: boolean;
}) {
  const path = `/patients/${patientId}/external-documents`;
  const list = useLoad(() => api.get<ExternalDocumentDto[]>(path), [path]);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const create = useSubmit(async (data) => {
    await api.post<ExternalDocumentDto>(path, {
      kind: text(data, 'kind'),
      issuedOn: text(data, 'issuedOn'),
      summary: text(data, 'summary'),
      validationCode: text(data, 'validationCode'),
    });
    setAdding(false);
    list.reload();
  });

  const cancel = useSubmit(async (data) => {
    await api.post(`/external-documents/${cancelling}/cancel`, { reason: text(data, 'reason') });
    setCancelling(null);
    list.reload();
  });

  return (
    <Panel title="Emitidos na plataforma do CFM">
      <Notice kind="info">
        Receitas, atestados e pedidos com certificado ICP-Brasil são emitidos na{' '}
        <a href={CFM_URL} target="_blank" rel="noreferrer">
          Plataforma de Prescrição Eletrônica do CFM
        </a>
        , que é gratuita. Aqui você só registra o que emitiu lá. O CRM não confere o código.
      </Notice>
      {canCreate && !adding && (
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            Registrar documento emitido no CFM
          </button>
        </div>
      )}
      {adding && (
        <form aria-label="Registrar documento emitido no CFM" onSubmit={create.onSubmit}>
          <label className="field">
            <span>Tipo</span>
            <select name="kind" defaultValue="prescription">
              {EXTERNAL_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EXTERNAL_DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Data de emissão</span>
            <input
              type="date"
              name="issuedOn"
              required
              min={EXTERNAL_DOCUMENT_MIN_DATE}
              max={todayLocal()}
              defaultValue={todayLocal()}
            />
          </label>
          <label className="field">
            <span>O que foi emitido</span>
            <textarea name="summary" rows={3} required minLength={3} maxLength={2000} />
          </label>
          <label className="field">
            <span>Código do documento no CFM (opcional)</span>
            <input name="validationCode" maxLength={100} />
          </label>
          <Alert message={create.error} />
          <div className="actions">
            <button type="submit" disabled={create.busy}>
              {create.busy ? 'Registrando…' : 'Registrar'}
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      <Alert message={list.error} />
      {list.loading && !list.data && <Loading what="os registros" />}
      {list.data && list.data.length === 0 && (
        <p className="muted">Nenhum documento do CFM registrado que você possa ver.</p>
      )}
      <ol className="timeline">
        {list.data?.map((d) => (
          <li key={d.id}>
            <div className="entry">
              <span>
                {formatDate(d.issuedOn)} · {EXTERNAL_DOCUMENT_KIND_LABELS[d.kind]} · {d.author.name}
              </span>
              <Badge tone={d.status === 'registered' ? 'ok' : 'warn'}>
                {EXTERNAL_DOCUMENT_STATUS_LABELS[d.status]}
              </Badge>
            </div>
            <p className="small">{d.summary}</p>
            {d.validationCode && <p className="small">Código no CFM: {d.validationCode}</p>}
            {d.cancelReason && <p className="small">Motivo do cancelamento: {d.cancelReason}</p>}
            {d.status === 'registered' &&
              d.author.id === session.user.id &&
              cancelling !== d.id && (
                <button type="button" className="link" onClick={() => setCancelling(d.id)}>
                  Cancelar registro
                </button>
              )}
            {cancelling === d.id && (
              <form aria-label="Cancelar registro" onSubmit={cancel.onSubmit}>
                <p className="small">
                  Isto cancela só o registro no CRM. Para cancelar o documento, use a plataforma do
                  CFM.
                </p>
                <label className="field">
                  <span>Motivo (mínimo 10 caracteres)</span>
                  <input name="reason" required minLength={10} maxLength={1000} />
                </label>
                <Alert message={cancel.error} />
                <div className="actions">
                  <button type="submit" disabled={cancel.busy}>
                    Confirmar cancelamento
                  </button>
                  <button type="button" className="secondary" onClick={() => setCancelling(null)}>
                    Voltar
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
