import { useState } from 'react';
import {
  type AiFeature,
  type AiFeatureDto,
  type AiRecordField,
  RECORD_NOTES_MAX_CHARS,
  type RecordDraftSuggestionDto,
  type RecordSummarySuggestionDto,
  type SessionInfo,
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
