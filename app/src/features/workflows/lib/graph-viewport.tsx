"use client";

// Where the workflow graph opens: at full size when it fits, or no smaller than a readable
// zoom, after which the admin scrolls.
import { useReactFlow, type Node } from "@xyflow/react";
import { useEffect, useState, type RefObject } from "react";

/** Space around the drawing, and the smallest zoom it opens at before it scrolls instead. */
export const MARGIN = 24;
const READABLE_ZOOM = 0.75;

/**
 * Opens the drawing at full size when it fits, or shrunk no further than a readable size;
 * past that, it starts at the top, centred on the trigger, and the admin scrolls. A graph
 * hidden when it was drawn (a tab not shown) opens once it has a width.
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
    const zoom = Math.min(1, Math.max(READABLE_ZOOM, room / layout.width));
    const trigger = layout.nodes.find((node) => node.type === "trigger");
    const fits = layout.width * zoom <= room;
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
