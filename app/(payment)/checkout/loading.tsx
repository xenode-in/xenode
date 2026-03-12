export default function CheckoutLoading() {
  return (
    <div className="xenode-green min-h-screen w-full bg-background">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-12 lg:flex-row">
        {/* Left skeleton */}
        <div className="w-full space-y-4 lg:w-[380px] lg:shrink-0">
          <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
            <div className="h-10 w-32 animate-pulse rounded bg-white/10" />
            {[1,2,3,4].map(i => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-white/10" />
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
        {/* Right skeleton */}
        <div className="flex-1 space-y-4">
          <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-white/10" />
            ))}
          </div>
          <div className="h-12 w-full animate-pulse rounded-lg bg-white/10" />
        </div>
      </div>
    </div>
  );
}
