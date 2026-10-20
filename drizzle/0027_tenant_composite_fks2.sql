ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "drive_files" DROP CONSTRAINT "drive_files_folder_id_drive_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_org_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."chat_conversations"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_folder_org_fk" FOREIGN KEY ("folder_id","org_id") REFERENCES "public"."drive_folders"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_id_org_key" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_id_org_key" UNIQUE("id","org_id");