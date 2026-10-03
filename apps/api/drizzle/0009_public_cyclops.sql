CREATE TABLE "platform_account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"username" text NOT NULL,
	"token_enc" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_account_user_platform" UNIQUE("user_id","platform"),
	CONSTRAINT "platform_account_platform" CHECK ("platform_account"."platform" in ('hackerone')),
	CONSTRAINT "platform_account_status" CHECK ("platform_account"."status" in ('ok', 'invalid', 'error'))
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"public" boolean NOT NULL,
	"offers_bounties" boolean NOT NULL,
	"submission_state" text NOT NULL,
	"policy" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"scopes_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_platform_handle" UNIQUE("platform","handle")
);
--> statement-breakpoint
CREATE TABLE "program_access" (
	"user_id" text NOT NULL,
	"program_id" bigint NOT NULL,
	"mine" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_access_user_id_program_id_pk" PRIMARY KEY("user_id","program_id")
);
--> statement-breakpoint
CREATE TABLE "program_scope" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_scope_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"external_id" text NOT NULL,
	"asset_type" text NOT NULL,
	"identifier" text NOT NULL,
	"eligible_for_bounty" boolean NOT NULL,
	"eligible_for_submission" boolean NOT NULL,
	"max_severity" text,
	"instruction" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "program_scope_external" UNIQUE("program_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "platform_account" ADD CONSTRAINT "platform_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_access" ADD CONSTRAINT "program_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_access" ADD CONSTRAINT "program_access_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_scope" ADD CONSTRAINT "program_scope_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_access_program_idx" ON "program_access" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "program_scope_type_idx" ON "program_scope" USING btree ("asset_type");