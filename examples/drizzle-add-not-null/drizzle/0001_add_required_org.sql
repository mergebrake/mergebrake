-- Drizzle migration
ALTER TABLE "users" ADD COLUMN "organization_id" integer NOT NULL;
CREATE INDEX users_organization_id_idx ON "users" ("organization_id");
