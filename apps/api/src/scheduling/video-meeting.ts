import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface MeetingRequest {
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Adaptador da sala de vídeo da teleconsulta (ADR 0043). Trocar de fornecedor (Google Meet pela
 * API do Calendar, por exemplo) é trocar esta classe; a regra de quando criar a sala fica na
 * agenda. O pedido não leva nome nem dado do paciente: o fornecedor só recebe horários.
 */
export abstract class VideoMeetingProvider {
  /** Devolve o endereço da sala. Lança erro se o fornecedor recusar. */
  abstract createMeeting(request: MeetingRequest): Promise<string>;
}

const LETTERS = 'abcdefghijkmnopqrstuvwxyz';
const part = (size: number) =>
  Array.from({ length: size }, () => LETTERS[randomInt(LETTERS.length)]).join('');

/**
 * Sala simulada: endereço no domínio reservado `.invalid`, que não abre em lugar nenhum. Único
 * adaptador até a clínica contratar e autorizar um fornecedor de vídeo.
 */
@Injectable()
export class SimulatedVideoMeeting extends VideoMeetingProvider {
  createMeeting(_request: MeetingRequest): Promise<string> {
    return Promise.resolve(`https://meet.simulado.invalid/${part(3)}-${part(4)}-${part(3)}`);
  }
}
