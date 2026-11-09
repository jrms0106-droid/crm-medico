import { describe, expect, it } from 'vitest';
import { niceTicks } from './chart.js';

describe('niceTicks', () => {
  it('cobre do menor ao maior valor com passos redondos', () => {
    expect(niceTicks(80, 142)).toEqual([80, 100, 120, 140, 160]);
    expect(niceTicks(96, 132)).toEqual([90, 100, 110, 120, 130, 140]);
  });

  it('com valores iguais, ainda tem duas marcas', () => {
    expect(niceTicks(58, 58)).toEqual([58, 59]);
  });
});
