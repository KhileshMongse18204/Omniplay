CREATE TYPE "public"."link_status" AS ENUM('active', 'draft', 'hidden', 'broken');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('dead', 'wrong_link', 'malicious');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'editor', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('invited', 'pending', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" integer,
	"action" varchar(40) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parent_id" integer,
	"slug" varchar(80) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(280) DEFAULT '' NOT NULL,
	"icon" varchar(16) DEFAULT '' NOT NULL,
	"color" varchar(16) DEFAULT '#b6ff3b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_clicks_daily" (
	"day" date NOT NULL,
	"link_id" integer NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "link_clicks_daily_day_link_id_pk" PRIMARY KEY("day","link_id")
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category_id" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"url" text NOT NULL,
	"description" varchar(280) DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "link_status" DEFAULT 'draft' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"image_key" varchar(120),
	"search_text" text DEFAULT '' NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"check_failures" smallint DEFAULT 0 NOT NULL,
	"check_code" smallint,
	"checked_at" timestamp with time zone,
	"auto_broken" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"link_id" integer NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_queries_daily" (
	"day" date NOT NULL,
	"query" varchar(100) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"results" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "search_queries_daily_day_query_pk" PRIMARY KEY("day","query")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(40) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "traffic_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(254) NOT NULL,
	"name" varchar(80) DEFAULT '' NOT NULL,
	"password_hash" text,
	"role" "staff_role" DEFAULT 'moderator' NOT NULL,
	"status" "staff_status" DEFAULT 'invited' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"invite_token_hash" varchar(64),
	"invite_expires_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_clicks_daily" ADD CONSTRAINT "link_clicks_daily_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_sort_idx" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "categories_visible_sort_idx" ON "categories" USING btree ("is_visible","sort_order");--> statement-breakpoint
CREATE INDEX "clicks_link_day_idx" ON "link_clicks_daily" USING btree ("link_id","day");--> statement-breakpoint
CREATE INDEX "links_public_idx" ON "links" USING btree ("category_id","status","is_featured","popularity","id");--> statement-breakpoint
CREATE INDEX "links_feed_idx" ON "links" USING btree ("status","is_featured","popularity","id");--> statement-breakpoint
CREATE INDEX "links_check_idx" ON "links" USING btree ("status","checked_at");--> statement-breakpoint
CREATE INDEX "links_health_idx" ON "links" USING btree ("status","check_failures");--> statement-breakpoint
CREATE INDEX "links_tags_gin" ON "links" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "links_search_trgm" ON "links" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "links_url_idx" ON "links" USING btree ("url");--> statement-breakpoint
CREATE INDEX "links_created_idx" ON "links" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "links_popularity_idx" ON "links" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "links_title_idx" ON "links" USING btree ("title");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_link_idx" ON "reports" USING btree ("link_id","status");--> statement-breakpoint
CREATE INDEX "reports_resolved_by_idx" ON "reports" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "search_day_results_idx" ON "search_queries_daily" USING btree ("day","results");--> statement-breakpoint
CREATE INDEX "settings_updated_by_idx" ON "settings" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_invite_uq" ON "users" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");