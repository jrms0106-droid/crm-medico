import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface QualifiedSignatureRequest {
  documentId: string;
  /** Resumo SHA-256 calculado na assinatura interna. */
  contentHash: string;
  signer: { name: string; crm: string };
}

export interface QualifiedSignatureResult {
  /** Nome do fornecedor gravado no banco. */
  provider: string;
  /** Código que o fornecedor devolve para conferir a assinatura. */
  reference: string;
  simulated: boolean;
}

/**
 * Adaptador de assinatura ICP-Brasil em nuvem (ADR 0046). Trocar de fornecedor é trocar esta
 * classe. O pedido leva só o identificador do documento, o resumo e o signatário: nada de
 * conteúdo clínico nem dados do paciente.
 */
export abstract class QualifiedSignatureProvider {
  /** Assina e devolve o código. Lança erro se o fornecedor recusar. */
  abstract sign(request: QualifiedSignatureRequest): Promise<QualifiedSignatureResult>;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = (size: number) =>
  Array.from({ length: size }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * Assinatura simulada: gera um código com prefixo `SIMULADO` e não sai nada do sistema. Único
 * adaptador até a clínica contratar e autorizar um serviço de assinatura.
 */
@Injectable()
export class SimulatedQualifiedSignatureProvider extends QualifiedSignatureProvider {
  sign(_request: QualifiedSignatureRequest): Promise<QualifiedSignatureResult> {
    return Promise.resolve({
      provider: 'simulado',
      reference: `SIMULADO-${block(4)}-${block(4)}`,
      simulated: true,
    });
  }
}
