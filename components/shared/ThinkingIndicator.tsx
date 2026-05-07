"use client";

import { useEffect, useState } from "react";

export type ThinkingKind =
  | "extract"
  | "transform"
  | "analyze"
  | "upload"
  | "generic";

interface ThinkingIndicatorProps {
  kind?: ThinkingKind;
  inline?: boolean;
  className?: string;
}

// Keep each line ≤ 26 characters so it fits in the fixed-width inline pill
// without truncation. The pill has a stable width regardless of message
// length so surrounding buttons don't shift around.
const MESSAGES: Record<ThinkingKind, readonly string[]> = {
  extract: [
    "reading your rate card…",
    "decoding hieroglyphs…",
    "training my eyes…",
    "extracting rates…",
    "spreadsheet whispering…",
    "wrangling weight breaks…",
  ],
  transform: [
    "applying instruction…",
    "rewriting rate lines…",
    "doing the freight maths…",
    "GST-wrangling…",
    "negotiating the matrix…",
    "asking the oracle…",
  ],
  analyze: [
    "thinking it through…",
    "checking volume tables…",
    "running the model…",
    "asking the data nicely…",
    "lining up zones…",
    "hunting cheap kilos…",
  ],
  upload: [
    "reading your file…",
    "warming up the parser…",
    "shaking out the rows…",
    "lining everything up…",
  ],
  generic: [
    "thinking…",
    "doing the work…",
    "hold tight…",
    "almost there…",
  ],
};

const ROTATE_MS = 1800;
const INLINE_MAX_CHARS = 26;

export default function ThinkingIndicator({
  kind = "generic",
  inline = false,
  className = "",
}: ThinkingIndicatorProps) {
  const messages = MESSAGES[kind];
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % messages.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [messages.length]);

  const dots = (
    <span
      className="inline-flex gap-0.5 items-end"
      aria-hidden="true"
    >
      <Dot delay={0} />
      <Dot delay={150} />
      <Dot delay={300} />
    </span>
  );

  if (inline) {
    const text = messages[idx];
    const display =
      text.length > INLINE_MAX_CHARS ? `${text.slice(0, INLINE_MAX_CHARS - 1)}…` : text;
    return (
      <span
        role="status"
        aria-live="polite"
        title={text}
        className={`inline-flex items-center gap-2 text-tac-muted italic w-[15rem] shrink-0 ${className}`}
      >
        {dots}
        <span className="truncate flex-1 min-w-0">{display}</span>
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 text-sm text-tac-muted italic ${className}`}
    >
      {dots}
      <span>{messages[idx]}</span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="block w-1.5 h-1.5 rounded-full bg-tac-accent"
      style={{
        animation: "tac-bounce 1.2s ease-in-out infinite",
        animationDelay: `${delay}ms`,
      }}
    />
  );
}
