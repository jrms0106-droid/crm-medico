import { useState } from 'react';
import {
  type CardiologyContent,
  REPORT_TEXT_MAX_CHARS,
  type ReportReadingSuggestionDto,
  type AiFeature,
  type AiFeatureDto,
  type AiRecordField,
  RECORD_NOTES_MAX_CHARS,
  type RecordDraftSuggestionDto,
  type RecordSummarySuggestionDto,
  type SessionInfo,
  reportFieldValue,
  withReportField,
} from '@crm/shared';
import { api } from '../api';
import { Alert, Notice, formatDate, useAction, useLoad } from '../ui';
import { DecisionButtons } from './assistant';

const KIND_LABELS = { consultation: 'Consulta', evolution: 'Evolução', addendum: 'Adendo' };

/**
 * Assistente clínico (IA nível 2, docs/api/ia-nivel-2.md): só para o médico e só com o
 * interruptor ligado. O servidor confere tudo de novo; aqui é só para não mostrar botão inútil.
 */
function useClinicalFeature(session: SessionInfo, feature: AiFeature): boolean {
  const isDoctor = session.user.roles.includes('doctor');
  const features = useLoad(
    () => (isDoctor ? api.get<AiFeatureDto[]>('/ai/features') : Promise.resolve([])),
    [isDoctor],
  );
  return features.data?.find((f) => f.feature === feature)?.enabled ?? false;
}

export type InsertedField = { field: AiRecordField; text: string };

