"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SelectionValue = {
  selected: ReadonlySet<string>;
  toggle(id: string): void;
  clear(): void;
};

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionController({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const value = useMemo<SelectionValue>(
    () => ({
      selected,
      toggle(id) {
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      clear() {
        setSelected(new Set());
      },
    }),
    [selected],
  );
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function usePhotoSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("SelectionController is required");
  return value;
}
