import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface OutgoingMessage {
  channel: string;
  toNumber: string;
  body: string;
}

/**
 * Adaptador de envio (docs/api/crm-e-lembretes.md). Trocar de fornecedor é trocar esta classe;
 * a regra de quem recebe e quando fica no serviço de lembretes.
 */
export abstract class MessageSender {
  /** Devolve o código do envio no fornecedor. Lança erro se o envio falhar. */
  abstract send(message: OutgoingMessage): Promise<string>;
}

/** Envio simulado: nenhuma mensagem sai do sistema. Único adaptador até haver serviço contratado. */
@Injectable()
export class SimulatedSender extends MessageSender {
  send(_message: OutgoingMessage): Promise<string> {
    return Promise.resolve(`simulado-${randomUUID()}`);
  }
}
