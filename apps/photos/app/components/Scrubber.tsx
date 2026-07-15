"use client";

export function Scrubber({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <label style={{ display: "grid", gap: 6, color: "#a1a1aa" }}>
      Timeline position
      <input
        aria-label="Timeline position"
        type="range"
        min={0}
        max={Math.max(max, 0)}
        value={Math.min(value, Math.max(max, 0))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
