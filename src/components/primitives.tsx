"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Pointer-driven 3D tilt, matching the feel of the breathing widget on the
 * marketing site. Written straight to `style.transform` rather than through
 * state so a pointer move never triggers a React render.
 */
export function TiltCard({
  children,
  className = "",
  style,
  onClick,
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  max?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.transform = `perspective(700px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-2px)`;
  };

  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`tilt ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

/** Brand-coloured confetti for the three celebration moments. Respects reduced motion. */
export function ConfettiBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = ["#3B9BE8", "#8FC6F5", "#F2695C", "#FFFFFF", "#BAE0FA"];
    let parts = Array.from({ length: 130 }, () => ({
      x: rect.width / 2 + (Math.random() - 0.5) * 90,
      y: rect.height * 0.32 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 11,
      vy: Math.random() * -9 - 2,
      g: Math.random() * 0.12 + 0.14,
      s: Math.random() * 5 + 3,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
      life: Math.random() * 45 + 65,
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, rect.width, rect.height);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.rot += p.vr;
        p.life -= 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 70));
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s / 1.6);
        ctx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, rect.width, rect.height);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 30 }}
    />
  );
}

export function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="press shrink-0 relative rounded-full transition-colors"
      style={{ width: 42, height: 25, backgroundColor: on ? "#3B9BE8" : "#E1E6EC" }}
    >
      <span
        className="absolute rounded-full bg-white transition-[left]"
        style={{
          width: 19,
          height: 19,
          top: 3,
          left: on ? 20 : 3,
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
        }}
      />
    </button>
  );
}

/**
 * Primary pill CTA with the travelling sheen. Disabled state drops the sheen.
 *
 * `type` is a real prop rather than a hardcoded "button": inside a form, a
 * type="button" submit control silently does nothing, which is exactly how the
 * email sign-in step managed to look finished while never firing.
 */
export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-4 rounded-full font-body font-medium text-[14px] press transition-all sheen-wrap ${className}`}
      style={
        disabled
          ? { backgroundColor: "#E9F0F7", color: "#8CA3BD" }
          : {
              backgroundColor: "#3B9BE8",
              color: "#fff",
              boxShadow: "0 12px 28px -8px rgba(59,155,232,0.5)",
            }
      }
    >
      {children}
      {!disabled && <span className="sheen" aria-hidden="true" />}
    </button>
  );
}
