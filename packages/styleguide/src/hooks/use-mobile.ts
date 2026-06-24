"use client";

import { useState, useEffect } from "react";

type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * Tailwind v4 breakpoint values (matches @theme in tailwind-theme.css)
 * These are standard Tailwind defaults that rarely change.
 * Hardcoded here since we can't read CSS @theme values at JS runtime.
 */
const BREAKPOINTS: Record<Breakpoint, number> = {
  xs: 400,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

const getBreakpoint = (): Breakpoint => {
  const width = window.innerWidth;
  if (width >= BREAKPOINTS["2xl"]) return "2xl";
  if (width >= BREAKPOINTS.xl) return "xl";
  if (width >= BREAKPOINTS.lg) return "lg";
  if (width >= BREAKPOINTS.md) return "md";
  if (width >= BREAKPOINTS.sm) return "sm";
  return "xs";
};

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const bp = getBreakpoint();
      setIsMobile(bp === "xs" || bp === "sm" || bp === "md");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
};
