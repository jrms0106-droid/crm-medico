import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  type MfaSetupResponse,
  type SessionInfo,
  changePasswordRequestSchema,
  loginRequestSchema,
  mfaCodeRequestSchema,
  reauthRequestSchema,
} from '@crm/shared';
import type { Request, Response } from 'express';
import { parseBody } from '../common/validation.js';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { AllowStates, Auth, Public } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookie, setSessionCookie } from './cookies.js';
import { type AuthContext, SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionInfo> {
    const { email, password } = parseBody(loginRequestSchema, body);
    const result = await this.auth.login(email, password, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    setSessionCookie(
      res,
      this.config,
      result.token,
      result.session.expiresAt.getTime() - result.session.lastSeenAt.getTime(),
    );
    return this.sessions.toInfo(result);
  }

  @AllowStates('pending_mfa', 'password_change_required', 'active')
  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(ctx.session.id);
    clearSessionCookie(res, this.config);
  }

  @AllowStates('pending_mfa', 'password_change_required', 'active')
  @Get('me')
  me(@Auth() ctx: AuthContext): SessionInfo {
    return this.sessions.toInfo(ctx);
  }

  @AllowStates('pending_mfa', 'active')
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@Auth() ctx: AuthContext): Promise<MfaSetupResponse> {
    return this.auth.setupMfa(ctx);
  }

  @AllowStates('pending_mfa', 'active')
  @Post('mfa/activate')
  @HttpCode(200)
  async activateMfa(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<SessionInfo> {
    const { code } = parseBody(mfaCodeRequestSchema, body);
    return this.sessions.toInfo(await this.auth.activateMfa(ctx, code));
  }

  @AllowStates('pending_mfa')
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<SessionInfo> {
    const { code } = parseBody(mfaCodeRequestSchema, body);
    return this.sessions.toInfo(await this.auth.verifyMfa(ctx, code));
  }

  @AllowStates('password_change_required', 'active')
  @Post('password')
  @HttpCode(200)
  async changePassword(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<SessionInfo> {
    const { currentPassword, newPassword } = parseBody(changePasswordRequestSchema, body);
    return this.sessions.toInfo(await this.auth.changePassword(ctx, currentPassword, newPassword));
  }

  @Post('reauth')
  @HttpCode(204)
  async reauth(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<void> {
    const { password, code } = parseBody(reauthRequestSchema, body);
    await this.auth.reauthenticate(ctx, password, code);
  }
}
