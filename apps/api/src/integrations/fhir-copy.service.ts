/// <reference types="fhir" />
import { Inject, Injectable } from '@nestjs/common';
import type { AccessContext } from '@crm/policy';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthContext } from '../identity/session.service.js';
import { ClinicalCopyService } from '../records/clinical-copy.service.js';
import { toFhirBundle } from './fhir-copy.js';

type Bundle = fhir4.Bundle;

/** Cópia do prontuário no padrão FHIR R4: o mesmo conteúdo da cópia em JSON próprio. */
@Injectable()
export class FhirCopyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClinicalCopyService) private readonly copies: ClinicalCopyService,
  ) {}

  async build(ctx: AuthContext, patientId: string, context: AccessContext): Promise<Bundle> {
    const copy = await this.copies.build(ctx, patientId, context);
    const authorIds = [
      ...new Set([...copy.records, ...copy.documents].map((item) => item.author.id)),
    ];
    const professionals = await this.prisma.professional.findMany({
      where: { organizationId: ctx.user.organizationId, userId: { in: authorIds } },
      select: { userId: true, crmNumber: true, crmState: true },
    });
    const crm = new Map(
      professionals.map((p) => [p.userId, { number: p.crmNumber, state: p.crmState }]),
    );
    return toFhirBundle(copy, crm);
  }
}
