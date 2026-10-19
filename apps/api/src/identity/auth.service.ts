import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type MfaSetupResponse, passwordProblem } from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Session, User } from '../generated/prisma/client.js';
import { SecretBox } from './crypto.js';
import { burnPasswordCheck, hashPassword, temporaryPassword, verifyPassword } from './password.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import { type AuthContext, SessionService } from './session.service.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

const MINUTE = 60_000;
const MFA_ISSUER = 'CRM Médico';

const invalidCredentials = () =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha incorretos.');
const invalidMfaCode = () =>
  new AppError(400, ErrorCode.INVALID_MFA_CODE, 'Código inválido ou já utilizado.');

@Injectable()
export class AuthService {
  private readonly secretBox: SecretBox;
  private readonly loginLimiter: FixedWindowRateLimiter;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.secretBox = new SecretBox(config.MFA_ENCRYPTION_KEY);
    this.loginLimiter = new FixedWindowRateLimiter(config.LOGIN_RATE_LIMIT_PER_MINUTE, MINUTE);
  }

  async login(
    email: string,
    password: string,
    meta: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ token: string; user: User; session: Session }> {
    const now = this.clock.now();
    if (!this.loginLimiter.consume(meta.ip ?? 'desconhecido', now.getTime())) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        'Muitas tentativas. Aguarde e tente novamente.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      await burnPasswordCheck(password);
      throw invalidCredentials();
    }
    this.assertNotLocked(user);

    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.registerFailure(user);
      throw invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    const { token, session } = await this.sessions.create(user, meta);
    return { token, user, session };
  }

  /** Gera (ou regenera, enquanto não ativado) o segredo TOTP do usuário. */
  async setupMfa(ctx: AuthContext): Promise<MfaSetupResponse> {
    if (ctx.user.mfaEnabled) {
      throw new AppError(409, ErrorCode.CONFLICT, 'A verificação em duas etapas já está ativa.');
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: ctx.user.id },
      data: { mfaSecretEnc: this.secretBox.encrypt(secret), mfaLastStep: null },
    });
    return { secret, otpauthUri: otpauthUri(secret, ctx.user.email, MFA_ISSUER) };
  }

  async activateMfa(ctx: AuthContext, code: string): Promise<{ user: User; session: Session }> {
    if (ctx.user.mfaEnabled) {
      throw new AppError(409, ErrorCode.CONFLICT, 'A verificação em duas etapas já está ativa.');
    }
    if (!ctx.user.mfaSecretEnc) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Gere o código de configuração primeiro.');
    }
    const step = await this.checkTotp(ctx.user, code);
    const user = await this.prisma.user.update({
      where: { id: ctx.user.id },
      data: { mfaEnabled: true, mfaLastStep: BigInt(step), failedLoginCount: 0 },
    });
    const session = await this.prisma.session.update({
      where: { id: ctx.session.id },
      data: { mfaVerified: true },
    });
    return { user, session };
  }

  async verifyMfa(ctx: AuthContext, code: string): Promise<{ user: User; session: Session }> {
    if (!ctx.user.mfaEnabled) {
      throw new AppError(
        403,
        ErrorCode.MFA_SETUP_REQUIRED,
        'Configure a verificação em duas etapas.',
      );
    }
    const step = await this.checkTotp(ctx.user, code);
    const user = await this.prisma.user.update({
      where: { id: ctx.user.id },
      data: { mfaLastStep: BigInt(step), failedLoginCount: 0 },
    });
    const session = await this.prisma.session.update({
      where: { id: ctx.session.id },
      data: { mfaVerified: true },
    });
    return { user, session };
  }

  async changePassword(
    ctx: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ user: User; session: Session }> {
    if (!(await verifyPassword(ctx.user.passwordHash, currentPassword))) {
      await this.registerFailure(ctx.user);
      throw invalidCredentials();
    }
    this.assertStrongPassword(newPassword, ctx.user.email);
    if (await verifyPassword(ctx.user.passwordHash, newPassword)) {
      throw new AppError(
        400,
        ErrorCode.WEAK_PASSWORD,
        'A nova senha precisa ser diferente da atual.',
      );
    }
    const user = await this.prisma.user.update({
      where: { id: ctx.user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    await this.sessions.revokeAllForUser(user.id, ctx.session.id);
    return { user, session: ctx.session };
  }

  /** Confirma a identidade de novo antes de ações críticas (assinar, exportar etc.). */
  async reauthenticate(ctx: AuthContext, password: string, code?: string): Promise<void> {
    if (!(await verifyPassword(ctx.user.passwordHash, password))) {
      await this.registerFailure(ctx.user);
      throw invalidCredentials();
    }
    if (ctx.user.mfaEnabled) {
      if (!code) throw invalidMfaCode();
      const step = await this.checkTotp(ctx.user, code);
      await this.prisma.user.update({
        where: { id: ctx.user.id },
        data: { mfaLastStep: BigInt(step) },
      });
    }
    await this.prisma.session.update({
      where: { id: ctx.session.id },
      data: { reauthAt: this.clock.now() },
    });
  }

  /**
   * Recuperação de acesso feita por administrador: senha temporária (exibida uma única vez),
   * troca obrigatória no próximo login, MFA apagado para novo cadastro e todas as sessões revogadas.
   */
  async resetAccess(targetUserId: string): Promise<string> {
    const password = temporaryPassword(randomBytes);
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaLastStep: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.sessions.revokeAllForUser(targetUserId);
    return password;
  }

  async deactivate(targetUserId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: targetUserId }, data: { active: false } });
    await this.sessions.revokeAllForUser(targetUserId);
  }

  assertStrongPassword(password: string, email: string): void {
    const problem = passwordProblem(password, email);
    if (problem) throw new AppError(400, ErrorCode.WEAK_PASSWORD, problem);
  }

  private async checkTotp(user: User, code: string): Promise<number> {
    this.assertNotLocked(user);
    if (!user.mfaSecretEnc) throw invalidMfaCode();
    const secret = this.secretBox.decrypt(user.mfaSecretEnc);
    const last = user.mfaLastStep === null ? null : Number(user.mfaLastStep);
    const step = verifyTotp(secret, code, this.clock.now(), last);
    if (step === null) {
      await this.registerFailure(user);
      throw invalidMfaCode();
    }
    return step;
  }

  private assertNotLocked(user: User): void {
    if (user.lockedUntil && user.lockedUntil > this.clock.now()) {
      throw new AppError(
        423,
        ErrorCode.ACCOUNT_LOCKED,
        'Conta bloqueada temporariamente por excesso de tentativas. Tente mais tarde ou procure o administrador.',
      );
    }
  }

  /** Conta a falha de forma atômica e bloqueia a conta ao atingir o limite. */
  private async registerFailure(user: User): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= this.config.LOGIN_MAX_FAILURES) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(
            this.clock.now().getTime() + this.config.LOGIN_LOCK_MINUTES * MINUTE,
          ),
        },
      });
      await this.sessions.revokeAllForUser(user.id);
    }
  }
}
