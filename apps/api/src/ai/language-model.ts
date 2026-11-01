import { Injectable } from '@nestjs/common';
import {
  type AdminReportMetrics,
  type AiFeature,
  type AiRecordField,
  type MessagePurpose,
  RECORD_SUMMARY_MAX_ITEMS,
  type RecordDraftOutput,
  type RecordSummaryOutput,
  SCHEDULE_SUGGESTIONS_MAX,
  type ScheduleSuggestionsOutput,
  type TriageCategory,
  type TriageOutput,
  formatCents,
  formatCount,
  formatPercent,
  normalizeSearch,
} from '@crm/shared';

export interface ModelInfo {
  provider: string;
  model: string;
  version: string;
}

/**
 * O que o gateway manda ao modelo. `system` e `prompt` são o texto que um fornecedor real
 * receberia; `fields` traz os mesmos dados já separados, para o modelo simulado.
 */
export interface ModelRequest {
  feature: AiFeature;
  system: string;
  prompt: string;
  fields: Readonly<Record<string, string>>;
}

/**
 * Adaptador de modelo de linguagem (ADR 0009). Nenhum módulo chama fornecedor diretamente; trocar
 * de fornecedor é trocar esta classe. A saída é sempre texto, conferido depois pelo gateway.
 */
export abstract class LanguageModel {
  abstract readonly info: ModelInfo;
  abstract complete(request: ModelRequest): Promise<string>;
}

const URGENT = [
  'dor no peito',
  'falta de ar',
  'nao consigo respirar',
  'dificuldade para respirar',
  'desmai',
  'sangrando',
  'sangramento',
  'convuls',
  'avc',
  'derrame',
  'me matar',
  'suicid',
  'me machucar',
  'tirar minha vida',
  'perdi a consciencia',
];

const CATEGORY_WORDS: [TriageCategory, string[]][] = [
  ['cancellation', ['cancel', 'desmarcar', 'nao vou poder ir', 'nao poderei ir']],
  [
    'reschedule',
    ['remarcar', 'reagendar', 'mudar o horario', 'trocar o horario', 'trocar o dia', 'adiar'],
  ],
  [
    'billing',
    ['pix', 'pagamento', 'pagar', 'recibo', 'nota fiscal', 'valor', 'preco', 'boleto', 'cartao'],
  ],
  ['documents', ['atestado', 'receita', 'laudo', 'relatorio', 'declaracao', 'copia do prontuario']],
  ['scheduling', ['marcar', 'agendar', 'horario disponivel', 'vaga', 'primeira consulta']],
  [
    'clinical',
    ['dor', 'febre', 'remedio', 'medicamento', 'sintoma', 'efeito colateral', 'tontura', 'enjoo'],
  ],
];

const REPLIES: Record<TriageCategory, string> = {
  scheduling:
    'Olá! Recebemos seu pedido para marcar uma consulta. Vamos verificar os horários disponíveis ' +
    'e retornamos em seguida com as opções.',
  reschedule:
    'Olá! Recebemos seu pedido para remarcar a consulta. Quais dias e horários ficam melhores ' +
    'para você?',
  cancellation:
    'Olá! Recebemos seu pedido de cancelamento. Vamos registrar e confirmamos por aqui. Se quiser ' +
    'marcar outra data, é só avisar.',
  billing:
    'Olá! Recebemos sua mensagem sobre pagamento. Vamos verificar e retornamos com as informações.',
  documents:
    'Olá! Recebemos seu pedido de documento. Vamos encaminhar ao profissional responsável e ' +
    'avisamos quando estiver pronto.',
  clinical:
    'Olá! Recebemos sua mensagem e vamos passá-la ao médico, que orientará você. Em caso de ' +
    'piora ou emergência, procure o pronto-socorro ou ligue 192.',
  other: 'Olá! Recebemos sua mensagem e retornamos em breve.',
};

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

/** Classificação por palavras-chave, no formato fixo de `triageOutputSchema`. */
export function simulatedTriage(message: string): TriageOutput {
  const text = ` ${normalizeSearch(message)} `;
  const urgent = has(text, URGENT);
  const category: TriageCategory = urgent
    ? 'clinical'
    : (CATEGORY_WORDS.find(([, words]) => has(text, words))?.[0] ?? 'other');
  return { category, urgent, suggestedReply: REPLIES[category] };
}

