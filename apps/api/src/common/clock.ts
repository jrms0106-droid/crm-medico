/** Fonte de tempo injetável, para que os testes possam simular a passagem do tempo. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
