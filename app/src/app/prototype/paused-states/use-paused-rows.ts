// PROTOTYPE, throwaway: the page's local state. Lifting a pause (re-enable, resume, raise the
// budget) or flipping a switch only changes this page's copy, so each variant shows what the
// next reason in line would be once one is lifted. No server, no database.
import { useState } from "react";
import type { PausedReason } from "../_shared/fixtures";
import {
  type BaseSwitch,
  MEMBER_SWITCHES,
  ORG_SWITCHES,
  type PauseRow,
  withReasons,
} from "./paused-fixtures";

export type PausedRows = {
  /** The person's own enablements. */
  mine: PauseRow[];
  /** Shared-inbox switches: an admin's to change, a member's to read. */
  org: PauseRow[];
  lift: (id: string, reason: PausedReason) => void;
  setOn: (id: string, on: boolean) => void;
};

export function usePausedRows(admin: boolean, creditsOut: boolean): PausedRows {
  const [lifted, setLifted] = useState<Partial<Record<string, PausedReason[]>>>({});
  const [onById, setOnById] = useState<Partial<Record<string, boolean>>>({});

  function build(base: BaseSwitch): PauseRow {
    const on = onById[base.id] ?? base.on;
    // Switching off and on again is a fresh enablement: no "needs your OK" left on it.
    const fresh = on && !base.on;
    const gone = lifted[base.id] ?? [];
    return withReasons({ ...base, on }, creditsOut, fresh ? [...gone, "needs_reenable"] : gone);
  }

  // A member sees the shared-inbox workflows published to their tags, without a switch.
  const orgBase = admin ? ORG_SWITCHES : ORG_SWITCHES.slice(0, 1);
  return {
    mine: MEMBER_SWITCHES.map(build),
    org: orgBase.map(build),
    lift(id, reason) {
      setLifted({ ...lifted, [id]: [...(lifted[id] ?? []), reason] });
    },
    setOn(id, on) {
      setOnById({ ...onById, [id]: on });
      if (!on) setLifted({ ...lifted, [id]: [...(lifted[id] ?? []), "needs_reenable"] });
    },
  };
}
