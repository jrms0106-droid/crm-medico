/// <reference types="fhir" />
import { randomUUID } from 'node:crypto';
import {
  type ClinicalCopyDto,
  DOCUMENT_KIND_LABELS,
  type DocumentDto,
  type RecordDto,
  type RecordKind,
} from '@crm/shared';

type Bundle = fhir4.Bundle;
type BundleEntry = fhir4.BundleEntry;
type CodeableConcept = fhir4.CodeableConcept;
type Composition = fhir4.Composition;
type CompositionSection = fhir4.CompositionSection;
type Condition = fhir4.Condition;
type DocumentReference = fhir4.DocumentReference;
type FhirResource = fhir4.FhirResource;
type Identifier = fhir4.Identifier;
type OperationOutcome = fhir4.OperationOutcome;
type Organization = fhir4.Organization;
type Patient = fhir4.Patient;
type Practitioner = fhir4.Practitioner;
type Reference = fhir4.Reference;

/** CRM/UF dos autores, para o identificador do `Practitioner`. */
export type CrmByUserId = ReadonlyMap<string, { number: string; state: string }>;

const LOINC = 'http://loinc.org';
const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
const SHA256 = 'urn:crm-medico:sha256';
const RECORD_ID = 'urn:crm-medico:registro';
const XHTML = 'http://www.w3.org/1999/xhtml';

const RECORD_TYPE: Record<RecordKind, { code: string; display: string; title: string }> = {
  consultation: { code: '11488-4', display: 'Consult note', title: 'Registro de consulta' },
  evolution: { code: '11506-3', display: 'Progress note', title: 'Evolução' },
  addendum: { code: '11506-3', display: 'Progress note', title: 'Adendo' },
};

const SECTIONS = [
  {
    field: 'chiefComplaint',
    code: '10154-3',
    display: 'Chief complaint',
    title: 'Queixa principal',
  },
  { field: 'anamnesis', code: '10164-2', display: 'History of present illness', title: 'Anamnese' },
  { field: 'physicalExam', code: '29545-1', display: 'Physical findings', title: 'Exame físico' },
] as const;
const HYPOTHESES = { code: '51848-0', display: 'Assessment note', title: 'Hipóteses diagnósticas' };
const PLAN = { code: '18776-5', display: 'Plan of care note', title: 'Conduta' };

const urn = (id: string) => `urn:uuid:${id}`;
const ref = (id: string, display?: string): Reference =>
  display ? { reference: urn(id), display } : { reference: urn(id) };
const loinc = (code: string, display: string, text: string): CodeableConcept => ({
  coding: [{ system: LOINC, code, display }],
  text,
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\r?\n/g, '<br/>');

/** Narrativa XHTML do FHIR: o texto sempre escapado, nunca HTML vindo do usuário. */
const narrative = (paragraphs: string[]) => ({
  status: 'generated' as const,
  div: `<div xmlns="${XHTML}">${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`,
});

const hashIdentifier = (hash: string | null): Identifier[] =>
  hash ? [{ system: SHA256, value: hash }] : [];

/**
 * Converte a cópia do prontuário (mesmo conteúdo, mesmas regras de acesso) num `Bundle` FHIR R4
 * do tipo `collection` (docs/api/integracoes.md). Função pura: quem chama já filtrou o acesso.
 */
export function toFhirBundle(
  copy: ClinicalCopyDto,
  crm: CrmByUserId,
  newId: () => string = randomUUID,
): Bundle {
  const entries: BundleEntry[] = [];
  const add = (id: string, resource: FhirResource) => {
    entries.push({ fullUrl: urn(id), resource });
  };

  const orgId = newId();
  const organization: Organization = { resourceType: 'Organization', name: copy.organization.name };
  add(orgId, organization);

  const patient: Patient = {
    resourceType: 'Patient',
    name: [{ use: 'usual', text: copy.patient.name }],
    birthDate: copy.patient.birthDate,
    managingOrganization: ref(orgId, copy.organization.name),
  };
  add(copy.patient.id, patient);
  const subject = ref(copy.patient.id, copy.patient.name);

  const authors = new Map<string, string>();
  for (const item of [...copy.records, ...copy.documents])
    authors.set(item.author.id, item.author.name);
  for (const [id, name] of authors) {
    const reg = crm.get(id);
    const practitioner: Practitioner = {
      resourceType: 'Practitioner',
      name: [{ text: name }],
      ...(reg && {
        identifier: [{ system: `urn:crm-medico:crm:${reg.state}`, value: reg.number }],
        qualification: [{ code: { text: `CRM ${reg.number}/${reg.state}` } }],
      }),
    };
    add(id, practitioner);
  }

  const included = new Set(copy.records.map((r) => r.id));
  for (const r of copy.records) {
    const conditions = (r.content.hypotheses ?? []).map((h) => {
      const id = newId();
      const condition: Condition = {
        resourceType: 'Condition',
        verificationStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
              code: 'provisional',
            },
          ],
        },
        code: {
          ...(h.icd10 && { coding: [{ system: ICD10, code: h.icd10 }] }),
          text: h.description,
        },
        subject,
        recordedDate: r.clinicalDate,
        recorder: ref(r.author.id, r.author.name),
      };
      return {
        id,
        condition,
        label: h.icd10 ? `${h.description} (CID-10 ${h.icd10})` : h.description,
      };
    });
    add(r.id, composition(r, subject, conditions, included));
    for (const c of conditions) add(c.id, c.condition);
  }

  for (const d of copy.documents) add(d.id, documentReference(d, subject));

  const outcome: OperationOutcome = {
    resourceType: 'OperationOutcome',
    issue: [
      { severity: 'information', code: 'informational', diagnostics: copy.notice },
      ...(copy.withheld.reason
        ? [
            {
              severity: 'information' as const,
              code: 'suppressed' as const,
              diagnostics:
                `${copy.withheld.reason} Ficaram de fora ${copy.withheld.records} registro(s) ` +
                `e ${copy.withheld.documents} documento(s).`,
            },
          ]
        : []),
    ],
  };
  add(newId(), outcome);

  return {
    resourceType: 'Bundle',
    id: newId(),
    meta: { lastUpdated: copy.generatedAt },
    identifier: { system: 'urn:crm-medico:copia-do-prontuario', value: copy.generatedAt },
    type: 'collection',
    timestamp: copy.generatedAt,
    entry: entries,
  };
}

