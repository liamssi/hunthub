CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credential_hash" text NOT NULL,
	"host" jsonb,
	"runner_version" text,
	"public_ip" text,
	"last_seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_credential_hash_unique" UNIQUE("credential_hash"),
	CONSTRAINT "machine_status_check" CHECK ("machine"."status" in ('active', 'disabled')),
	CONSTRAINT "machine_name_length" CHECK (length("machine"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "machine_join_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"machine_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_join_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "machine_stats_hour" (
	"machine_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"samples" integer NOT NULL,
	"cpu_avg" double precision NOT NULL,
	"cpu_max" double precision NOT NULL,
	"mem_avg" double precision NOT NULL,
	"mem_max" double precision NOT NULL,
	"mem_total" double precision NOT NULL,
	"rx_bps" double precision NOT NULL,
	"tx_bps" double precision NOT NULL,
	"disks" jsonb NOT NULL,
	"agents" integer,
	CONSTRAINT "machine_stats_hour_machine_id_bucket_pk" PRIMARY KEY("machine_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "machine_stats_minute" (
	"machine_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"samples" integer NOT NULL,
	"cpu_avg" double precision NOT NULL,
	"cpu_max" double precision NOT NULL,
	"mem_avg" double precision NOT NULL,
	"mem_max" double precision NOT NULL,
	"mem_total" double precision NOT NULL,
	"rx_bps" double precision NOT NULL,
	"tx_bps" double precision NOT NULL,
	"disks" jsonb NOT NULL,
	"agents" integer,
	CONSTRAINT "machine_stats_minute_machine_id_bucket_pk" PRIMARY KEY("machine_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_join_token" ADD CONSTRAINT "machine_join_token_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_join_token" ADD CONSTRAINT "machine_join_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_stats_hour" ADD CONSTRAINT "machine_stats_hour_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_stats_minute" ADD CONSTRAINT "machine_stats_minute_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_setting_updated_by_idx" ON "app_setting" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "machine_created_by_idx" ON "machine" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "machine_join_token_machine_idx" ON "machine_join_token" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "machine_join_token_created_by_idx" ON "machine_join_token" USING btree ("created_by");