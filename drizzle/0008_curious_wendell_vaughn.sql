ALTER TABLE "projects" ADD CONSTRAINT "projects_client_company_id_crm_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;
-- NOTE: applied manually via psql (db:push needs TTY). Journal (_journal.json)
-- is source of truth for drizzle-kit; DB has no drizzle migrations table yet.
