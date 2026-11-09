/// <reference types="fhir" />
import type { ClinicalCopyDto, ExternalDocumentDto, RecordDto } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { toFhirBundle } from './fhir-copy.js';

type Composition = fhir4.Composition;
type DocumentReference = fhir4.DocumentReference;

const AUTHOR = { id: '01900000-0000-7000-8000-000000000001', name: 'Dra. Fictícia' };

function record(overrides: Partial<RecordDto>): RecordDto {
  return {
    id: '01900000-0000-7000-8000-0000000000a1',
    patientId: '01900000-0000-7000-8000-0000000000p1',
    author: AUTHOR,
    encounterId: null,
    telemedicine: false,
    kind: 'evolution',
    clinicalDate: '2026-03-02',
    sensitivity: 'normal',
    status: 'signed',
    version: 2,
    formVersion: 'generic-v1',
    content: {},
    contentHash: 'a'.repeat(64),
    signedAt: '2026-03-02T12:00:00.000Z',
    integrity: 'valid',
    rectifiesId: null,
    rectifiedById: null,
    addendumOfId: null,
    justification: null,
    createdAt: '2026-03-02T11:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
    ...overrides,
  };
}

function copy(records: RecordDto[]): ClinicalCopyDto {
  return {
    format: 'crm-medico/copia-do-prontuario',
    version: 1,
    generatedAt: '2026-03-03T10:00:00.000Z',
    generatedBy: AUTHOR,
    organization: { name: 'Clínica Fictícia' },
    patient: {
      id: '01900000-0000-7000-8000-0000000000p1',
      name: 'Paciente Fictício',
      birthDate: '1990-01-01',
    },
    notice: 'Aviso.',
    records,
    documents: [],
    externalDocuments: [],
    withheld: { records: 0, documents: 0, reason: null },
  };
}

