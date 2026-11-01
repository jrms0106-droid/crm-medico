-- Limite de tentativas de login no banco, para valer com mais de uma instância da API.
-- CreateTable
CREATE TABLE "identity"."login_rate_limits" (
    "key_hash" CHAR(64) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "login_rate_limits_pkey" PRIMARY KEY ("key_hash")
);

-- CreateIndex
CREATE INDEX "login_rate_limits_window_start_idx" ON "identity"."login_rate_limits"("window_start");

ALTER TABLE "identity"."login_rate_limits"
  ADD CONSTRAINT "login_rate_limits_key_hash_hex" CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "login_rate_limits_count_positive" CHECK ("count" > 0);
