/// <reference types="fhir" />
import type { ClinicalCopyDto, RecordDto } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { toFhirBundle } from './fhir-copy.js';

type Composition = fhir4.Composition;

const AUTHOR = { id: '01900000-0000-7000-8000-000000000001', name: 'Dra. Fictícia' };

function record(overrides: Partial<RecordDto>): RecordDto {
  return {
    id: '01900000-0000-7000-8000-0000000000a1',
    patientId: '01900000-0000-7000-8000-0000000000p1',
    author: AUTHOR,
    encounterId: null,
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
});
