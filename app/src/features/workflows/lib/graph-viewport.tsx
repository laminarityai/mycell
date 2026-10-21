"use client";

// Where the workflow graph opens: at full size, shrunk a little when that makes it fit, and
// otherwise at full size with the admin scrolling. Zooming out is on the graph's controls.
import { useReactFlow, type Node } from "@xyflow/react";
import { useEffect, useState, type RefObject } from "react";

/** Space around the drawing, and the smallest zoom it shrinks to so that it fits. */
export const MARGIN = 24;
const SMALLEST_FIT = 0.9;

/**
 * Opens the drawing at full size when it fits, or shrunk to fit when that keeps it at least
 * 90%; past that, it opens at full size at the top, centred on the trigger, and the admin
 * scrolls. A graph hidden when it was drawn (a tab not shown) opens once it has a width.
 */
export function OpenReadable({
  layout,
  wrapper,
  top,
  editing,
}: {
  layout: { nodes: Node[]; width: number };
  wrapper: RefObject<HTMLDivElement | null>;
  /** Where the drawing's top starts in the frame. */
  top: number;
  /** The admin is editing: their edits change the drawing, but don't move it under them. */
  editing: boolean;
}) {
  const { setViewport } = useReactFlow();
  const width = useWidth(wrapper);
  const shape = editing
    ? "editing"
    : layout.nodes
        .map((node) => `${node.id}@${String(node.position.x)},${String(node.position.y)}`)
        .join();
  const shown = width > 0;
  useEffect(() => {
    if (!shown) return;
    const room = width - 2 * MARGIN;
    const fitting = room / layout.width;
    const fits = fitting >= SMALLEST_FIT;
    const zoom = fits ? Math.min(1, fitting) : 1;
    const trigger = layout.nodes.find((node) => node.type === "trigger");
    const center =
      fits || trigger === undefined
        ? layout.width / 2
        : trigger.position.x + (trigger.width ?? 0) / 2;
    void setViewport({ x: width / 2 - center * zoom, y: top, zoom });
    // Re-open only when the drawing's shape changes or it's first shown, not on every Try it,
    // redraw or resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, shown, top, setViewport]);
  return null;
}

/** The element's width, kept up to date; 0 while it isn't shown. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
