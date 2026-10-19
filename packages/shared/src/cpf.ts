/**
 * Validação de CPF pelos dígitos verificadores (algoritmo público da Receita Federal).
 * Não consulta nenhuma base externa: confirma apenas que o número é bem formado.
 */
export function normalizeCpf(input: string): string {
  return input.replace(/\D/g, '');
}

export function isValidCpf(input: string): boolean {
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += (digits[i] ?? 0) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}

export function formatCpf(input: string): string {
  const cpf = normalizeCpf(input);
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}
