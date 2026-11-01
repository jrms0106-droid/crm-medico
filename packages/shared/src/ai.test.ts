import { describe, expect, it } from 'vitest';
import { splitSentences } from './ai.js';

describe('divisão em frases', () => {
  it('divide por pontuação final, ponto e vírgula e quebra de linha, sem mudar o texto', () => {
    expect(
      splitSentences(
        'Dor há 3 dias. Nega febre!  Tosse seca?\n- PA 120x80 mmHg; FC 80 bpm\r\n\nRetorno.',
      ),
    ).toEqual([
      'Dor há 3 dias.',
      'Nega febre!',
      'Tosse seca?',
      '- PA 120x80 mmHg;',
      'FC 80 bpm',
      'Retorno.',
    ]);
  });

  it('não corta números decimais nem abreviações sem espaço depois', () => {
    expect(splitSentences('Temperatura 37.8 graus. Dipirona 1g.')).toEqual([
      'Temperatura 37.8 graus.',
      'Dipirona 1g.',
    ]);
  });

  it('texto vazio ou só espaços não gera frases', () => {
    expect(splitSentences('  \n\n ')).toEqual([]);
  });
});
