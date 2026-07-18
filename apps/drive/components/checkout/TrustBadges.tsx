export default function TrustBadges() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ul className="space-y-2">
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>🔒</span> 256-bit SSL encrypted payment
        </li>
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>✅</span> Cancel anytime — no questions asked
        </li>
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>📧</span> Invoice sent to your email
        </li>
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>🛡️</span> Powered by PayU — PCI DSS compliant
        </li>
      </ul>
    </div>
  );
}
