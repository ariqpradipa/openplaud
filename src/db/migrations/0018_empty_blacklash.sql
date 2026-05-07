ALTER TABLE "transcriptions" ALTER COLUMN "text" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "transcriptions" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "status" varchar(20) DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "error_message" text;