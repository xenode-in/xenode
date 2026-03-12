"use client";

interface PaymentMethodToggleProps {
  value: "autopay" | "direct";
  onChange: (v: "autopay" | "direct") => void;
}

const methods = [
  {
    id: "autopay" as const,
    label: "Auto Pay",
    badge: "UPI Mandate",
    description: "Charged automatically every month via UPI Autopay.",
    detail: "Best for set & forget",
    icon: "🔄",
  },
  {
    id: "direct" as const,
    label: "Direct Payment",
    badge: "One-time",
    description: "Pay manually each cycle. UPI, Card, Net Banking.",
    detail: "Best for full control",
    icon: "💳",
  },
];

export default function PaymentMethodToggle({ value, onChange }: PaymentMethodToggleProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {methods.map((m) => {
        const selected = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={[
              "flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all",
              selected
                ? "border-primary bg-primary/10 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/50 hover:bg-card/80",
            ].join(" ")}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-lg">{m.icon}</span>
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {m.badge}
              </span>
            </div>
            <p className={`text-sm font-semibold ${selected ? "text-foreground" : "text-muted-foreground"}`}>
              {m.label}
            </p>
            <p className="text-xs text-muted-foreground">{m.description}</p>
            <p className={`text-[10px] font-medium ${selected ? "text-primary" : "text-muted-foreground"}`}>
              {m.detail}
            </p>
          </button>
        );
      })}
    </div>
  );
}
