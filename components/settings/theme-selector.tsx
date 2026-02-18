"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = [
  {
    id: "system",
    name: "System",
    colors: {
      bg: "bg-zinc-100 dark:bg-zinc-900",
      primary: "bg-zinc-900 dark:bg-zinc-100",
    },
  },
  {
    id: "light",
    name: "Light",
    colors: {
      bg: "bg-[#f0f4ff]",
      primary: "bg-[#00297a]",
    },
  },
  {
    id: "dark",
    name: "Dark",
    colors: {
      bg: "bg-zinc-950",
      primary: "bg-zinc-100",
    },
  },
  {
    id: "imperial",
    name: "Imperial Blue",
    colors: {
      bg: "bg-[#000818]",
      primary: "bg-[#1664ff]",
    },
  },
  {
    id: "deep-navy",
    name: "Deep Navy",
    colors: {
      bg: "bg-[#000613]",
      primary: "bg-[#075aff]",
    },
  },
  {
    id: "xenode-green",
    name: "Xenode Green",
    colors: {
      bg: "bg-[#0f1a12]",
      primary: "bg-[#7cb686]",
    },
  },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {themes.map((item) => (
        <button
          key={item.id}
          onClick={() => setTheme(item.id)}
          className={cn(
            "group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition-all hover:bg-accent",
            mounted && theme === item.id ? "border-primary" : "border-border",
          )}
        >
          <div className="aspect-video w-full overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
            <div className={cn("h-full w-full", item.colors.bg)}>
              <div
                className={cn(
                  "ml-2 mt-2 h-1/2 w-3/4 rounded-tl-md border-l border-t border-border/10 shadow-sm",
                  item.colors.primary === "bg-zinc-100" // handle special checks if needed
                    ? "bg-zinc-100"
                    : item.colors.bg, // base it on the theme preview
                )}
                style={{
                  backgroundColor:
                    item.id === "light"
                      ? "#ffffff"
                      : item.id === "system"
                        ? ""
                        : item.id.includes("dark")
                          ? "#000000"
                          : undefined,
                }}
              >
                {/* Visual representation of the theme */}
                <div className="flex h-full flex-col p-2">
                  <div
                    className={cn(
                      "h-2 w-1/2 rounded-full opacity-40",
                      item.colors.primary,
                    )}
                  />
                  <div
                    className={cn(
                      "mt-2 h-2 w-3/4 rounded-full opacity-20",
                      item.colors.primary,
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
          <span className="text-sm font-medium">{item.name}</span>
          {mounted && theme === item.id && (
            <div className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground shadow-sm">
              <Check className="h-3 w-3" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
