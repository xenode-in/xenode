import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Cloud,
  Fingerprint,
  HardDrive,
  Image as ImageIcon,
  Laptop,
  Link2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from "@xenode/ui";
import { AccountShell } from "@/components/AccountShell";
import {
  loadOrganizations,
  loadProfile,
  loadSecurityActivity,
  loadUsage,
} from "@/lib/hub-data";
import { bytesLabel, usagePercent } from "@/lib/presentation";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

const sections = [
  {
    title: "Profile",
    href: "/profile",
    description: "Name, username, verified email, and encryption preferences.",
    icon: UserRound,
    accent: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  {
    title: "Sign-in methods",
    href: "/linked-accounts",
    description: "Manage your password, Google, and GitHub connections.",
    icon: Link2,
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  {
    title: "Security",
    href: "/security",
    description: "Review Vault changes, sign-ins, and encrypted handoffs.",
    icon: ShieldCheck,
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  {
    title: "Devices",
    href: "/devices",
    description: "See active Drive and Photos sessions and revoke access.",
    icon: Laptop,
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  {
    title: "Organizations",
    href: "/organizations",
    description: "Memberships, roles, and organization workspaces.",
    icon: Building2,
    accent: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
  },
  {
    title: "Usage",
    href: "/usage",
    description: "Storage totals, activity counts, and plan information.",
    icon: BarChart3,
    accent: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  },
] as const;

export default async function AccountsHome() {
  const session = await requireUnlockedAccountsPageSession("/");
  const [profile, organizations, usage, activity] = await Promise.all([
    loadProfile(session.user.id),
    loadOrganizations(session.user.id),
    loadUsage(session.user.id),
    loadSecurityActivity(session.user.id),
  ]);
  const storagePercent = usagePercent(
    usage.storageBytes,
    usage.storageLimitBytes,
  );
  const firstName =
    (profile.name || session.user.name || "there").trim().split(/\s+/u)[0] ??
    "there";
  const driveOrigin =
    process.env.DRIVE_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://xenode.in"
      : "http://localhost:3000");
  const photosOrigin =
    process.env.PHOTOS_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://photos.xenode.in"
      : "http://localhost:3002");

  return (
    <AccountShell user={session.user}>
      <main className="mx-auto w-full max-w-[1200px] px-5 py-10 md:px-8 md:py-14">
        <section className="grid items-end gap-8 border-b border-border/70 pb-10 lg:grid-cols-[1fr_auto]">
          <div>
            <Badge
              variant="outline"
              className="mb-5 gap-1.5 bg-background/60 px-3 py-1.5 backdrop-blur"
            >
              <ShieldCheck className="text-emerald-600" />
              Vault unlocked
            </Badge>
            <h1 className="max-w-3xl text-balance text-4xl font-medium tracking-[-0.05em] md:text-6xl">
              Good to see you, {firstName}.
              <br />
              <span className="font-brand font-normal italic text-primary">
                Your account is secure.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              One identity for Xenode products. Authentication stays in
              Accounts, while every product receives only its encrypted Space
              key.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" asChild>
              <a href={`${driveOrigin}/dashboard`}>
                <HardDrive />
                Open Drive
              </a>
            </Button>
            <Button size="lg" asChild>
              <a href={`${photosOrigin}/library`}>
                <ImageIcon />
                Open Photos
              </a>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="gap-4 bg-card/78 py-5 backdrop-blur">
            <CardHeader className="px-5">
              <CardDescription>Account protection</CardDescription>
              <CardTitle className="flex items-center gap-2 text-xl">
                <LockKeyhole className="size-5 text-emerald-600" />
                E2EE active
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 text-xs text-muted-foreground">
              Password-backed Vault
            </CardContent>
          </Card>

          <Card className="gap-4 bg-card/78 py-5 backdrop-blur">
            <CardHeader className="px-5">
              <CardDescription>Storage used</CardDescription>
              <CardTitle className="text-xl">
                {bytesLabel(usage.storageBytes)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5">
              <Progress value={storagePercent} />
              <p className="text-xs text-muted-foreground">
                {storagePercent}% of {bytesLabel(usage.storageLimitBytes)}
              </p>
            </CardContent>
          </Card>

          <Card className="gap-4 bg-card/78 py-5 backdrop-blur">
            <CardHeader className="px-5">
              <CardDescription>Organizations</CardDescription>
              <CardTitle className="text-xl">
                {organizations.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 text-xs text-muted-foreground">
              {organizations.length === 1
                ? "1 active workspace"
                : `${organizations.length} active workspaces`}
            </CardContent>
          </Card>

          <Card className="gap-4 bg-card/78 py-5 backdrop-blur">
            <CardHeader className="px-5">
              <CardDescription>Active products</CardDescription>
              <CardTitle className="text-xl">
                {usage.activeProducts.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5 px-5">
              {usage.activeProducts.length ? (
                usage.activeProducts.map((product) => (
                  <Badge key={product} variant="secondary">
                    {product}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No active sessions
                </span>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-8 border-t border-border/70 pt-9 lg:grid-cols-[1fr_340px]">
          <div>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Account settings
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  Manage your Xenode identity
                </h2>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sections.map(
                ({ title, href, description, icon: Icon, accent }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group rounded-2xl border border-border/80 bg-card/75 p-5 shadow-sm backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span
                        className={`grid size-11 place-items-center rounded-xl ${accent}`}
                      >
                        <Icon className="size-5" />
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                    <h3 className="mt-5 font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {description}
                    </p>
                  </Link>
                ),
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <Card className="gap-5 bg-[#092153] text-white shadow-xl shadow-primary/10 dark:bg-card dark:text-card-foreground">
              <CardHeader>
                <div className="mb-2 grid size-11 place-items-center rounded-xl bg-white/10 text-blue-100 dark:bg-primary/10 dark:text-primary">
                  <Fingerprint className="size-5" />
                </div>
                <CardTitle>Zero-knowledge by design</CardTitle>
                <CardDescription className="leading-6 text-blue-100/70 dark:text-muted-foreground">
                  Your ARK stays in this browser. OAuth tokens and product
                  sessions never become encryption keys.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="secondary"
                  className="w-full bg-white text-[#092153] hover:bg-blue-50 dark:bg-secondary dark:text-secondary-foreground"
                  asChild
                >
                  <Link href="/security">
                    Review security
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="gap-4 bg-card/78 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  Recent activity
                  <Badge variant="outline">{activity.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {activity.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 border-b border-border/70 pb-4 last:border-0 last:pb-0"
                  >
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {event.label}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.productId ?? "Xenode Accounts"}
                      </p>
                    </div>
                  </div>
                ))}
                {!activity.length ? (
                  <p className="text-sm text-muted-foreground">
                    Security activity will appear here.
                  </p>
                ) : null}
                <Button variant="ghost" className="w-full" asChild>
                  <Link href="/security">
                    View full activity
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
              <Cloud className="size-4 text-primary" />
              <span className="flex-1">Account ID and keys stay separate</span>
              <Check className="size-4 text-emerald-600" />
            </div>
          </aside>
        </section>
      </main>
    </AccountShell>
  );
}
