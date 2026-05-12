DROP INDEX "posts_is_pinned_true_idx";--> statement-breakpoint
CREATE INDEX "posts_is_pinned_true_idx" ON "posts" USING btree ("is_pinned") WHERE "posts"."is_pinned" = true;