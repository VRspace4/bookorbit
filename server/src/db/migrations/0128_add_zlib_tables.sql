-- Local fork migration. Existing installs created these tables outside migrations, sometimes
-- with other constraint names, so each statement only adds what is missing.
CREATE TABLE IF NOT EXISTS "zlib_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"remix_user_id" varchar(100) NOT NULL,
	"remix_user_key" text NOT NULL,
	"session_cookies" text DEFAULT '' NOT NULL,
	"daily_download_count" integer DEFAULT 0 NOT NULL,
	"limit_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zlib_download_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"zlib_book_id" varchar(100) NOT NULL,
	"hash" varchar(100) NOT NULL,
	"title" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"extension" varchar(20) DEFAULT 'epub' NOT NULL,
	"filename" text NOT NULL,
	"cover" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"book_dock_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"zlib_credentials"'::regclass AND contype = 'f') THEN
    ALTER TABLE "zlib_credentials" ADD CONSTRAINT "zlib_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"zlib_download_queue"'::regclass AND contype = 'f') THEN
    ALTER TABLE "zlib_download_queue" ADD CONSTRAINT "zlib_download_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zlib_credentials_user_id_uidx" ON "zlib_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zlib_credentials_user_id_idx" ON "zlib_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zlib_download_queue_user_status_idx" ON "zlib_download_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zlib_download_queue_user_created_idx" ON "zlib_download_queue" USING btree ("user_id","created_at");