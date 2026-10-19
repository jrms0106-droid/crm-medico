import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const VALID = /^[A-Za-z0-9-]{8,64}$/;

/** Cada requisição recebe um identificador, devolvido no cabeçalho e nas respostas de erro. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const id = incoming && VALID.test(incoming) ? incoming : randomUUID();
  res.locals['requestId'] = id;
  res.setHeader(HEADER, id);
  next();
}
