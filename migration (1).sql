CREATE TABLE "account_profiles" (
	"user_id" text PRIMARY KEY,
	"username" text NOT NULL,
	"grade" text NOT NULL,
	"age" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
