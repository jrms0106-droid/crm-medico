import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface PrescriptionRequest {
  prescriber: { name: string; crm: string };
  patient: { fullName: string; birthDate: string };
  items: { medication: string; instructions: string }[];
}

export interface IssuedPrescription {
  /** Código que a plataforma mostra no documento. */
  validationCode: string;
}

/**
 * Adaptador de prescrição digital (ADR 0045). Trocar de fornecedor (a Memed, por exemplo) é
 * trocar esta classe. O pedido leva só o necessário para a receita: o prescritor, o nome e a
 * data de nascimento do paciente e os itens. Nada de CPF, telefone ou histórico.
 */
export abstract class PrescriptionProvider {
  /** Emite a receita e devolve o código. Lança erro se o fornecedor recusar. */
  abstract issue(request: PrescriptionRequest): Promise<IssuedPrescription>;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = (size: number) =>
  Array.from({ length: size }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * Emissão simulada: gera um código com prefixo `SIMULADO` e não sai nada do sistema. Único
 * adaptador até a clínica contratar e autorizar um fornecedor.
 */
@Injectable()
export class SimulatedPrescriptionProvider extends PrescriptionProvider {
  issue(_request: PrescriptionRequest): Promise<IssuedPrescription> {
    return Promise.resolve({ validationCode: `SIMULADO-${block(4)}-${block(4)}` });
  }
}
