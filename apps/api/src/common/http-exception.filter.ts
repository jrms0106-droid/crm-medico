import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ErrorResponse } from '@crm/shared';
import type { Response } from 'express';
import { AppError } from './app-error.js';
import { safeErrorSummary } from './safe-error.js';

const CODE_BY_STATUS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.VALIDATION_FAILED, message: 'Dados inválidos.' },
  401: { code: ErrorCode.UNAUTHENTICATED, message: 'É preciso entrar no sistema.' },
  403: { code: ErrorCode.FORBIDDEN, message: 'Você não tem permissão para esta operação.' },
  404: { code: ErrorCode.NOT_FOUND, message: 'Não encontrado.' },
  409: { code: ErrorCode.CONFLICT, message: 'Conflito com o estado atual do registro.' },
  422: { code: ErrorCode.BUSINESS_RULE_VIOLATION, message: 'Operação não permitida pelas regras.' },
  429: { code: ErrorCode.RATE_LIMITED, message: 'Muitas tentativas. Aguarde e tente novamente.' },
  503: { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'Serviço temporariamente indisponível.' },
};

const INTERNAL = { code: ErrorCode.INTERNAL_ERROR, message: 'Erro interno. A equipe foi avisada.' };

/**
 * Converte qualquer erro no formato único da API (docs/planejamento/03-arquitetura.md, seção 3).
 * Erros inesperados nunca expõem detalhes internos ao cliente.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = String(res.locals['requestId'] ?? 'unknown');

    if (exception instanceof AppError) {
      const body: ErrorResponse = {
        error: {
          code: exception.code,
          message: exception.publicMessage,
          requestId,
          details: exception.details,
        },
      };
      res.status(exception.getStatus()).json(body);
      return;
    }

    if (isUniqueViolation(exception)) {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.CONFLICT,
          message: 'Já existe um registro com esses dados.',
          requestId,
          details: [],
        },
      };
      res.status(409).json(body);
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const mapped = CODE_BY_STATUS[status] ?? INTERNAL;

    if (status >= 500) {
      // Só o tipo, o código e onde ocorreu: a mensagem pode conter dados (ver safe-error.ts).
      this.logger.error(`requestId=${requestId}`, safeErrorSummary(exception));
    }

    const body: ErrorResponse = {
      error: { code: mapped.code, message: mapped.message, requestId, details: [] },
    };
    res.status(status).json(body);
  }
}

/** Violação de unicidade do banco (código P2002 do Prisma), tratada como conflito. */
function isUniqueViolation(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { code?: unknown }).code === 'P2002'
  );
}
