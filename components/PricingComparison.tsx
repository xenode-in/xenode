"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface PricingData {
  provider: string;
  price: number;
  isXenode: boolean;
}

const regularData: PricingData[] = [
  { provider: "Xenode", price: 699, isXenode: true },
  { provider: "AWS S3", price: 6140, isXenode: false },
  { provider: "Google Cloud", price: 5800, isXenode: false },
  { provider: "Azure Blob", price: 5600, isXenode: false },
];

const earlyBirdData: PricingData[] = [
  { provider: "Xenode", price: 499, isXenode: true },
  { provider: "AWS S3", price: 6140, isXenode: false },
  { provider: "Google Cloud", price: 5800, isXenode: false },
  { provider: "Azure Blob", price: 5600, isXenode: false },
];

const XENODE_COLOR = "#7cb686";
const OTHER_COLOR = "#4a5a4d";

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: PricingData;
    value: number;
  }>;
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-[#1a2e1d] border border-white/20 rounded-lg px-4 py-3 shadow-xl">
        <p className="font-semibold text-[#e8e4d9]">{data.provider}</p>
        <p className="text-[#7cb686] text-lg font-bold">
          ₹{data.price.toLocaleString("en-IN")}/mo
        </p>
        {data.isXenode && (
          <p className="text-xs text-[#e8e4d9]/60 mt-1">
            Save up to 10× vs others
          </p>
        )}
      </div>
    );
  }
  return null;
};

export default function PricingComparison() {
  const [pricingType, setPricingType] = useState<"earlybird" | "regular">(
    "earlybird",
  );

  const data = pricingType === "earlybird" ? earlyBirdData : regularData;
  const xenodePrice = data.find((d) => d.isXenode)?.price || 0;
  const spotsLeft = 50; // This could be dynamic from an API

  return (
    <section className="w-full py-20 px-8">
      <div className="max-w-[900px] mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold mb-4 text-[#e8e4d9]">
            <span className="font-brand italic">Xenode</span> vs Traditional
            Cloud Storage
          </h2>
          <p className="text-lg text-[#e8e4d9]/70 max-w-xl mx-auto">
            Same usage. Up to 10× lower cost. No hidden fees.
          </p>
        </div>

        {/* Pricing Toggle */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex bg-white/5 border border-white/10 rounded-full p-1">
            <button
              onClick={() => setPricingType("earlybird")}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                pricingType === "earlybird"
                  ? "bg-[#7cb686] text-[#1a2e1d]"
                  : "text-[#e8e4d9]/70 hover:text-[#e8e4d9]"
              }`}
            >
              Early Bird
              <span className="ml-2 text-xs opacity-80">Save ₹200/mo</span>
            </button>
            <button
              onClick={() => setPricingType("regular")}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                pricingType === "regular"
                  ? "bg-[#7cb686] text-[#1a2e1d]"
                  : "text-[#e8e4d9]/70 hover:text-[#e8e4d9]"
              }`}
            >
              Regular Pricing
            </button>
          </div>
        </div>

        {/* Scenario Badge */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-[#e8e4d9]/70">
            <span>📦 1 TB Storage</span>
            <span className="w-1 h-1 bg-[#e8e4d9]/40 rounded-full" />
            <span>📤 3TB Egress/mo</span>
          </div>
        </div>

        {/* Pricing Breakdown */}
        <div className="mt-12 grid md:grid-cols-2 gap-6">
          {/* Xenode Card */}
          <div className="bg-[#7cb686]/10 border border-[#7cb686]/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-[#e8e4d9]">
                <span className="font-brand italic">Xenode</span>
              </h3>
              {pricingType === "earlybird" && (
                <span className="text-xs bg-[#7cb686] text-[#1a2e1d] px-2 py-1 rounded-full font-medium">
                  Early Bird
                </span>
              )}
            </div>
            <div className="mb-4">
              <span className="text-4xl font-bold text-[#7cb686]">
                ₹{xenodePrice.toLocaleString("en-IN")}
              </span>
              <span className="text-[#e8e4d9]/70">/month</span>
              {pricingType === "earlybird" && (
                <span className="ml-2 text-sm text-[#e8e4d9]/50 line-through">
                  ₹699
                </span>
              )}
            </div>
            <ul className="space-y-2 text-sm text-[#e8e4d9]/80">
              <li className="flex items-center gap-2">
                <span className="text-[#7cb686]">✓</span> 1 TB Storage included
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#7cb686]">✓</span> 500 GB Egress included
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#7cb686]">✓</span> S3-compatible API
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#7cb686]">✓</span> Data centers in India
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#7cb686]">✓</span> No hidden fees
              </li>
            </ul>
          </div>

          {/* Others Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-xl font-semibold text-[#e8e4d9] mb-4">
              Traditional Providers
            </h3>
            <div className="mb-4">
              <span className="text-4xl font-bold text-[#e8e4d9]/60">
                ₹5,600+
              </span>
              <span className="text-[#e8e4d9]/50">/month</span>
            </div>
            <ul className="space-y-2 text-sm text-[#e8e4d9]/60">
              <li className="flex items-center gap-2">
                <span className="text-[#e8e4d9]/40">•</span> Complex pricing
                tiers
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#e8e4d9]/40">•</span> High egress costs
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#e8e4d9]/40">•</span> Currency conversion
                fees
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#e8e4d9]/40">•</span> Latency from
                overseas
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[#e8e4d9]/40">•</span> Data sovereignty
                concerns
              </li>
            </ul>
          </div>
        </div>

        {/* Chart - Hidden on mobile, shown on tablet and up */}
        <div className="hidden md:block bg-white/5 border border-white/10 rounded-2xl p-4 md:p-8 mt-10">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart
              data={data}
              margin={{ top: 30, right: 10, left: 0, bottom: 10 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.1)"
                vertical={false}
              />
              <XAxis
                dataKey="provider"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#e8e4d9", fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#e8e4d9", fontSize: 11, opacity: 0.6 }}
                tickFormatter={(value) => `₹${(value / 1000).toFixed(1)}k`}
                width={50}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
              />
              <Bar
                dataKey="price"
                radius={[6, 6, 0, 0]}
                animationDuration={500}
                animationEasing="ease-out"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isXenode ? XENODE_COLOR : OTHER_COLOR}
                  />
                ))}
                <LabelList
                  dataKey="price"
                  position="top"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) =>
                    typeof value === "number"
                      ? `₹${value.toLocaleString("en-IN")}`
                      : String(value ?? "")
                  }
                  fill="#e8e4d9"
                  fontSize={12}
                  fontWeight={600}
                  offset={8}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#7cb686]" />
              <span className="text-[#e8e4d9] text-sm font-medium">
                <span className="font-brand italic">Xenode</span> —{" "}
                <span className="text-[#7cb686] font-bold">
                  ₹{xenodePrice.toLocaleString("en-IN")}/mo
                </span>
              </span>
            </div>
            <div className="hidden sm:block w-1 h-1 bg-[#e8e4d9]/40 rounded-full" />
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#4a5a4d]" />
              <span className="text-[#e8e4d9]/70 text-sm">Other providers</span>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <p className="text-center text-sm text-[#e8e4d9]/50 mt-8">
          Pricing is approximate and based on public pricing as of 2026. Actual
          costs may vary. Early bird pricing valid for first 50 users only.
        </p>
      </div>
    </section>
  );
}