/** Organiza as anotações do médico nos campos do rascunho aberto. */
export function NotesOrganizer({
  session,
  patientId,
  onInsert,
}: {
  session: SessionInfo;
  patientId: string;
  onInsert: (fields: InsertedField[]) => void;
}) {
  const enabled = useClinicalFeature(session, 'record_draft');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<RecordDraftSuggestionDto | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  const action = useAction();
  if (!enabled) return null;

  const organize = () =>
    void action.run(async () => {
      setDecided(null);
      setResult(
        await api.post<RecordDraftSuggestionDto>('/ai/clinical/record-draft', { patientId, notes }),
      );
    });

  const decide = (decision: 'accepted' | 'discarded') =>
    void action.run(async () => {
      if (!result) return;
      await api.post(`/ai/requests/${result.requestId}/decision`, {
        decision,
        ...(decision === 'accepted' ? { edited: false } : {}),
      });
      if (decision === 'accepted') {
        onInsert(result.fields.map((f) => ({ field: f.field, text: f.text })));
        setNotes('');
      }
      setDecided(
        decision === 'accepted'
          ? 'Texto inserido no rascunho. Revise os campos antes de finalizar.'
          : 'Sugestão descartada.',
      );
      setResult(null);
    });

  return (
    <fieldset className="ai-draft">
      <legend>Organizar anotações (IA)</legend>
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Organizar anotações nos campos
        </button>
      ) : (
        <>
          <label className="field">
            <span>Suas anotações da consulta</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              maxLength={RECORD_NOTES_MAX_CHARS}
            />
          </label>
          <div className="inline">
            <button
              type="button"
              onClick={organize}
              disabled={action.busy || notes.trim().length < 3}
            >
              Organizar
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
        </>
      )}
      {decided && <p role="status">{decided}</p>}
      {result && (
        <div aria-label="Sugestão de organização">
          <Notice kind="warn">{result.notice}</Notice>
          {result.fields.length === 0 && <p className="muted">Nenhuma frase foi encaixada.</p>}
          <dl>
            {result.fields.map((f) => (
              <div key={f.field}>
                <dt>{f.label}</dt>
                <dd>
                  {f.text}{' '}
                  <span className="muted small">
                    (frase{f.sentences.length > 1 ? 's' : ''} {f.sentences.join(', ')})
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {result.unassigned.length > 0 && (
            <>
              <p className="small">
                Frases que ficaram de fora (não serão inseridas; copie se quiser usar):
              </p>
              <ul className="small">
                {result.unassigned.map((s) => (
                  <li key={s.number}>
                    {s.number}. {s.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="inline">
            <button
              type="button"
              onClick={() => decide('accepted')}
              disabled={action.busy || result.fields.length === 0}
            >
              Inserir no registro
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
        </div>
      )}
      <Alert message={action.error} />
    </fieldset>
  );
}

/**
 * Leitura de laudo (ADR 0042): o médico cola o texto, o assistente aponta números do laudo para
 * campos da ficha de cardiologia, e o médico escolhe quais usar. Só muda o rascunho aberto.
 */
export function ReportReader({
  session,
  patientId,
  value,
  onApply,
}: {
  session: SessionInfo;
  patientId: string;
  value: CardiologyContent | undefined;
  onApply: (next: CardiologyContent) => void;
}) {
  const enabled = useClinicalFeature(session, 'report_reading');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReportReadingSuggestionDto | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [decided, setDecided] = useState<string | null>(null);
  const action = useAction();
  if (!enabled) return null;

  const read = () =>
    void action.run(async () => {
      setDecided(null);
      setSkip(new Set());
      setResult(
        await api.post<ReportReadingSuggestionDto>('/ai/clinical/report-reading', {
          patientId,
          text,
        }),
      );
    });

  const decide = (decision: 'accepted' | 'discarded') =>
    void action.run(async () => {
      if (!result) return;
      const chosen = result.suggestions.filter((s) => !skip.has(s.field));
      await api.post(`/ai/requests/${result.requestId}/decision`, {
        decision,
        ...(decision === 'accepted' ? { edited: chosen.length < result.suggestions.length } : {}),
      });
      if (decision === 'accepted') {
        onApply(chosen.reduce((c, s) => withReportField(c, s.field, s.value), value ?? {}));
        setText('');
      }
      setDecided(
        decision === 'accepted'
          ? `${chosen.length} valor(es) colocado(s) na ficha. Confira com o laudo antes de finalizar.`
          : 'Sugestão descartada.',
      );
      setResult(null);
    });

  const toggle = (field: string) =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  return (
    <fieldset className="ai-draft">
      <legend>Ler laudo (IA)</legend>
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Ler laudo e sugerir valores
        </button>
      ) : (
        <>
          <label className="field">
            <span>Texto do laudo (ecocardiograma ou exames)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={REPORT_TEXT_MAX_CHARS}
            />
          </label>
          <div className="inline">
            <button type="button" onClick={read} disabled={action.busy || text.trim().length < 3}>
              Sugerir valores
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
        </>
      )}
      {decided && <p role="status">{decided}</p>}
      {result && (
        <div aria-label="Valores sugeridos do laudo">
          <Notice kind="warn">{result.notice}</Notice>
          {result.suggestions.length === 0 ? (
            <p className="muted">Nenhum valor reconhecido no texto.</p>
          ) : (
            <div className="table-scroll">
              <table aria-label="Valores encontrados no laudo">
                <thead>
                  <tr>
                    <th scope="col">Usar</th>
                    <th scope="col">Campo</th>
                    <th scope="col">Valor do laudo</th>
                    <th scope="col">Na ficha agora</th>
                    <th scope="col">Trecho do laudo</th>
                  </tr>
                </thead>
                <tbody>
                  {result.suggestions.map((s) => {
                    const current = reportFieldValue(value, s.field);
                    return (
                      <tr key={s.field}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Usar ${s.label} ${s.raw}`}
                            checked={!skip.has(s.field)}
                            onChange={() => toggle(s.field)}
                          />
                        </td>
                        <th scope="row">{s.label}</th>
                        <td>
                          {s.raw} {s.unit}
                        </td>
                        <td>
                          {current === undefined
                            ? '—'
                            : `${String(current).replace('.', ',')} (será substituído)`}
                        </td>
                        <td className="small">{s.excerpt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {result.outOfRange.length > 0 && (
            <>
              <p className="small">
                Números apontados que não cabem no campo (confira a digitação do laudo; não serão
                usados):
              </p>
              <ul className="small">
                {result.outOfRange.map((s) => (
                  <li key={s.field}>
                    {s.label}: {s.raw} {s.unit} ({s.excerpt})
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="inline">
            <button
              type="button"
              onClick={() => decide('accepted')}
              disabled={action.busy || result.suggestions.every((s) => skip.has(s.field))}
            >
              Usar os valores marcados
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
        </div>
      )}
      <Alert message={action.error} />
    </fieldset>
  );
}

/** Resumo extrativo do prontuário: cada trecho com a data, o tipo e o autor de onde veio. */
export function RecordSummaryPanel({
  session,
  patientId,
  onOpen,
}: {
  session: SessionInfo;
  patientId: string;
  onOpen: (recordId: string) => void;
}) {
  const enabled = useClinicalFeature(session, 'record_summary');
  const [result, setResult] = useState<RecordSummarySuggestionDto | null>(null);
  const action = useAction();
  if (!enabled) return null;

  const summarize = () =>
    void action.run(async () => {
      setResult(
        await api.post<RecordSummarySuggestionDto>('/ai/clinical/record-summary', { patientId }),
      );
    });

  return (
    <div className="panel">
      <h2>Resumo com fontes (IA)</h2>
      <button type="button" className="secondary" onClick={summarize} disabled={action.busy}>
        {result ? 'Gerar de novo' : 'Gerar resumo'}
      </button>
      <Alert message={action.error} />
      {result && (
        <div aria-label="Resumo do prontuário">
          <Notice kind="warn">
            {result.notice} O resumo não é guardado e não entra no prontuário.
          </Notice>
          <p className="muted small">
            {result.recordsUsed === 0
              ? 'Nenhum registro assinado que você possa ler.'
              : result.recordsUsed === 1
                ? 'Fonte: 1 registro assinado.'
                : `Fontes: ${result.recordsUsed} registros assinados.`}
            {result.sensitiveHidden === 1 &&
              ' 1 registro sensível ficou de fora; para ler, abra com justificativa.'}
            {result.sensitiveHidden > 1 &&
              ` ${result.sensitiveHidden} registros sensíveis ficaram de fora; para ler, abra com justificativa.`}
          </p>
          <ul className="timeline">
            {result.items.map((item, i) => (
              <li key={i}>
                <p>
                  <strong>{item.label}:</strong> {item.text}
                </p>
                <p className="muted small">
                  Fonte: {KIND_LABELS[item.source.kind]} de {formatDate(item.source.clinicalDate)} ·{' '}
                  {item.source.authorName}{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => onOpen(item.source.recordId)}
                  >
                    Abrir registro
                  </button>
                </p>
              </li>
            ))}
          </ul>
          {result.items.length > 0 && <DecisionButtons requestId={result.requestId} />}
        </div>
      )}
    </div>
  );
}
