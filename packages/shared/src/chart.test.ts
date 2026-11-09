import { describe, expect, it } from 'vitest';
import { moveCursor, niceTicks } from './chart.js';

describe('niceTicks', () => {
  it('cobre do menor ao maior valor com passos redondos', () => {
    expect(niceTicks(80, 142)).toEqual([80, 100, 120, 140, 160]);
    expect(niceTicks(96, 132)).toEqual([90, 100, 110, 120, 130, 140]);
  });

  it('com valores iguais, ainda tem duas marcas', () => {
    expect(niceTicks(58, 58)).toEqual([58, 59]);
  });
});

describe('moveCursor', () => {
  const xs = [
    [40, 100, 200],
    [40, 200],
  ];

  it('anda para os lados na mesma série, sem sair dos limites', () => {
    expect(moveCursor(xs, { s: 0, i: 1 }, 'ArrowRight')).toEqual({ s: 0, i: 2 });
    expect(moveCursor(xs, { s: 0, i: 2 }, 'ArrowRight')).toEqual({ s: 0, i: 2 });
    expect(moveCursor(xs, { s: 0, i: 0 }, 'ArrowLeft')).toEqual({ s: 0, i: 0 });
    expect(moveCursor(xs, { s: 0, i: 1 }, 'Home')).toEqual({ s: 0, i: 0 });
    expect(moveCursor(xs, { s: 0, i: 1 }, 'End')).toEqual({ s: 0, i: 2 });
  });

  it('troca de série caindo no ponto mais próximo na horizontal', () => {
    expect(moveCursor(xs, { s: 0, i: 1 }, 'ArrowDown')).toEqual({ s: 1, i: 0 });
    expect(moveCursor(xs, { s: 0, i: 2 }, 'ArrowDown')).toEqual({ s: 1, i: 1 });
    expect(moveCursor(xs, { s: 1, i: 1 }, 'ArrowUp')).toEqual({ s: 0, i: 2 });
    expect(moveCursor(xs, { s: 0, i: 0 }, 'ArrowUp')).toEqual({ s: 0, i: 0 });
    expect(moveCursor(xs, { s: 1, i: 0 }, 'ArrowDown')).toEqual({ s: 1, i: 0 });
  });
});
