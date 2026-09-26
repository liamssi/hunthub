CREATE TABLE "console_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "console_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text,
	"machine_id" uuid,
	"session" text NOT NULL,
	"method" text NOT NULL,
	"params" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "console_audit_outcome_check" CHECK ("console_audit"."outcome" in ('ok', 'error', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "console_audit" ADD CONSTRAINT "console_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_audit" ADD CONSTRAINT "console_audit_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "console_audit_machine_created_idx" ON "console_audit" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE INDEX "console_audit_user_idx" ON "console_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "console_audit_created_idx" ON "console_audit" USING btree ("created_at");