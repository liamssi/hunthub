CREATE TABLE "program_user" (
	"user_id" text NOT NULL,
	"program_id" bigint NOT NULL,
	"bookmarked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"viewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_user_user_id_program_id_pk" PRIMARY KEY("user_id","program_id"),
	CONSTRAINT "program_user_note_length" CHECK (char_length("program_user"."note") <= 100000),
	CONSTRAINT "program_user_tags_count" CHECK (cardinality("program_user"."tags") <= 20)
);
--> statement-breakpoint
ALTER TABLE "program_user" ADD CONSTRAINT "program_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_user" ADD CONSTRAINT "program_user_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_user_program_idx" ON "program_user" USING btree ("program_id");