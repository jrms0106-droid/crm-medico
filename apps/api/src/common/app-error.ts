import { HttpException } from '@nestjs/common';
import type { ErrorCode, ErrorDetail } from '@crm/shared';

/** Erro de negócio com código estável, convertido pelo filtro global no formato padrão da API. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    readonly publicMessage: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(publicMessage, status);
  }
}
