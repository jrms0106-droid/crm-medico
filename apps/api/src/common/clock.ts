/** Fonte de tempo injetável, para que os testes possam simular a passagem do tempo. */
export abstract class Clock {
  abstract now(): Date;
}

/**
 * Relógio do sistema. O deslocamento (em milissegundos) só existe para os testes no navegador
 * rodarem sempre no mesmo horário do dia; `loadConfig` recusa deslocamento em produção.
 */
export class SystemClock extends Clock {
  constructor(private readonly offsetMs = 0) {
    super();
  }

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}
