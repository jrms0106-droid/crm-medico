import { useState } from 'react';
import {
  PATIENT_IMPORT_MAX_ROWS,
  PATIENT_IMPORT_STATUS_LABELS,
  PATIENT_IMPORT_TEMPLATE,
  type PatientImportLineStatus,
  type PatientImportResultDto,
} from '@crm/shared';
import { api } from '../api';
import { href } from '../router';
import { Alert, Badge, Notice, Page, Panel, useAction } from '../ui';

const STATUS_TONE: Record<PatientImportLineStatus, string> = {
  ready: 'info',
  created: 'ok',
  duplicate: 'warn',
  error: 'warn',
};

function downloadTemplate() {
  // O BOM faz o Excel abrir o arquivo como UTF-8 (acentos certos).
  const blob = new Blob(['\uFEFF', PATIENT_IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-importacao-pacientes.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Importação de pacientes por planilha (docs/api/integracoes.md): conferir primeiro, depois
 * importar só as linhas prontas. Consentimentos nunca vêm da planilha.
 */
export function ImportPage() {
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [result, setResult] = useState<PatientImportResultDto | null>(null);
  const action = useAction();

  const choose = async (input: HTMLInputElement) => {
    setResult(null);
    action.setError(null);
    const chosen = input.files?.[0];
    setFile(chosen ? { name: chosen.name, csv: await chosen.text() } : null);
  };
  const send = (path: '/patients/import/preview' | '/patients/import') => {
    if (!file) return;
    void action.run(async () => {
      setResult(await api.post<PatientImportResultDto>(path, { csv: file.csv }));
    });
  };

  return (
    <Page title="Importar pacientes">
      <Notice>
        Traga o cadastro de outro sistema por uma planilha CSV de até {PATIENT_IMPORT_MAX_ROWS}{' '}
        pacientes. Primeiro o sistema confere cada linha; depois entram só as linhas sem erro e sem
        duplicidade. Nenhum paciente entra com autorização de lembretes ou de marketing: isso é
        registrado depois, com o próprio paciente.
      </Notice>
      <Panel title="1. Arquivo">
        <p>
          Use o modelo: colunas <code>nome</code>, <code>data_nascimento</code> e{' '}
          <code>telefone</code> são obrigatórias. No Excel, salve como “CSV UTF-8”.
        </p>
        <button type="button" className="secondary" onClick={downloadTemplate}>
          Baixar modelo de planilha
        </button>
        <label className="field">
          <span>Planilha (CSV)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void choose(e.currentTarget)}
          />
        </label>
        <div className="inline">
          <button
            type="button"
            onClick={() => send('/patients/import/preview')}
            disabled={!file || action.busy}
          >
            Conferir planilha
          </button>
          {result && !result.committed && result.totals.ready > 0 && (
            <button type="button" onClick={() => send('/patients/import')} disabled={action.busy}>
              Importar {result.totals.ready} paciente(s)
            </button>
          )}
        </div>
        <Alert message={action.error} />
      </Panel>
      {result && <ImportResult result={result} />}
    </Page>
  );
}

function ImportResult({ result }: { result: PatientImportResultDto }) {
  const { totals } = result;
  return (
    <Panel title={result.committed ? '2. Resultado da importação' : '2. Conferência'}>
      <p role="status">
        {result.committed
          ? `${totals.created} paciente(s) cadastrado(s); ${totals.duplicate} com possível duplicidade e ${totals.error} com erro ficaram de fora.`
          : `${totals.ready} linha(s) pronta(s) para entrar, ${totals.duplicate} com possível duplicidade e ${totals.error} com erro. Nada foi gravado ainda.`}
      </p>
      {result.ignoredColumns.length > 0 && (
        <Notice kind="warn">Colunas ignoradas: {result.ignoredColumns.join(', ')}.</Notice>
      )}
      <table aria-label="Linhas da planilha">
        <thead>
          <tr>
            <th>Linha</th>
            <th>Nome</th>
            <th>Situação</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((l) => (
            <tr key={l.line}>
              <td>{l.line}</td>
              <td>
                {l.patientId ? (
                  <a href={href(`/pacientes/${l.patientId}`)}>{l.name}</a>
                ) : (
                  l.name || '—'
                )}
              </td>
              <td>
                <Badge tone={STATUS_TONE[l.status]}>{PATIENT_IMPORT_STATUS_LABELS[l.status]}</Badge>
              </td>
              <td>
                {l.messages.length > 0 ? (
                  <ul className="plain">
                    {l.messages.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
