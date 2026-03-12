"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useEffect, useState } from "react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system", resolvedTheme } = useTheme();
  // Prevent hydration mismatch
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? resolvedTheme : theme;

  // Define theme-specific styling
  const themeStyles = (() => {
    switch (currentTheme) {
      case "xenode-green":
        return {
          "--normal-bg": "#0f1a12",
          "--normal-text": "#e8e4d9",
          "--normal-border": "rgba(124, 182, 134, 0.2)",
          "--border-radius": "12px",
          "--toast-border": "1px solid rgba(124, 182, 134, 0.3)",
        };
      case "light":
        return {
          "--normal-bg": "#f0f4ff",
          "--normal-text": "#00297a",
          "--normal-border": "rgba(0, 41, 122, 0.1)",
          "--border-radius": "12px",
          "--toast-border": "1px solid rgba(0, 41, 122, 0.2)",
        };
      case "dark":
        return {
          "--normal-bg": "#18181b", // zinc-950
          "--normal-text": "#f4f4f5", // zinc-100
          "--normal-border": "rgba(255, 255, 255, 0.1)",
          "--border-radius": "12px",
          "--toast-border": "1px solid rgba(255, 255, 255, 0.1)",
        };
      default:
        // System fallback
        return {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        };
    }
  })();

  if (!mounted) return null;

  return (
    <Sonner
      theme={currentTheme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        style: {
          background: "var(--normal-bg)",
          color: "var(--normal-text)",
          border: "var(--normal-border)",
          borderRadius: "var(--border-radius)",
        },
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[var(--normal-bg)] group-[.toaster]:text-[var(--normal-text)] group-[.toaster]:border-[var(--toast-border)] group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error:
            "group-[.toaster]:bg-red-500/10 group-[.toaster]:text-red-500 group-[.toaster]:border-red-500/20",
          success:
            "group-[.toaster]:bg-green-500/10 group-[.toaster]:text-green-500 group-[.toaster]:border-green-500/20",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={themeStyles as React.CSSProperties}
      {...props}
    />
  );
};

export { Toaster };
