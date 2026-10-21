"use client";

// PROTOTYPE, never merge. All state lives in memory, in this provider: reloading the page
// starts again from the mock data.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CHATS, INITIAL_PROPOSALS, INITIAL_SPECS, SAMPLES_BY_SHAPE } from "./mock-data";
import * as model from "./model";
import type {
  ChatMessage,
  MockProposal,
  Path,
  SampleMessage,
  Selection,
  ShapeId,
  SpecV2,
  Step,
} from "./types";

type State = {
  shape: ShapeId;
  specs: Record<ShapeId, SpecV2 | null>;
  proposals: Record<ShapeId, MockProposal>;
  chats: Record<ShapeId, ChatMessage[]>;
  selection: Selection;
  proposalOn: boolean;
  tryItOn: boolean;
  sampleId: string | null;
};

function initialState(shape: ShapeId = "sorting"): State {
  return {
    shape,
    specs: structuredClone(INITIAL_SPECS),
    proposals: structuredClone(INITIAL_PROPOSALS),
    chats: structuredClone(CHATS),
    selection: null,
    proposalOn: false,
    tryItOn: false,
    sampleId: null,
  };
}

export type Prototype = {
  shape: ShapeId;
  spec: SpecV2 | null;
  proposal: MockProposal;
  /** The proposal is pending and shown on the graph. */
  showingProposal: boolean;
  proposalView: model.ViewTree | null;
  /** The admin edited the graph after the builder proposed: accepting replaces those edits. */
  editedSinceProposal: boolean;
  chat: ChatMessage[];
  view: model.ViewTree;
  selection: Selection;
  /** Editing is off while a proposal is shown: the graph is a preview then. */
  editable: boolean;
  tryItOn: boolean;
  samples: SampleMessage[];
  sample: SampleMessage | null;
  tryResult: model.TryResult | null;
  setShape: (shape: ShapeId) => void;
  select: (selection: Selection) => void;
  insert: (listId: string, index: number, kind: model.NewStepKind) => void;
  updateStep: (id: string, change: (step: Step) => void) => void;
  removeStep: (id: string) => void;
  updatePath: (id: string, change: (path: Path) => void) => void;
  movePath: (id: string, by: -1 | 1) => void;
  addPath: (branchId: string) => void;
  removePath: (id: string) => void;
  setProposalOn: (on: boolean) => void;
  setTryItOn: (on: boolean) => void;
  setSample: (id: string) => void;
  accept: () => void;
  reject: () => void;
  send: (text: string) => void;
  reset: () => void;
};

const Context = createContext<Prototype | null>(null);

export function usePrototype(): Prototype {
  const value = useContext(Context);
  if (value === null) throw new Error("usePrototype outside PrototypeProvider");
  return value;
}

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => initialState());
  const { shape } = state;
  const spec = state.specs[shape];
  const proposal = state.proposals[shape];
  const samples = SAMPLES_BY_SHAPE[shape];
  const showingProposal = state.proposalOn && proposal.status === "proposed";
  const tryItOn = state.tryItOn && spec !== null && !showingProposal;
  const sample = tryItOn
    ? (samples.find((s) => s.id === state.sampleId) ?? samples[0] ?? null)
    : null;

  const tryResult = useMemo(
    () => (spec !== null && sample !== null ? model.tryIt(spec, sample) : null),
    [spec, sample],
  );
  const proposalView = useMemo(
    () =>
      proposal.status === "proposed"
        ? model.buildView(proposal.base, { proposal: proposal.spec })
        : null,
    [proposal],
  );
  const editedSinceProposal = useMemo(
    () => JSON.stringify(spec) !== JSON.stringify(proposal.base),
    [spec, proposal.base],
  );
  const view = useMemo(
    () =>
      showingProposal && proposalView !== null
        ? proposalView
        : model.buildView(spec, { tryIt: tryResult }),
    [spec, showingProposal, proposalView, tryResult],
  );

  const setSpec = useCallback((change: (spec: SpecV2) => SpecV2) => {
    setState((s) => {
      const current = s.specs[s.shape];
      if (current === null) return s;
      return { ...s, specs: { ...s.specs, [s.shape]: change(current) } };
    });
  }, []);

  const value: Prototype = {
    shape,
    spec,
    proposal,
    showingProposal,
    proposalView,
    editedSinceProposal,
    chat: state.chats[shape],
    view,
    selection: state.selection,
    editable: !showingProposal,
    tryItOn,
    samples,
    sample,
    tryResult,
    setShape: (next) => {
      setState((s) => ({ ...s, shape: next, selection: null, sampleId: null }));
    },
    select: (selection) => {
      setState((s) => ({ ...s, selection }));
    },
    insert: (listId, index, kind) => {
      setState((s) => {
        const current = s.specs[s.shape];
        if (current === null) return s;
        const { spec: next, id } = model.insertStep(current, listId, index, kind);
        return { ...s, specs: { ...s.specs, [s.shape]: next }, selection: { kind: "step", id } };
      });
    },
    updateStep: (id, change) => {
      setSpec((current) => model.updateStep(current, id, change));
    },
    removeStep: (id) => {
      setSpec((current) => model.removeStep(current, id));
      setState((s) => ({ ...s, selection: null }));
    },
    updatePath: (id, change) => {
      setSpec((current) => model.updatePath(current, id, change));
    },
    movePath: (id, by) => {
      setSpec((current) => model.movePath(current, id, by));
    },
    addPath: (branchId) => {
      setState((s) => {
        const current = s.specs[s.shape];
        if (current === null) return s;
        const { spec: next, id } = model.addPath(current, branchId);
        return { ...s, specs: { ...s.specs, [s.shape]: next }, selection: { kind: "path", id } };
      });
    },
    removePath: (id) => {
      setSpec((current) => model.removePath(current, id));
      setState((s) => ({ ...s, selection: null }));
    },
    setProposalOn: (on) => {
      setState((s) => ({ ...s, proposalOn: on, tryItOn: on ? false : s.tryItOn, selection: null }));
    },
    setTryItOn: (on) => {
      setState((s) => ({ ...s, tryItOn: on, proposalOn: on ? false : s.proposalOn }));
    },
    setSample: (id) => {
      setState((s) => ({ ...s, sampleId: id }));
    },
    accept: () => {
      setState((s) => {
        const p = s.proposals[s.shape];
        return {
          ...s,
          specs: { ...s.specs, [s.shape]: structuredClone(p.spec) },
          proposals: { ...s.proposals, [s.shape]: { ...p, status: "accepted" } },
          proposalOn: false,
          selection: null,
        };
      });
    },
    reject: () => {
      setState((s) => {
        const p = s.proposals[s.shape];
        return {
          ...s,
          proposals: { ...s.proposals, [s.shape]: { ...p, status: "rejected" } },
          proposalOn: false,
          selection: null,
        };
      });
    },
    send: (text) => {
      setState((s) => {
        const id = String(Date.now());
        const messages: ChatMessage[] = [
          ...s.chats[s.shape],
          { id: `u${id}`, role: "user", text },
          {
            id: `a${id}`,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "(Prototype: the builder doesn't answer here. Edit the graph directly, or reset to start again.)",
              },
            ],
          },
        ];
        return { ...s, chats: { ...s.chats, [s.shape]: messages } };
      });
    },
    reset: () => {
      setState((s) => initialState(s.shape));
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
