import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type RoleName, type SessionInfo, type SessionState } from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Session, User } from '../generated/prisma/client.js';
import { randomToken, sha256Hex } from './crypto.js';

export interface AuthContext {
  session: Session;
  user: User;
  state: SessionState;
}

const MINUTE = 60_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  mfaRequiredFor(user: Pick<User, 'roles' | 'mfaEnabled'>): boolean {
    return (
      user.mfaEnabled ||
      user.roles.some((r) => this.config.MFA_REQUIRED_ROLES.includes(r as RoleName))
    );
  }

  stateOf(user: User, session: Session): SessionState {
    if (!session.mfaVerified && this.mfaRequiredFor(user)) return 'pending_mfa';
    if (user.mustChangePassword) return 'password_change_required';
    return 'active';
  }

  /** Cria uma sessão e devolve o token em claro (só vai para o cookie; o banco guarda o hash). */
  async create(
    user: User,
    meta: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ token: string; session: Session }> {
    const now = this.clock.now();
    const token = randomToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        csrfToken: randomToken(24),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.config.SESSION_ABSOLUTE_HOURS * 60 * MINUTE),
        ip: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 400),
      },
    });
    return { token, session };
  }

  /**
   * Encontra a sessão do token e confere validade (revogada, expirada, inativa, usuário desativado).
   * Renova o "último uso". Lança 401 em qualquer problema.
   */
  async resolve(token: string): Promise<AuthContext> {
    const now = this.clock.now();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    const expired = () =>
      new AppError(401, ErrorCode.SESSION_EXPIRED, 'Sua sessão terminou. Entre novamente.');

    if (!session || session.revokedAt || !session.user.active) throw expired();
    const idleLimit = session.lastSeenAt.getTime() + this.config.SESSION_IDLE_MINUTES * MINUTE;
    if (now >= session.expiresAt || now.getTime() >= idleLimit) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
      throw expired();
    }

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
    const { user } = session;
    return { session: updated, user, state: this.stateOf(user, updated) };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  hasRecentReauth(session: Session): boolean {
    if (!session.reauthAt) return false;
    const limit = session.reauthAt.getTime() + this.config.REAUTH_VALID_MINUTES * MINUTE;
    return this.clock.now().getTime() < limit;
  }

  toInfo(ctx: { user: User; session: Session }): SessionInfo {
    const { user, session } = ctx;
    return {
      user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
      state: this.stateOf(user, session),
      mfaEnabled: user.mfaEnabled,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
