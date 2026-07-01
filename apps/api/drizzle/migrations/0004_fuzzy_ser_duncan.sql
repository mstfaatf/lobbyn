CREATE TYPE "public"."reaction_type" AS ENUM('like', 'heart', 'laugh', 'wow', 'sad', 'angry');--> statement-breakpoint
ALTER TABLE "reactions" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reactions" ALTER COLUMN "type" SET DATA TYPE "public"."reaction_type" USING "type"::"public"."reaction_type";