import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config.js';

export const SESSION_COOKIE = 'crm_session';

function options(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api',
  };
}

/** O cookie vive o mesmo tempo que a validade absoluta da sessão (o servidor confere de novo). */
export function setSessionCookie(
  res: Response,
  config: AppConfig,
  token: string,
  maxAgeMs: number,
) {
  res.cookie(SESSION_COOKIE, token, { ...options(config), maxAge: maxAgeMs });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(SESSION_COOKIE, options(config));
}
