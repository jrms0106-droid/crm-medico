import { Inject, Injectable } from '@nestjs/common';
import type { AccessContext } from '@crm/policy';
import type { ClinicalCopyDto } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { AuthContext } from '../identity/session.service.js';
import { RecordsService } from './records.service.js';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cópia do prontuário pedida pelo paciente (docs/api/direitos-do-titular.md). Leva os registros e
 * documentos assinados que o médico pode ler sem justificativa; o resto é contado e fica de fora.
 */
@Injectable()
export class ClinicalCopyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(RecordsService) private readonly records: RecordsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  async build(
    ctx: AuthContext,
    patientId: string,
    context: AccessContext,
  ): Promise<ClinicalCopyDto> {
    const organizationId = ctx.user.organizationId;
    // A cópia nunca usa o acesso emergencial nem justificativa: só o que o vínculo libera.
    const plain: AccessContext = { ...context, emergencyAccess: false, justified: false };
    const [org, patient, recordRows, documentRows] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.patient.findFirstOrThrow({
        where: { id: patientId, organizationId },
        select: { id: true, fullName: true, socialName: true, birthDate: true },
      }),
      this.prisma.clinicalRecord.findMany({
        where: { organizationId, patientId, signedAt: { not: null }, status: { not: 'discarded' } },
        orderBy: [{ clinicalDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.medicalDocument.findMany({
        where: { organizationId, patientId, status: { in: ['signed', 'cancelled'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const records = recordRows.filter(
      (r) =>
        this.authz.check(
          ctx,
          'view',
          {
            type: 'clinical_record',
            id: r.id,
            patientId,
            authorUserId: r.authorUserId,
            sensitivity: r.sensitivity,
          },
          plain,
        ).allowed,
    );
    const documents = documentRows.filter(
      (d) =>
        this.authz.check(
          ctx,
          'view',
          { type: 'medical_document', id: d.id, patientId, authorUserId: d.authorUserId },
          plain,
        ).allowed,
    );
    const withheldRecords = recordRows.length - records.length;
    const withheldDocuments = documentRows.length - documents.length;
    const withheld = withheldRecords + withheldDocuments > 0;

    return {
      format: 'crm-medico/copia-do-prontuario',
      version: 1,
      generatedAt: this.clock.now().toISOString(),
      generatedBy: { id: ctx.user.id, name: ctx.user.name },
      organization: { name: org.name },
      patient: {
        id: patient.id,
        name: patient.socialName ?? patient.fullName,
        birthDate: dateOnly(patient.birthDate),
      },
      notice:
        'Cópia dos registros e documentos médicos assinados, gerada a pedido do paciente. ' +
        'Contém dados de saúde: entregue só ao paciente ou ao seu representante legal.',
      records: await Promise.all(records.map((r) => this.records.dto(r))),
      documents: await Promise.all(documents.map((d) => this.documents.dto(d))),
      withheld: {
        records: withheldRecords,
        documents: withheldDocuments,
        reason: withheld
          ? 'Há registros sensíveis de outros profissionais que esta cópia não inclui. ' +
            'Peça ao profissional autor ou ao diretor técnico.'
          : null,
      },
    };
  }
}
