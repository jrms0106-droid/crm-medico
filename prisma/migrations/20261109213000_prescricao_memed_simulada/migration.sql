-- Prescrição pela Memed, só simulada (ADR 0045): a plataforma do registro passa a aceitar 'memed'.
ALTER TABLE "documents"."external_documents" DROP CONSTRAINT "external_documents_platform_known";
ALTER TABLE "documents"."external_documents"
  ADD CONSTRAINT "external_documents_platform_known" CHECK ("platform" IN ('cfm', 'memed'));
