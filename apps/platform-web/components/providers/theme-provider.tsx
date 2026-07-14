"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

const SUPPORTED_THEMES = ["light", "dark", "system"] as const;

function ThemeValueGuard() {
  const { theme, setTheme } = useTheme();

  React.useEffect(() => {
    if (
      theme &&
      !SUPPORTED_THEMES.includes(theme as (typeof SUPPORTED_THEMES)[number])
    ) {
      setTheme("system");
    }
  }, [setTheme, theme]);

  return null;
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      {...props}
      themes={["light", "dark"]}
    >
      <ThemeValueGuard />
      {children}
    </NextThemesProvider>
  );
}
