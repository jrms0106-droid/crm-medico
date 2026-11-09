/** Marcas "redondas" do eixo vertical: de 1, 2, 5 ou 10 em 10, cobrindo do menor ao maior valor. */
export function niceTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 4);
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Vai até a primeira marca que cobre o maior valor, para nenhum ponto ficar acima da grade.
  for (let v = start; ; v += step) {
    ticks.push(Math.round(v * 100) / 100);
    if (v >= max) break;
  }
  // Valores todos iguais: uma marca a mais, para a linha não colar no chão do gráfico.
  if (ticks.length < 2) ticks.push(Math.round((start + step) * 100) / 100);
  return ticks;
}

export interface ChartCursor {
  /** Índice da série no gráfico. */
  s: number;
  /** Índice do ponto dentro da série. */
  i: number;
}

export type ChartKeyName = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * Para onde vai o foco ao apertar uma tecla de navegação num gráfico. `xs` tem a posição
 * horizontal de cada ponto, série por série. Esquerda/direita andam na mesma série; cima/baixo
 * trocam de série e caem no ponto mais próximo na horizontal. Nunca sai dos limites.
 */
export function moveCursor(xs: number[][], cur: ChartCursor, key: ChartKeyName): ChartCursor {
  const here = xs[cur.s];
  if (!here || here.length === 0) return cur;
  const last = here.length - 1;
  switch (key) {
    case 'ArrowLeft':
      return { s: cur.s, i: Math.max(0, cur.i - 1) };
    case 'ArrowRight':
      return { s: cur.s, i: Math.min(last, cur.i + 1) };
    case 'Home':
      return { s: cur.s, i: 0 };
    case 'End':
      return { s: cur.s, i: last };
    case 'ArrowUp':
    case 'ArrowDown': {
      const target = cur.s + (key === 'ArrowDown' ? 1 : -1);
      const there = xs[target];
      if (!there || there.length === 0) return cur;
      const x = here[cur.i] ?? 0;
      let best = 0;
      there.forEach((tx, i) => {
        if (Math.abs(tx - x) < Math.abs((there[best] ?? 0) - x)) best = i;
      });
      return { s: target, i: best };
    }
  }
}
