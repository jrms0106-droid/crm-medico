-- Teleconsulta (ADR 0043): modalidade, sala de vídeo e consentimento do paciente.
CREATE TYPE "scheduling"."AppointmentModality" AS ENUM ('in_person', 'telemedicine');

ALTER TABLE "scheduling"."appointments"
    ADD COLUMN "modality" "scheduling"."AppointmentModality" NOT NULL DEFAULT 'in_person',
    ADD COLUMN "meeting_url" VARCHAR(300),
    ADD COLUMN "tele_consent_at" TIMESTAMPTZ(3),
    ADD COLUMN "tele_consent_by_user_id" UUID,
    ADD COLUMN "tele_consent_version" VARCHAR(40),
    ADD CONSTRAINT "appointments_tele_consent_check" CHECK (
        "tele_consent_at" IS NULL OR (
            "modality" = 'telemedicine'
            AND "tele_consent_by_user_id" IS NOT NULL
            AND "tele_consent_version" IS NOT NULL
        )
    ),
    ADD CONSTRAINT "appointments_meeting_url_check" CHECK (
        "meeting_url" IS NULL OR "modality" = 'telemedicine'
    );
