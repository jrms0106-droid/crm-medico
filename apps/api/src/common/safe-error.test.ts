import { HttpException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { MAX_STACK_FRAMES, safeErrorSummary } from './safe-error.js';

const SECRET = 'Maria Fictícia CPF 123.456.789-09';

class FakeDbError extends Error {
  code = 'P2003';
}

describe('resumo seguro de erro', () => {
  it('guarda tipo, código e linhas da pilha, sem a mensagem', () => {
    const error = new FakeDbError(
      `Falha ao gravar valor '${SECRET}'\n    at linha falsa ${SECRET}`,
    );
    const summary = safeErrorSummary(error);
    expect(summary).not.toContain('Maria');
    expect(summary).not.toContain('123.456');
    expect(summary).toMatch(/^tipo=FakeDbError codigo=P2003\n/);
    expect(summary).toMatch(/safe-error\.test\.ts:\d+/);
  });

  it('descarta código com formato estranho e limita a pilha', () => {
    const error = Object.assign(new Error(SECRET), { code: SECRET });
    const deep = (n: number): Error => (n === 0 ? error : deep(n - 1));
    const summary = safeErrorSummary(deep(30));
    expect(summary).not.toContain('codigo=');
    expect(summary.split('\n').length).toBeLessThanOrEqual(MAX_STACK_FRAMES + 1);
  });

  it('não expõe valores que não são Error', () => {
    expect(safeErrorSummary(SECRET)).toBe('tipo=string');
    expect(safeErrorSummary({ message: SECRET })).toBe('tipo=object');
  });
});

describe('filtro de erros da API', () => {
  const run = (exception: unknown) => {
    const json = vi.fn((_body: unknown) => undefined);
    const res = { locals: { requestId: 'req-1' }, status: vi.fn((_code: number) => ({ json })) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new HttpExceptionFilter().catch(exception, host as never);
    const calls = logged.mock.calls.map((c) => c.join(' '));
    logged.mockRestore();
    return { calls, status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
  };

  it('erro inesperado: registra sem a mensagem e responde genérico', () => {
    const { calls, status, body } = run(new FakeDbError(SECRET));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('Maria');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('requestId=req-1');
    expect(calls[0]).toContain('tipo=FakeDbError codigo=P2003');
    expect(calls[0]).not.toContain('Maria');
  });

  it('erro esperado (4xx) não vai para o registro de erros', () => {
    expect(run(new HttpException('x', 404)).calls).toHaveLength(0);
  });
});
