"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export function MinimalThemeSelector() {
  const { setTheme, theme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md border border-border/50 bg-background/50 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 bg-background border-border">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer flex items-center gap-2">
          <Sun className="h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer flex items-center gap-2">
          <Moon className="h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Custom Themes</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={() => setTheme("xenode-green")} className="cursor-pointer flex items-center gap-2">
          <div className="h-4 w-4 rounded-full bg-[#7cb686] border border-black/20" />
          <span>Xenode Green</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("imperial")} className="cursor-pointer flex items-center gap-2">
          <div className="h-4 w-4 rounded-full bg-[#a33243] border border-black/20" />
          <span>Imperial</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("deep-navy")} className="cursor-pointer flex items-center gap-2">
          <div className="h-4 w-4 rounded-full bg-[#3b82f6] border border-black/20" />
          <span>Deep Navy</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}