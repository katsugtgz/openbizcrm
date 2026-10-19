ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_amounts_check";--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_journal_entry_org_fk" FOREIGN KEY ("org_id","journal_entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_org_fk" FOREIGN KEY ("org_id","journal_entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_org_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_org_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_journal_entry_org_fk" FOREIGN KEY ("org_id","journal_entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_org_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_check" CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 AND credit = 0 OR credit > 0 AND debit = 0));