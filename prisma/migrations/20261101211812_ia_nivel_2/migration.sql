-- IA nível 2, documental (docs/api/ia-nivel-2.md): duas funcionalidades novas, desligadas por
-- padrão como as do nível 1.
ALTER TYPE "ai"."AiFeature" ADD VALUE 'record_draft';
ALTER TYPE "ai"."AiFeature" ADD VALUE 'record_summary';
