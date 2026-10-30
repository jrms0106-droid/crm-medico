import PDFDocument from 'pdfkit';
import {
  type CertificateContent,
  DOCUMENT_KIND_LABELS,
  type DocumentDto,
  type ExamRequestContent,
  type PrescriptionContent,
  type ReferralContent,
  type ReportContent,
} from '@crm/shared';

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por fuso horário. */
const br = (date: string) => date.split('-').reverse().join('/');

const SIGNATURE_NOTICE =
  'Assinado eletronicamente no sistema (assinatura interna, sem certificado ICP-Brasil).';

type Doc = PDFKit.PDFDocument;

function section(pdf: Doc, label: string, text: string | undefined) {
  if (!text?.trim()) return;
  pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(11).text(label);
  pdf.font('Helvetica').fontSize(11).text(text.trim());
}

function body(pdf: Doc, d: DocumentDto, patientName: string) {
  pdf.font('Helvetica').fontSize(11);
  switch (d.kind) {
    case 'prescription': {
      const c = d.content as PrescriptionContent;
      c.items.forEach((item, i) => {
        pdf
          .moveDown(0.6)
          .font('Helvetica-Bold')
          .text(`${i + 1}. ${item.medication}`, {
            continued: Boolean(item.quantity),
          });
        if (item.quantity) pdf.font('Helvetica').text(`  (${item.quantity})`);
        pdf.font('Helvetica').text(item.instructions, { indent: 14 });
      });
      section(pdf, 'Observações', c.notes);
      return;
    }
    case 'certificate': {
      const c = d.content as CertificateContent;
      const patient = d.snapshot?.patient.fullName ?? patientName;
      const start = c.startDate ? ` a partir de ${br(c.startDate)}` : '';
      const main =
        c.purpose === 'absence'
          ? `Atesto, para os devidos fins, que ${patient} necessita de afastamento de suas atividades por ${c.days} dia(s)${start}.`
          : `Atesto, para os devidos fins, que ${patient} compareceu a atendimento médico nesta data.`;
      pdf.moveDown(0.6).text(main, { align: 'justify' });
      if (c.icd10)
        pdf.moveDown(0.6).text(`CID-10: ${c.icd10} (informado com autorização do paciente).`);
      section(pdf, 'Observações', c.text);
      return;
    }
    case 'exam_request': {
      const c = d.content as ExamRequestContent;
      pdf.moveDown(0.6).font('Helvetica-Bold').text('Solicito:');
      pdf.font('Helvetica');
      c.items.forEach((item, i) => {
        pdf.text(`${i + 1}. ${item.exam}${item.notes ? ` (${item.notes})` : ''}`, { indent: 14 });
      });
      section(pdf, 'Indicação clínica', c.clinicalIndication);
      if (c.icd10) pdf.moveDown(0.6).text(`CID-10: ${c.icd10}`);
      return;
    }
    case 'referral': {
      const c = d.content as ReferralContent;
      section(pdf, 'Encaminho para', c.toSpecialty);
      section(pdf, 'Motivo', c.reason);
      section(pdf, 'Resumo clínico', c.clinicalSummary);
      return;
    }
    case 'report': {
      const c = d.content as ReportContent;
      pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(c.title);
      pdf.font('Helvetica').fontSize(11).text(c.body, { align: 'justify' });
      return;
    }
  }
}

/** Faixa diagonal (rascunho ou cancelado) em todas as páginas. */
function stamp(pdf: Doc, text: string) {
  const { width, height } = pdf.page;
  pdf.save();
  pdf.rotate(-35, { origin: [width / 2, height / 2] });
  pdf.font('Helvetica-Bold').fontSize(40).fillColor('#c62828').fillOpacity(0.18);
  pdf.text(text, 0, height / 2 - 30, { width, align: 'center', lineBreak: false });
  pdf.restore();
  pdf.fillColor('black').fillOpacity(1);
}

function footer(pdf: Doc, d: DocumentDto, page: number, pages: number) {
  const { width, height, margins } = pdf.page;
  const bottom = margins.bottom;
  pdf.page.margins.bottom = 0; // escrever no rodapé sem abrir página nova
  const lines = [
    d.contentHash ? SIGNATURE_NOTICE : 'Documento não assinado.',
    `Documento ${d.id}${d.contentHash ? ` · SHA-256 ${d.contentHash}` : ''}`,
    `Página ${page} de ${pages}`,
  ];
  pdf.font('Helvetica').fontSize(7).fillColor('#555555');
  pdf.text(lines.join('\n'), margins.left, height - 46, {
    width: width - margins.left - margins.right,
    align: 'center',
  });
  pdf.fillColor('black');
  pdf.page.margins.bottom = bottom;
}

/** PDF do documento, gerado na hora a partir do que está gravado (docs/api/documentos.md, PDF). */
export function renderDocumentPdf(d: DocumentDto, fallbackPatientName: string): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 72, left: 56, right: 56 },
    bufferPages: true,
    info: {
      Title: DOCUMENT_KIND_LABELS[d.kind],
      Author: d.snapshot?.issuer.name ?? d.author.name,
      CreationDate: d.signedAt ? new Date(d.signedAt) : new Date(d.updatedAt),
    },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const s = d.snapshot;
  const place = s ? [s.place.organization, s.place.unit].filter(Boolean).join(' · ') : '';
  if (place) pdf.font('Helvetica-Bold').fontSize(12).text(place, { align: 'center' });
  pdf.moveDown(0.8).font('Helvetica-Bold').fontSize(16);
  pdf.text(DOCUMENT_KIND_LABELS[d.kind].toUpperCase(), { align: 'center' });

  const patient = s?.patient;
  pdf.moveDown(1).font('Helvetica').fontSize(11);
  pdf.text(`Paciente: ${patient?.fullName ?? fallbackPatientName}`);
  if (patient?.socialName) pdf.text(`Nome social: ${patient.socialName}`);
  if (patient) pdf.text(`Data de nascimento: ${br(patient.birthDate)}`);

  body(pdf, d, patient?.fullName ?? fallbackPatientName);

  pdf.moveDown(2).font('Helvetica').fontSize(11);
  pdf.text(d.issuedOn ? `Emitido em ${br(d.issuedOn)}.` : 'Data de emissão: na assinatura.');
  pdf.moveDown(1.5);
  const issuer = s?.issuer;
  pdf.font('Helvetica-Bold').text(issuer?.name ?? d.author.name, { align: 'center' });
  pdf.font('Helvetica');
  if (issuer) {
    pdf.text(issuer.crm, { align: 'center' });
    for (const sp of issuer.specialties) {
      pdf.text(`${sp.name}${sp.rqe ? ` · RQE ${sp.rqe}` : ''}`, { align: 'center' });
    }
  }
  if (d.status === 'cancelled' && d.cancelReason) {
    pdf.moveDown(1).font('Helvetica-Bold').fillColor('#c62828');
    pdf.text(`Documento cancelado. Motivo: ${d.cancelReason}`);
    pdf.fillColor('black');
  }

  const range = pdf.bufferedPageRange();
  const mark =
    d.status === 'draft'
      ? 'RASCUNHO — SEM VALIDADE'
      : d.status === 'cancelled'
        ? 'CANCELADO'
        : null;
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    if (mark) stamp(pdf, mark);
    footer(pdf, d, i + 1, range.count);
  }
  pdf.end();
  return done;
}
