import type { ReactNode } from "react";

export function ThemeGradientBackground({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`theme-gradient-background absolute inset-0 z-0 transition-colors duration-700 ${className}`}
    >
      {children}
    </div>
  );
}
