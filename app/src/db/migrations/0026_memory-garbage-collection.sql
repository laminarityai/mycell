-- Memory's garbage collection, written by hand since Drizzle can't express triggers. Deleting a
-- connection cascades to its source records and their links to facts (invariant 3); these
-- triggers carry the deletion on in the same transaction, whichever path deleted it: a fact
-- learned from sources goes when its last source link goes, and an object goes when no fact is
-- about it or links to it. A fact a person told Mycel (`told_by`, M9) has no sources to lose.
CREATE FUNCTION memory_delete_unsupported_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM facts f
  WHERE f.origin = 'source'
    AND f.id IN (SELECT DISTINCT fact_id FROM gone_links)
    AND NOT EXISTS (SELECT 1 FROM fact_sources s WHERE s.fact_id = f.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fact_sources_delete_unsupported_facts
  AFTER DELETE ON fact_sources
  REFERENCING OLD TABLE AS gone_links
  FOR EACH STATEMENT EXECUTE FUNCTION memory_delete_unsupported_facts();
--> statement-breakpoint
CREATE FUNCTION memory_delete_unused_objects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM memory_objects o
  WHERE o.id IN (
      SELECT subject_id FROM gone_facts
      UNION
      SELECT object_id FROM gone_facts WHERE object_id IS NOT NULL
    )
    AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.subject_id = o.id OR f.object_id = o.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER facts_delete_unused_objects
  AFTER DELETE ON facts
  REFERENCING OLD TABLE AS gone_facts
  FOR EACH STATEMENT EXECUTE FUNCTION memory_delete_unused_objects();
