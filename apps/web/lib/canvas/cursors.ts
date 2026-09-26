import type { Tool } from "@/components/chat/canvas/Toolbar";

function svgCursor(svg: string, hotspotX: number, hotspotY: number, fallback: string): string {
  const encoded = encodeURIComponent(svg);
  return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, ${fallback}`;
}

const PENCIL_CURSOR = svgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 22l1.5-5.5L17 3l4 4L7.5 20.5z" fill="white"/>' +
    '<path d="M15 5l4 4"/>' +
    '</svg>',
  2, 22, "crosshair",
);

const MARKER_CURSOR = svgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 21l2-6 12-12 4 4-12 12z" fill="#fde047" fill-opacity="0.9"/>' +
    '</svg>',
  3, 21, "crosshair",
);

/** The plain browser "crosshair" cursor was showing for every tool,
 * including the pen — swap in a tool-shaped cursor where one makes sense
 * instead of a generic reticle. */
export function cursorForTool(tool: Tool): string {
  switch (tool) {
    case "select": return "default";
    case "pan": return "grab";
    case "draw": return PENCIL_CURSOR;
    case "highlighter": return MARKER_CURSOR;
    default: return "crosshair";
  }
}
