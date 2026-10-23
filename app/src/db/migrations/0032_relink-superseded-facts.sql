-- Keeping memory's history whole when facts are deleted, written by hand since Drizzle can't
-- express triggers. A superseded fact points at the fact that replaced it (`superseded_by_id`).
-- When that fact goes (its last source went with a connection, invariant 3), the older fact
-- points instead at the first replacement that's left, taking its valid time as its end, or,
-- with none left, is current again: memory no longer knows anything newer. Each fact deleted
-- in the statement is followed to its own replacement, so a chain loses any number of links.
CREATE FUNCTION memory_relink_superseded_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH RECURSIVE replaced(gone_id, next_id) AS (
      SELECT id, superseded_by_id FROM gone_facts
      UNION
      SELECT r.gone_id, g.superseded_by_id
      FROM replaced r JOIN gone_facts g ON g.id = r.next_id
    ),
    survivor AS (
      SELECT r.gone_id, r.next_id FROM replaced r
      WHERE r.next_id IS NULL OR NOT EXISTS (SELECT 1 FROM gone_facts g WHERE g.id = r.next_id)
    )
  UPDATE facts f
  SET superseded_by_id = s.next_id,
      superseded_at = CASE WHEN s.next_id IS NULL THEN NULL ELSE f.superseded_at END,
      valid_until = (SELECT n.valid_from FROM facts n WHERE n.id = s.next_id)
  FROM survivor s
  WHERE f.superseded_by_id = s.gone_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER facts_relink_superseded_facts
  AFTER DELETE ON facts
  REFERENCING OLD TABLE AS gone_facts
  FOR EACH STATEMENT EXECUTE FUNCTION memory_relink_superseded_facts();
