import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { AuthorizationService } from './authz/authorization.service.js';
import { CareController } from './care/care.controller.js';
import { CareService } from './care/care.service.js';
import { Clock, SystemClock } from './common/clock.js';
import { APP_CONFIG } from './config.tokens.js';
import type { AppConfig } from './config.js';
import { PrismaService } from './database/prisma.service.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { HealthController } from './health/health.controller.js';
import { AdminUsersController } from './identity/admin-users.controller.js';
import { AuthController } from './identity/auth.controller.js';
import { AuthGuard } from './identity/auth.guard.js';
import { AuthService } from './identity/auth.service.js';
import { SessionService } from './identity/session.service.js';
import { UserAdminService } from './identity/user-admin.service.js';
import { OrgService } from './org/org.service.js';
import { PatientsController } from './patients/patients.controller.js';
import { PatientsService } from './patients/patients.service.js';
import { PrivacyController } from './privacy/privacy.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { CrmController } from './crm/crm.controller.js';
import { MessageSender, SimulatedSender } from './crm/message-sender.js';
import { RemindersRunner } from './crm/reminders.runner.js';
import { RemindersService } from './crm/reminders.service.js';
import { FhirCopyService } from './integrations/fhir-copy.service.js';
import { PatientImportService } from './integrations/patient-import.service.js';
import { RecordsController } from './records/records.controller.js';
import { ClinicalCopyService } from './records/clinical-copy.service.js';
import { RecordsService } from './records/records.service.js';
import {
  AppointmentsController,
  SchedulesController,
  UnitSchedulingController,
  WaitlistController,
} from './scheduling/scheduling.controller.js';
import { SchedulingService } from './scheduling/scheduling.service.js';
import { ProfessionalsController } from './org/professionals.controller.js';
import { SpecialtiesController } from './org/specialties.controller.js';
import { UnitsController } from './org/units.controller.js';

export interface AppOverrides {
  clock?: Clock;
  messageSender?: MessageSender;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        AdminUsersController,
        UnitsController,
        SpecialtiesController,
        ProfessionalsController,
        AuditController,
        PatientsController,
        UnitSchedulingController,
        SchedulesController,
        AppointmentsController,
        WaitlistController,
        CareController,
        RecordsController,
        DocumentsController,
        BillingController,
        PrivacyController,
        CrmController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
        { provide: PrismaService, useFactory: () => new PrismaService(config.DATABASE_URL) },
        SessionService,
        AuthService,
        AuditService,
        AuthorizationService,
        UserAdminService,
        OrgService,
        PatientsService,
        SchedulingService,
        CareService,
        RecordsService,
        ClinicalCopyService,
        FhirCopyService,
        PatientImportService,
        DocumentsService,
        BillingService,
        PrivacyService,
        RemindersService,
        RemindersRunner,
        { provide: MessageSender, useValue: overrides.messageSender ?? new SimulatedSender() },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
