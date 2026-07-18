"use client";

import React, { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatBytes } from "@/lib/utils/format";

interface StorageChartProps {
  usedBytes: number;
  totalBytes: number | null;
}

export function StorageChart({ usedBytes, totalBytes }: StorageChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isUnlimited = totalBytes === null;
  const percentage = isUnlimited
    ? 0
    : Math.min((usedBytes / totalBytes) * 100, 100);

  const data = [
    {
      name: "Used",
      value: usedBytes,
      color: "var(--primary)",
    },
    {
      name: "Remaining",
      value: isUnlimited ? 0 : Math.max(totalBytes - usedBytes, 0),
      color: "var(--secondary)",
    },
  ];

  if (!isUnlimited && usedBytes === 0) {
    data[0].value = 0;
    data[1].value = totalBytes;
  }

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(null);
  };

  return (
    <div className="relative w-full aspect-square max-w-[240px] mx-auto">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip 
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-popover border border-border px-3 py-1.5 rounded-lg shadow-sm text-xs font-medium">
                    <span className="text-muted-foreground mr-2">{payload[0].name}:</span>
                    <span className="text-foreground">{formatBytes(payload[0].value as number)}</span>
                  </div>
                );
              }
              return null;
            }}
          />
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="75%"
            outerRadius="100%"
            cornerRadius={8}
            paddingAngle={0}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            onMouseEnter={onPieEnter}
            onMouseLeave={onPieLeave}
            className="cursor-pointer outline-none"
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                fillOpacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                className="transition-all duration-300 ease-in-out hover:brightness-110"
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-4xl font-bold tracking-tight text-foreground transition-transform duration-300" 
          style={{ transform: activeIndex === 0 ? 'scale(1.1)' : 'scale(1)' }}>
          {isUnlimited ? "∞" : `${percentage.toFixed(0)}%`}
        </span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isUnlimited ? "Unlimited" : "Used"}
        </span>
        <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono">
          {formatBytes(usedBytes)}
        </div>
      </div>
    </div>
  );
}
