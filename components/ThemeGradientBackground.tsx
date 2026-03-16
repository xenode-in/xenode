"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeGradientBackground({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = theme === "system" ? resolvedTheme : theme;

  const getGradient = () => {
    switch (currentTheme) {
      case "xenode-green":
        return "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)";
      case "imperial":
        return "linear-gradient(268deg, #4b1b22 4.2%, #3a151a 98.63%)";
      case "deep-navy":
        return "linear-gradient(268deg, #0f172a 4.2%, #020617 98.63%)";
      case "light":
        return "linear-gradient(268deg, #f8fafc 4.2%, #e2e8f0 98.63%)";
      case "dark":
      default:
        return "linear-gradient(268deg, #09090b 4.2%, #18181b 98.63%)";
    }
  };

  return (
    <div
      className={`absolute inset-0 z-0 transition-opacity duration-700 ${className} ${mounted ? "opacity-100" : "opacity-0"}`}
      style={{
        background: mounted ? getGradient() : "var(--background)",
      }}
    >
      {children}
    </div>
  );
}
