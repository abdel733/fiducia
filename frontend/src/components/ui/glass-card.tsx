import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: "sunrise" | "mint" | "violet";
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = "sunrise", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass-card", `glass-card--${glow}`, className)}
      {...props}
    />
  ),
);

GlassCard.displayName = "GlassCard";
