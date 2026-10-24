-- Removing an Ask Mycel reply with the data it drew on, written by hand since Drizzle can't
-- express triggers. Deleting a connection or a memory fact cascades to the rows recording which
-- replies drew on it (invariant 3); these triggers then replace each such reply's parts with a
-- tombstone in the same transaction, whichever path deleted it. The message row stays, so the
-- conversation still reads in order and can say something was removed, but none of the
-- reply's words do. A reply deleted outright (its conversation deleted) is gone already, and
-- the update finds nothing.
CREATE FUNCTION agent_remove_replies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_messages m
  SET parts = '[{"type":"removed"}]'::jsonb
  WHERE m.id IN (SELECT DISTINCT message_id FROM gone_rows)
    AND m.parts <> '[{"type":"removed"}]'::jsonb;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_message_connections_remove_replies
  AFTER DELETE ON agent_message_connections
  REFERENCING OLD TABLE AS gone_rows
  FOR EACH STATEMENT EXECUTE FUNCTION agent_remove_replies();
--> statement-breakpoint
CREATE TRIGGER agent_message_facts_remove_replies
  AFTER DELETE ON agent_message_facts
  REFERENCING OLD TABLE AS gone_rows
  FOR EACH STATEMENT EXECUTE FUNCTION agent_remove_replies();
