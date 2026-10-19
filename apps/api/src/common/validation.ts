import { ErrorCode } from '@crm/shared';
import type { z } from 'zod';
import { AppError } from './app-error.js';

/** Valida o corpo da requisição; campos inválidos voltam um a um em `details`. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new AppError(
    400,
    ErrorCode.VALIDATION_FAILED,
    'Dados inválidos.',
    result.error.issues.map((i) => ({ field: i.path.join('.') || undefined, issue: i.message })),
  );
}
