import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Orientation } from '../../exports/types';

/** A4 at 96 dpi, the width the document is laid out at in the preview. */
const PAGE_WIDTH_PX: Record<Orientation, number> = {
  portrait: 794,
  landscape: 1123,
};

interface PreviewFrameProps {
  html: string;
  orientation: Orientation;
}

/**
 * The document exactly as the PDF and the HTML file have it, shown in a
 * sandboxed frame (no scripts at all) laid out at the page's width and scaled
 * to fit the pane. `allow-same-origin` is there only so the frame's height can
 * be read to size the scroll area; with scripts off nothing in it can run.
 */
export default function PreviewFrame({ html, orientation }: PreviewFrameProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [holderWidth, setHolderWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const pageWidth = PAGE_WIDTH_PX[orientation];

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return undefined;
    setHolderWidth(holder.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() =>
      setHolderWidth(holder.clientWidth),
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  const measure = useCallback(() => {
    // The body, not the page: the page is never shorter than the frame, so a
    // short document could never make it smaller again.
    const body = frameRef.current?.contentDocument?.body;
    const height = body ? Math.ceil(body.getBoundingClientRect().height) : 0;
    if (height) setContentHeight(height + 2);
  }, []);

  // The frame is laid out at the page width, so its height changes with it.
  useEffect(() => {
    measure();
  }, [html, pageWidth, measure]);

  const scale =
    holderWidth > 0 ? Math.min(1, (holderWidth - 8) / pageWidth) : 1;

  return (
    <div className="export-preview" ref={holderRef}>
      <div
        className="export-preview-sheet"
        style={{
          width: pageWidth * scale,
          height: contentHeight ? contentHeight * scale : undefined,
        }}
      >
        <iframe
          ref={frameRef}
          title="Document preview"
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={measure}
          style={{
            width: pageWidth,
            height: contentHeight || 1200,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
