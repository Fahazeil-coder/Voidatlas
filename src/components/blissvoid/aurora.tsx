"use client";

/* ---------------------------------------------------------------------------
   Aurora background — animated dot grid with drifting gradient blobs.
   Respects prefers-reduced-motion via CSS (see globals.css).
--------------------------------------------------------------------------- */

export function AuroraBackground({ subtle = false }: { subtle?: boolean }) {
  const opacity = subtle ? 0.5 : 1;
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      style={{ opacity }}
      aria-hidden="true"
    >
      {/* Base */}
      <div className="absolute inset-0 bg-background" />
      {/* Dot grid */}
      <div className="absolute inset-0 dot-grid opacity-70" />
      {/* Aurora blobs */}
      <div
        className="aurora-blob"
        style={{
          width: "46vw",
          height: "46vw",
          left: "-10vw",
          top: "-14vw",
          background:
            "radial-gradient(circle at 40% 40%, rgba(124,92,255,0.22), transparent 65%)",
          animationDelay: "0s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: "42vw",
          height: "42vw",
          right: "-12vw",
          top: "6vh",
          background:
            "radial-gradient(circle at 55% 45%, rgba(61,169,255,0.16), transparent 65%)",
          animationDelay: "-8s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: "38vw",
          height: "38vw",
          left: "22vw",
          bottom: "-18vw",
          background:
            "radial-gradient(circle at 50% 50%, rgba(44,245,208,0.12), transparent 65%)",
          animationDelay: "-16s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: "26vw",
          height: "26vw",
          right: "8vw",
          bottom: "-8vw",
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,107,214,0.09), transparent 65%)",
          animationDelay: "-22s",
        }}
      />
      {/* Vignette to keep edges dark */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(5,6,15,0.5) 100%)",
        }}
      />
    </div>
  );
}