/** Rascunho por modelo de texto: só usa os dados recebidos, nunca inventa data, hora ou nome. */
export function simulatedDraft(f: Readonly<Record<string, string>>): string {
  const purpose = f['purpose'] as MessagePurpose;
  const hi = `Olá, ${f['firstName']}!`;
  const from = f['organization'] ? ` Aqui é da ${f['organization']}.` : '';
  const when = f['date'] ? `${f['date']} às ${f['time']}` : '';
  const withWhom = f['doctor'] ? ` com ${f['doctor']}` : '';
  const where = f['unit'] ? `, na ${f['unit']}` : '';
  const note = f['note'] ? ` ${f['note'].replace(/\s+$/, '')}` : '';
  const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  switch (purpose) {
    case 'confirmation':
      return (
        `${hi}${from} Sua consulta${withWhom} está marcada para ${when}${where}.${note && end(note)}` +
        ' Você confirma a presença? Se precisar remarcar, é só responder esta mensagem.'
      );
    case 'reschedule':
      return (
        `${hi}${from} Precisamos remarcar sua consulta${withWhom} de ${when}.${note && end(note)}` +
        ' Quais dias e horários ficam melhores para você?'
      );
    case 'no_show':
      return (
        `${hi}${from} Sentimos sua falta na consulta${withWhom} de ${when}.${note && end(note)}` +
        ' Se quiser marcar uma nova data, é só responder esta mensagem.'
      );
    case 'notice':
      return `${hi}${from}${note && end(note)}`;
  }
}

/** Fatos da agenda que o gateway manda ao modelo: códigos no lugar das pessoas. */
export interface ScheduleFacts {
  date: string;
  slots: { code: string; time: string; period: 'manhã' | 'tarde' | 'noite' }[];
  waitlist: {
    code: string;
    sameDoctor: boolean;
    waitingDays: number;
    preference: string | null;
  }[];
  unconfirmed: { code: string; time: string }[];
}

const PERIOD_WORDS: Record<ScheduleFacts['slots'][number]['period'], string> = {
  manhã: 'manha',
  tarde: 'tarde',
  noite: 'noite',
};

/** A preferência escrita na lista de espera aceita o período do horário? */
function prefers(preference: string | null, period: ScheduleFacts['slots'][number]['period']) {
  const p = normalizeSearch(preference ?? '');
  const named = Object.values(PERIOD_WORDS).filter((w) => p.includes(w));
  return named.length === 0 || named.includes(PERIOD_WORDS[period]);
}

/**
 * Sugestões por regra fixa: cada horário livre vai para quem espera há mais tempo, primeiro quem
 * pediu este médico, respeitando o período preferido; depois, as consultas a confirmar.
 */
export function simulatedSchedule(facts: ScheduleFacts): ScheduleSuggestionsOutput {
  const queue = [...facts.waitlist].sort(
    (a, b) => Number(b.sameDoctor) - Number(a.sameDoctor) || b.waitingDays - a.waitingDays,
  );
  const used = new Set<string>();
  const suggestions: ScheduleSuggestionsOutput['suggestions'] = [];
  for (const slot of facts.slots) {
    const entry = queue.find((e) => !used.has(e.code) && prefers(e.preference, slot.period));
    if (!entry) continue;
    used.add(entry.code);
    const who = entry.sameDoctor ? 'pediu este médico' : 'aceita qualquer médico';
    const pref = entry.preference ? ` e prefere: ${entry.preference}` : '';
    suggestions.push({
      kind: 'fill_slot',
      slot: slot.code,
      waitlist: entry.code,
      reason:
        `Horário livre (${slot.period}); a pessoa ${who}, espera há ${entry.waitingDays} dias${pref}`.slice(
          0,
          200,
        ),
    });
  }
  for (const a of facts.unconfirmed) {
    suggestions.push({
      kind: 'confirm',
      appointment: a.code,
      reason: 'Consulta ainda não confirmada: vale pedir a confirmação.',
    });
  }
  return { suggestions: suggestions.slice(0, SCHEDULE_SUGGESTIONS_MAX) };
}

/** Destaques por modelo de texto, usando só os números recebidos. */
export function simulatedReport(
  period: { from: string; to: string },
  m: AdminReportMetrics,
): string[] {
  const a = m.appointments;
  const n = formatCount;
  const out = [
    `De ${period.from} a ${period.to} foram ${n(a.total)} consultas na agenda: ` +
      `${n(a.arrived)} com o paciente presente, ${n(a.noShow)} faltas e ${n(a.cancelled)} cancelamentos.`,
  ];
  if (m.noShowRate !== null) {
    out.push(
      `A taxa de faltas foi de ${formatPercent(m.noShowRate)}%.` +
        (m.noShowRate >= 15 ? ' Vale reforçar a confirmação na véspera.' : ''),
    );
  }
  if (a.scheduled > 0) {
    out.push(`${n(a.scheduled)} consultas ainda estão sem confirmação.`);
  }
  out.push(
    `Lembretes: ${n(m.reminders.sent)} enviados e ${n(m.reminders.failed)} com falha.`,
    `Entraram ${n(m.newPatients)} pacientes novos e há ${n(m.waiting)} pessoas na lista de espera.`,
    `Financeiro particular: ${formatCents(m.billing.netCents)} cobrados, ` +
      `${formatCents(m.billing.receivedCents)} recebidos e ${formatCents(m.billing.openCents)} em aberto.`,
  );
  return out;
}

