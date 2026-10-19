import { describe, expect, it } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthContext, SessionService } from '../identity/session.service.js';
import { AuthorizationService } from './authorization.service.js';

const ctx = {
  user: { id: 'u1', organizationId: 'org-1', roles: ['admin'] },
  session: { id: 's1' },
  unitIds: [],
  request: { requestId: 'r1' },
} as unknown as AuthContext;

const sessions = {} as SessionService;

describe('AuthorizationService', () => {
  it('se a auditoria falhar, nega a operação mesmo quando a política permitiria', async () => {
    const failingAudit = {
      record: () => Promise.reject(new Error('banco indisponível')),
    } as unknown as AuditService;
    const authz = new AuthorizationService(failingAudit, sessions);
    await expect(authz.authorize(ctx, 'view', { type: 'audit_event' })).rejects.toThrow(
      'banco indisponível',
    );
  });

  it('audita a negação antes de responder 403', async () => {
    const recorded: unknown[] = [];
    const audit = {
      record: (_: unknown, entry: unknown) => {
        recorded.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditService;
    const authz = new AuthorizationService(audit, sessions);
    await expect(authz.authorize(ctx, 'view', { type: 'clinical_record' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(recorded).toEqual([
      expect.objectContaining({ outcome: 'denied', reason: 'clinical_requires_doctor' }),
    ]);
  });
});
