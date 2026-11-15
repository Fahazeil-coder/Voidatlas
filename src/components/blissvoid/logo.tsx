"use client";

import { motion } from "framer-motion";

/* ---------------------------------------------------------------------------
   BLISSVOID logo — orbit / void-ring glyph with the Bliss gradient.
--------------------------------------------------------------------------- */

export function LogoGlyph({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="blissGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C5CFF" />
          <stop offset="0.52" stopColor="#3DA9FF" />
          <stop offset="1" stopColor="#2CF5D0" />
        </linearGradient>
        <radialGradient id="voidCore" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#7C5CFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#05060F" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Outer orbit ring */}
      <ellipse
        cx="24"
        cy="24"
        rx="19"
        ry="8.5"
        stroke="url(#blissGrad)"
        strokeWidth="2.4"
        transform="rotate(-24 24 24)"
        opacity="0.95"
      />
      {/* Inner void ring */}
      <circle cx="24" cy="24" r="10.5" stroke="url(#blissGrad)" strokeWidth="2.4" opacity="0.55" />
      {/* Core glow */}
      <circle cx="24" cy="24" r="6" fill="url(#voidCore)" />
      <circle cx="24" cy="24" r="2.6" fill="#F2F4FF" />
      {/* Orbiting satellite */}
      {animate && (
        <g className="orbit-spin" style={{ transformOrigin: "24px 24px" }}>
          <circle cx="24" cy="4.5" r="2.6" fill="#2CF5D0" />
        </g>
      )}
    </svg>
  );
}

export function LogoWordmark({
  size = "md",
  showGlyph = true,
}: {
  size?: "sm" | "md" | "lg";
  showGlyph?: boolean;
}) {
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-lg";
  const glyph = size === "lg" ? 40 : size === "sm" ? 24 : 32;
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      {showGlyph && <LogoGlyph size={glyph} animate={false} />}
      <span
        className={`wordmark font-[family-name:var(--font-space)] font-bold tracking-[0.18em] ${cls}`}
        style={{
          background: "linear-gradient(135deg,#F2F4FF 0%,#A8AECF 55%,#2CF5D0 130%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        BLISSVOID
      </span>
    </span>
  );
}

/* Animated hero version of the glyph — big, slow, mesmerizing */
export function LogoHero({ size = 180 }: { size?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 90, damping: 18 }}
      className="relative"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle,rgba(124,92,255,0.4),rgba(61,169,255,0.18) 45%,transparent 70%)" }}
      />
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="heroGrad" x1="20" y1="20" x2="180" y2="180" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7C5CFF" />
            <stop offset="0.5" stopColor="#3DA9FF" />
            <stop offset="1" stopColor="#2CF5D0" />
          </linearGradient>
        </defs>
        <g className="orbit-spin" style={{ transformOrigin: "100px 100px" }}>
          <ellipse cx="100" cy="100" rx="88" ry="36" stroke="url(#heroGrad)" strokeWidth="2" transform="rotate(-20 100 100)" opacity="0.9" />
        </g>
        <g className="orbit-spin-rev" style={{ transformOrigin: "100px 100px" }}>
          <ellipse cx="100" cy="100" rx="88" ry="36" stroke="url(#heroGrad)" strokeWidth="1.4" transform="rotate(52 100 100)" opacity="0.55" />
        </g>
        <circle cx="100" cy="100" r="44" stroke="url(#heroGrad)" strokeWidth="2.4" opacity="0.7" />
        <circle cx="100" cy="100" r="26" fill="rgba(124,92,255,0.12)" />
        <circle cx="100" cy="100" r="7" fill="#F2F4FF" />
        <circle cx="100" cy="100" r="12" stroke="#2CF5D0" strokeWidth="1" opacity="0.8" className="ripple-out" style={{ transformOrigin: "100px 100px" }} />
        <g className="orbit-spin" style={{ transformOrigin: "100px 100px" }}>
          <circle cx="100" cy="12" r="4.5" fill="#2CF5D0" />
        </g>
      </svg>
    </motion.div>
  );
}
