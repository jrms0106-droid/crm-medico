import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type PatientCreateInput,
  type PatientImportLineDto,
  type PatientImportResultDto,
  importIdentityKeys,
  importRow,
  prepareImport,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { AuthContext } from '../identity/session.service.js';
import { PatientsService } from '../patients/patients.service.js';

interface Analyzed {
  ignoredColumns: string[];
  lines: (PatientImportLineDto & { input: PatientCreateInput | null })[];
}

/**
 * Importação de pacientes por planilha (docs/api/integracoes.md). Conferir não grava nada;
 * importar confere de novo e cadastra só as linhas prontas, pelo mesmo caminho do cadastro manual.
 * O arquivo não é guardado.
 */
@Injectable()
export class PatientImportService {
  constructor(
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async preview(ctx: AuthContext, csv: string): Promise<PatientImportResultDto> {
    return result(false, await this.analyze(ctx.user.organizationId, csv));
  }

  async commit(ctx: AuthContext, csv: string): Promise<PatientImportResultDto> {
    const analyzed = await this.analyze(ctx.user.organizationId, csv);
    for (const line of analyzed.lines) {
      if (line.status !== 'ready' || !line.input) continue;
      try {
        const patient = await this.patients.create(ctx.user.organizationId, ctx.user.id, {
          ...line.input,
          allowPossibleDuplicate: false,
        });
        line.status = 'created';
        line.patientId = patient.id;
        await this.audit.record(ctx, {
          action: 'create',
          resourceType: 'patient_registration',
          resourceId: patient.id,
          patientId: patient.id,
          outcome: 'allowed',
          reason: 'patient_imported',
        });
      } catch (error) {
        // Outro cadastro com o mesmo CPF ou parecido entrou entre a conferência e a gravação.
        if (error instanceof AppError && error.getStatus() === 409) {
          line.status = 'duplicate';
          line.messages = [error.publicMessage];
        } else throw error;
      }
    }
    const done = result(true, analyzed);
    await this.audit.record(ctx, {
      action: 'create',
      resourceType: 'patient_import',
      outcome: 'allowed',
      reason:
        `patient_import:created=${done.totals.created},` +
        `error=${done.totals.error},duplicate=${done.totals.duplicate}`,
    });
    return done;
  }

  private async analyze(organizationId: string, csv: string): Promise<Analyzed> {
    const prepared = prepareImport(csv);
    if (!prepared.ok) throw new AppError(400, ErrorCode.VALIDATION_FAILED, prepared.message);
    const seen = new Map<string, number>();
    const lines: Analyzed['lines'] = [];
    for (const row of prepared.rows) {
      const { input, messages } = importRow(row.values);
      const line = {
        line: row.line,
        name: row.values.nome ?? '',
        status: 'error' as PatientImportLineDto['status'],
        messages,
        patientId: null,
        input,
      };
      lines.push(line);
      if (!input) continue;
      const repeated = importIdentityKeys(input)
        .map((k) => seen.get(k))
        .find((n) => n !== undefined);
      if (repeated !== undefined) {
        line.status = 'duplicate';
        line.messages = [`Repete o paciente da linha ${repeated} deste arquivo.`];
        continue;
      }
      for (const k of importIdentityKeys(input)) seen.set(k, row.line);
      if (input.cpf && (await this.patients.cpfOwner(organizationId, input.cpf))) {
        line.status = 'duplicate';
        line.messages = ['CPF já cadastrado.'];
        continue;
      }
      const similar = await this.patients.findSimilar(organizationId, {
        fullName: input.fullName,
        birthDate: input.birthDate,
        phones: input.phones.map((p) => p.number),
      });
      if (similar.length > 0) {
        line.status = 'duplicate';
        line.messages = [
          `Parecido com ${similar.length} cadastro(s) existente(s): mesmo nome e nascimento ou mesmo telefone.`,
        ];
        continue;
      }
      line.status = 'ready';
    }
    return { ignoredColumns: prepared.ignoredColumns, lines };
  }
}

function result(committed: boolean, analyzed: Analyzed): PatientImportResultDto {
  const totals = { ready: 0, error: 0, duplicate: 0, created: 0 };
  const lines = analyzed.lines.map(({ input: _input, ...line }) => {
    totals[line.status]++;
    return line;
  });
  return { committed, ignoredColumns: analyzed.ignoredColumns, totals, lines };
}
