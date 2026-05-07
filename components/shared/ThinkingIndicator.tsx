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

const MESSAGES: Record<ThinkingKind, readonly string[]> = {
  extract: [
    "asking Claude to read your rate card…",
    "decoding rate-card hieroglyphs…",
    "training my eyes on this file…",
    "extracting rates from the wild…",
    "spreadsheet whispering…",
    "wrangling weight breaks…",
  ],
  transform: [
    "applying your instruction…",
    "rewriting rate lines…",
    "doing the freight maths…",
    "GST-wrangling in progress…",
    "negotiating with the rate matrix…",
    "consulting the carrier oracle…",
  ],
  analyze: [
    "thinking through the numbers…",
    "checking volume tables…",
    "running the savings model…",
    "asking the data politely…",
    "lining up zones and weights…",
    "looking for the cheap kilos…",
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
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 text-tac-muted italic ${className}`}
      >
        {dots}
        <span>{messages[idx]}</span>
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