function composition(
  r: RecordDto,
  subject: Reference,
  conditions: { id: string; label: string }[],
  included: ReadonlySet<string>,
): Composition {
  const type = RECORD_TYPE[r.kind];
  const author = ref(r.author.id, r.author.name);
  const section: CompositionSection[] = [];
  for (const s of SECTIONS) {
    const value = r.content[s.field]?.trim();
    if (value) {
      section.push({
        title: s.title,
        code: loinc(s.code, s.display, s.title),
        text: narrative(value.split(/\r?\n\r?\n/)),
      });
    }
  }
  if (conditions.length > 0) {
    section.push({
      title: HYPOTHESES.title,
      code: loinc(HYPOTHESES.code, HYPOTHESES.display, HYPOTHESES.title),
      text: narrative(conditions.map((c) => c.label)),
      entry: conditions.map((c) => ref(c.id, c.label)),
    });
  }
  const plan = r.content.plan?.trim();
  if (plan) {
    section.push({
      title: PLAN.title,
      code: loinc(PLAN.code, PLAN.display, PLAN.title),
      text: narrative(plan.split(/\r?\n\r?\n/)),
    });
  }
  // Registro que ficou fora da cópia é citado só pelo identificador, sem referência solta.
  const target = (id: string): Reference =>
    included.has(id) ? ref(id) : { identifier: { system: RECORD_ID, value: id } };
  const relatesTo: Composition['relatesTo'] = [];
  if (r.rectifiesId) relatesTo.push({ code: 'replaces', targetReference: target(r.rectifiesId) });
  if (r.addendumOfId) relatesTo.push({ code: 'appends', targetReference: target(r.addendumOfId) });
  const date = r.signedAt ?? r.updatedAt;
  return {
    resourceType: 'Composition',
    ...(r.contentHash && { identifier: { system: SHA256, value: r.contentHash } }),
    status: r.status === 'rectified' ? 'amended' : 'final',
    type: loinc(type.code, type.display, type.title),
    subject,
    date,
    author: [author],
    title: `${type.title} de ${r.clinicalDate}`,
    attester: r.signedAt ? [{ mode: 'legal', time: r.signedAt, party: author }] : [],
    ...(relatesTo.length > 0 && { relatesTo }),
    section,
  };
}

function documentReference(d: DocumentDto, subject: Reference): DocumentReference {
  const label = DOCUMENT_KIND_LABELS[d.kind];
  const content = Buffer.from(
    JSON.stringify({ kind: d.kind, content: d.content, snapshot: d.snapshot }),
    'utf8',
  ).toString('base64');
  return {
    resourceType: 'DocumentReference',
    identifier: hashIdentifier(d.contentHash),
    status: d.status === 'cancelled' ? 'entered-in-error' : 'current',
    docStatus: 'final',
    type: { text: label },
    subject,
    ...((d.signedAt ?? d.issuedOn) && { date: d.signedAt ?? `${d.issuedOn}T00:00:00Z` }),
    author: [ref(d.author.id, d.author.name)],
    description:
      d.status === 'cancelled' ? `${label} (cancelado: ${d.cancelReason ?? 'sem motivo'})` : label,
    content: [
      {
        attachment: {
          contentType: 'application/json',
          language: 'pt-BR',
          data: content,
          title: `${label}.json`,
          ...(d.signedAt && { creation: d.signedAt }),
        },
      },
    ],
  };
}
