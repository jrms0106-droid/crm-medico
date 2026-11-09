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
