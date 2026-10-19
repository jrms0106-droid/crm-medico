-- Restrições que o Prisma não expressa no esquema.
ALTER TABLE "identity"."users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_roles_not_empty" CHECK (cardinality("roles") > 0),
  ADD CONSTRAINT "users_failed_login_count_nonnegative" CHECK ("failed_login_count" >= 0);

ALTER TABLE "identity"."sessions"
  ADD CONSTRAINT "sessions_expiry_after_creation" CHECK ("expires_at" > "created_at");
