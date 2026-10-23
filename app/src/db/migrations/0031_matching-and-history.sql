ALTER TABLE "facts" DROP CONSTRAINT "facts_superseded_by_fk";
--> statement-breakpoint
CREATE INDEX "facts_superseded_by_id_idx" ON "facts" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "memory_objects_name_trgm_idx" ON "memory_objects" USING gin ("name" gin_trgm_ops);