let n = 0;
const seq = () => `01900000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

describe('toFhirBundle', () => {
  it('escapa o texto do usuário na narrativa XHTML', () => {
    const bundle = toFhirBundle(
      copy([record({ content: { anamnesis: '<script>alert("x")</script> & "aspas"\nlinha 2' } })]),
      new Map(),
      seq,
    );
    const comp = bundle.entry!.find((e) => e.resource?.resourceType === 'Composition')!
      .resource as Composition;
    const div = comp.section![0]!.text!.div;
    expect(div).toMatch(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">/);
    expect(div).not.toContain('<script>');
    expect(div).toContain(
      '&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#34;aspas&#34;<br/>linha 2',
    );
  });

  it('ficha de cardiologia vira uma seção com o mesmo texto da tela, antes das hipóteses', () => {
    const bundle = toFhirBundle(
      copy([
        record({
          formVersion: 'cardiology-v1',
          content: {
            physicalExam: 'Bulhas rítmicas.',
            cardiology: {
              vitals: { systolicBp: 130, diastolicBp: 80 },
              echo: { lvef: 60, findings: 'Sem <alterações>.' },
            },
            hypotheses: [{ description: 'Angina estável' }],
          },
        }),
      ]),
      new Map(),
      seq,
    );
    const comp = bundle.entry!.find((e) => e.resource?.resourceType === 'Composition')!
      .resource as Composition;
    expect(comp.section!.map((s) => s.title)).toEqual([
      'Exame físico',
      'Ficha de cardiologia',
      'Hipóteses diagnósticas',
    ]);
    const div = comp.section![1]!.text!.div;
    expect(div).toContain('<p>Sinais vitais: PA 130/80 mmHg</p>');
    expect(div).toContain('<p>Ecocardiograma: FEVE 60%; Sem &#60;alterações&#62;.</p>');
  });

  it('retificação aponta para o original no arquivo; original fora da cópia vira só identificador', () => {
    const original = record({ id: '01900000-0000-7000-8000-0000000000b1', status: 'rectified' });
    const fix = record({ id: '01900000-0000-7000-8000-0000000000b2', rectifiesId: original.id });
    const orphan = record({
      id: '01900000-0000-7000-8000-0000000000b3',
      addendumOfId: '01900000-0000-7000-8000-0000000000ff',
    });
    const bundle = toFhirBundle(copy([original, fix, orphan]), new Map(), seq);
    const comps = bundle
      .entry!.map((e) => e.resource)
      .filter((r): r is Composition => r?.resourceType === 'Composition');
    expect(comps.map((c) => c.status)).toEqual(['amended', 'final', 'final']);
    expect(comps[1]!.relatesTo).toEqual([
      { code: 'replaces', targetReference: { reference: `urn:uuid:${original.id}` } },
    ]);
    expect(comps[2]!.relatesTo).toEqual([
      {
        code: 'appends',
        targetReference: {
          identifier: {
            system: 'urn:crm-medico:registro',
            value: '01900000-0000-7000-8000-0000000000ff',
          },
        },
      },
    ]);
  });

  it('registro sem CRM conhecido gera Practitioner só com o nome', () => {
    const bundle = toFhirBundle(copy([record({})]), new Map(), seq);
    const practitioner = bundle.entry!.find((e) => e.resource?.resourceType === 'Practitioner')!;
    expect(practitioner.resource).toEqual({
      resourceType: 'Practitioner',
      name: [{ text: AUTHOR.name }],
    });
  });

  it('documento do CFM vira DocumentReference com o resumo em anexo e autor no arquivo', () => {
    const other = { id: '01900000-0000-7000-8000-000000000002', name: 'Dr. Fictício' };
    const external: ExternalDocumentDto = {
      id: '01900000-0000-7000-8000-0000000000c1',
      patientId: '01900000-0000-7000-8000-0000000000p1',
      author: other,
      encounterId: null,
      platform: 'cfm',
      kind: 'certificate',
      status: 'registered',
      issuedOn: '2026-03-01',
      summary: 'Atestado fictício de 2 dias <sem HTML>.',
      validationCode: null,
      createdAt: '2026-03-01T15:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
    };
    const bundle = toFhirBundle({ ...copy([]), externalDocuments: [external] }, new Map(), seq);
    const entry = bundle.entry!.find((e) => e.resource?.resourceType === 'DocumentReference')!;
    expect(entry.fullUrl).toBe(`urn:uuid:${external.id}`);
    const doc = entry.resource as DocumentReference;
    expect(doc.identifier).toEqual([
      { system: 'urn:crm-medico:documento-externo', value: external.id },
    ]);
    expect(doc.type).toEqual({ text: 'Atestado' });
    expect(doc.category).toEqual([
      { text: 'Emitido na Plataforma de Prescrição Eletrônica do CFM' },
    ]);
    expect(doc.author).toEqual([{ reference: `urn:uuid:${other.id}`, display: other.name }]);
    const attachment = doc.content[0]!.attachment;
    expect(attachment.contentType).toBe('text/plain; charset=utf-8');
    expect(Buffer.from(attachment.data!, 'base64').toString('utf8')).toBe(external.summary);
    expect(
      bundle.entry!.some(
        (e) => e.resource?.resourceType === 'Practitioner' && e.fullUrl === `urn:uuid:${other.id}`,
      ),
    ).toBe(true);
  });

  it('receita simulada da Memed não se passa por documento do CFM', () => {
    const external: ExternalDocumentDto = {
      id: '01900000-0000-7000-8000-0000000000c2',
      patientId: '01900000-0000-7000-8000-0000000000p1',
      author: AUTHOR,
      encounterId: null,
      platform: 'memed',
      kind: 'prescription',
      status: 'registered',
      issuedOn: '2026-03-01',
      summary: 'Receita simulada, sem validade legal: nenhuma plataforma foi contratada.',
      validationCode: 'SIMULADO-ABCD-EFGH',
      createdAt: '2026-03-01T15:00:00.000Z',
      cancelledAt: null,
      cancelReason: null,
    };
    const bundle = toFhirBundle({ ...copy([]), externalDocuments: [external] }, new Map(), seq);
    const doc = bundle.entry!.find((e) => e.resource?.resourceType === 'DocumentReference')!
      .resource as DocumentReference;
    expect(doc.identifier).toEqual([
      { system: 'urn:crm-medico:documento-externo', value: external.id },
      { system: 'urn:crm-medico:memed-simulada:codigo', value: 'SIMULADO-ABCD-EFGH' },
    ]);
    expect(doc.category).toEqual([{ text: 'Emitido na Memed (simulada, sem validade legal)' }]);
    expect(doc.description).toContain('Não existe documento assinado em nenhuma plataforma');
    expect(JSON.stringify(doc)).not.toContain('CFM');
  });

  it('registro e documento de teleconsulta levam a categoria de telemedicina; os presenciais não', () => {
    const tele = record({ telemedicine: true });
    const plain = record({ id: '01900000-0000-7000-8000-0000000000a2' });
    const bundle = toFhirBundle({ ...copy([tele, plain]) }, new Map(), seq);
    const compositions = bundle
      .entry!.map((e) => e.resource!)
      .filter((r): r is Composition => r.resourceType === 'Composition');
    const byTele = compositions.map((c) => c.category?.[0]?.text);
    expect(byTele.filter((c) => c === 'Emitido por telemedicina')).toHaveLength(1);
    expect(byTele.filter((c) => c === undefined)).toHaveLength(1);
  });
});