// ---- IA nível 2, documental (docs/api/ia-nivel-2.md) ----

/** Frases numeradas das anotações do médico. */
export interface RecordNotesFacts {
  sentences: { code: string; text: string }[];
}

/** Frases numeradas dos registros assinados, do mais recente (`R1`) para o mais antigo. */
export interface RecordSummaryFacts {
  records: {
    code: string;
    fields: Partial<Record<AiRecordField, { code: string; text: string }[]>>;
  }[];
}

const EXAM_WORDS = [
  'ao exame',
  'exame fisico',
  'pressao arterial',
  'pa ',
  'fc ',
  'fr ',
  'spo2',
  'saturacao',
  'temperatura',
  'ausculta',
  'abdome',
  'bpm',
  'mmhg',
  'irpm',
  'orofaringe',
  'otoscopia',
  'palpacao',
  'afebril',
  'corado',
  'hidratado',
  'eupneic',
];
const PLAN_WORDS = [
  'prescrevo',
  'prescrito',
  'receito',
  'oriento',
  'orientad',
  'solicito',
  'solicitad',
  'peco ',
  'encaminh',
  'retorno',
  'retornar',
  'conduta',
  'manter ',
  'suspender',
  'suspendo',
  'repouso',
];
const REASON_WORDS = ['queixa', 'motivo', 'vem a consulta', 'vem por', 'procura atendimento'];

const mentions = (text: string, words: string[]) => {
  const t = ` ${normalizeSearch(text)} `;
  return words.some((w) => t.includes(w));
};

/**
 * Organização por palavras-chave: exame físico e conduta pelas palavras típicas; o motivo é a
 * frase que fala em queixa ou motivo (ou, sem ela, a primeira frase que sobrar); o resto vai
 * para a anamnese. Só devolve códigos.
 */
export function simulatedRecordDraft(facts: RecordNotesFacts): RecordDraftOutput {
  const fields: RecordDraftOutput['fields'] = {
    chiefComplaint: [],
    anamnesis: [],
    physicalExam: [],
    plan: [],
  };
  const rest: { code: string; text: string }[] = [];
  for (const s of facts.sentences) {
    if (mentions(s.text, PLAN_WORDS)) fields.plan.push(s.code);
    else if (mentions(s.text, EXAM_WORDS)) fields.physicalExam.push(s.code);
    else rest.push(s);
  }
  const reason = rest.find((s) => mentions(s.text, REASON_WORDS)) ?? rest[0];
  for (const s of rest) {
    if (s === reason) fields.chiefComplaint.push(s.code);
    else fields.anamnesis.push(s.code);
  }
  return { fields };
}

/** Resumo extrativo: de cada registro, a primeira frase do motivo e a primeira da conduta. */
export function simulatedRecordSummary(facts: RecordSummaryFacts): RecordSummaryOutput {
  const items: RecordSummaryOutput['items'] = [];
  for (const r of facts.records) {
    for (const field of ['chiefComplaint', 'plan'] as const) {
      const first = r.fields[field]?.[0];
      if (first) items.push({ field, refs: [first.code] });
    }
  }
  return { items: items.slice(0, RECORD_SUMMARY_MAX_ITEMS) };
}

/**
 * Modelo simulado: regras fixas dentro da API, sem enviar nada para fora. Único adaptador até
 * haver um fornecedor autorizado (docs/api/ia-nivel-1.md).
 */
@Injectable()
export class SimulatedModel extends LanguageModel {
  readonly info: ModelInfo = { provider: 'simulated', model: 'regras-fixas', version: '1' };

  complete(request: ModelRequest): Promise<string> {
    if (request.feature === 'request_triage') {
      return Promise.resolve(JSON.stringify(simulatedTriage(request.fields['message'] ?? '')));
    }
    if (request.feature === 'schedule_suggestions') {
      const facts = JSON.parse(request.fields['facts'] ?? '{}') as ScheduleFacts;
      return Promise.resolve(JSON.stringify(simulatedSchedule(facts)));
    }
    if (request.feature === 'record_draft') {
      const facts = JSON.parse(request.fields['facts'] ?? '{}') as RecordNotesFacts;
      return Promise.resolve(JSON.stringify(simulatedRecordDraft(facts)));
    }
    if (request.feature === 'record_summary') {
      const facts = JSON.parse(request.fields['facts'] ?? '{}') as RecordSummaryFacts;
      return Promise.resolve(JSON.stringify(simulatedRecordSummary(facts)));
    }
    if (request.feature === 'admin_report') {
      const metrics = JSON.parse(request.fields['metrics'] ?? '{}') as AdminReportMetrics;
      const period = { from: request.fields['from'] ?? '', to: request.fields['to'] ?? '' };
      return Promise.resolve(JSON.stringify({ highlights: simulatedReport(period, metrics) }));
    }
    return Promise.resolve(simulatedDraft(request.fields));
  }
}
