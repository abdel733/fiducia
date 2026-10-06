import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      primary: "button-primary",
      dark: "button-dark",
      lime: "button-lime",
    },
    size: {
      default: "",
      wide: "button-wide",
    },
  },
  defaultVariants: { variant: "primary", size: "default" },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, size, variant, ...props }, ref) => (
  <button className={cn(buttonVariants({ size, variant }), className)} ref={ref} {...props} />
));
Button.displayName = "Button";