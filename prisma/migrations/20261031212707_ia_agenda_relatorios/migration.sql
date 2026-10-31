-- IA nível 1: organização da agenda e relatório assistido (docs/api/ia-nivel-1.md).
-- Novas funcionalidades começam desligadas: nenhuma linha em ai.feature_settings.
ALTER TYPE "ai"."AiFeature" ADD VALUE 'schedule_suggestions';
ALTER TYPE "ai"."AiFeature" ADD VALUE 'admin_report';
