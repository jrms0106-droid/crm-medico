/**
 * Resumo de um erro inesperado que pode ir para o registro (log) sem levar dados.
 *
 * A mensagem de um erro do banco pode trazer valores da consulta (nome, CPF, texto do
 * prontuário). Por isso o resumo guarda só o tipo do erro, o código (quando houver, como os
 * códigos P2xxx do Prisma ou SQLSTATE do PostgreSQL) e as linhas da pilha que dizem onde no
 * código o erro aconteceu. A primeira linha da pilha, que repete a mensagem, é descartada.
 */
export const MAX_STACK_FRAMES = 12;

const FRAME = /^\s*at\s/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;

export function safeErrorSummary(exception: unknown): string {
  if (!(exception instanceof Error)) return `tipo=${typeof exception}`;
  const parts = [`tipo=${safeName(exception)}`];
  const code = (exception as { code?: unknown }).code;
  if (typeof code === 'string' && SAFE_CODE.test(code)) parts.push(`codigo=${code}`);
  const stack = exception.stack ?? '';
  // A pilha começa com "Tipo: mensagem"; a mensagem pode ter várias linhas e é descartada inteira.
  const header = `${exception.name}: ${exception.message}`;
  const afterMessage = stack.startsWith(header) ? stack.slice(header.length) : stack;
  const frames = afterMessage
    .split('\n')
    .filter((line) => FRAME.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => `  ${line.trim()}`);
  return [parts.join(' '), ...frames].join('\n');
}

function safeName(error: Error): string {
  const name = error.constructor?.name || error.name;
  return SAFE_CODE.test(name) ? name : 'Error';
}
