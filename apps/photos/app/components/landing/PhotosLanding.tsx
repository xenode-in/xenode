import {
  ArrowRight,
  Check,
  Cloud,
  Download,
  Fingerprint,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";

const memories = [
  { className: "photo-sky", label: "Sunday, 8:42 AM" },
  { className: "photo-sunset", label: "Summer, 2026" },
  { className: "photo-forest", label: "Mountain trail" },
  { className: "photo-night", label: "City lights" },
  { className: "photo-flower", label: "Little details" },
];

const features = [
  {
    icon: LockKeyhole,
    title: "Private by design",
    copy: "Your library is encrypted in your browser before it reaches the cloud. Xenode cannot see your photos.",
  },
  {
    icon: Search,
    title: "Find the moment",
    copy: "Move through a clean chronological timeline and organize the memories you want to revisit.",
  },
  {
    icon: Users,
    title: "Share intentionally",
    copy: "Create albums and share selected memories without exposing the rest of your private library.",
  },
];

const faqs = [
  {
    question: "Can Xenode see my photos?",
    answer:
      "No. Photo and video bytes, names, and file keys are encrypted on your device. Xenode stores ciphertext, not a readable copy of your library.",
  },
  {
    question: "What happens on a new device?",
    answer:
      "Sign in to Xenode Accounts and unlock your Vault with your password or recovery kit. Only then can Photos receive its encrypted product key.",
  },
  {
    question: "Can I download my originals?",
    answer:
      "Yes. Your browser decrypts the original on your device when you view or download it.",
  },
];

function Brand() {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="font-[var(--font-brand)] text-2xl font-semibold italic tracking-tight">
        Xenode
      </span>
      <span className="text-sm font-semibold">Photos</span>
    </span>
  );
}

export function PhotosLanding({ signedIn }: { signedIn: boolean }) {
  const primaryHref = signedIn ? "/library" : "/auth/login?next=/library";
  const driveOrigin =
    process.env.DRIVE_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://xenode.in"
      : "http://localhost:3000");
  return (
    <div className="photos-landing min-h-dvh overflow-hidden bg-[#f7f8f5] text-[#111714] dark:bg-[#080b0a] dark:text-[#f4f7f3]">
      <div className="photos-grid fixed inset-0 pointer-events-none" />

      <header className="relative z-20 mx-auto flex h-20 max-w-[1200px] items-center justify-between border-x border-black/8 px-5 dark:border-white/10 md:px-8">
        <Link href="/" aria-label="Xenode Photos home">
          <Brand />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-black/65 dark:text-white/65 md:flex">
          <a className="transition hover:text-current" href="#privacy">
            Privacy
          </a>
          <a className="transition hover:text-current" href="#features">
            Features
          </a>
          <a className="transition hover:text-current" href="#faq">
            FAQ
          </a>
        </nav>
        <Link
          href={primaryHref}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#111714] px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-black"
        >
          {signedIn ? "Open Photos" : "Get started"}
          <ArrowRight size={15} />
        </Link>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-[1200px] items-center gap-14 border-x border-t border-black/8 px-5 py-20 dark:border-white/10 md:min-h-[720px] md:grid-cols-[0.9fr_1.1fr] md:px-8 md:py-28">
          <div className="max-w-xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-emerald-950 shadow-sm dark:border-emerald-200/15 dark:bg-white/5 dark:text-emerald-100">
              <ShieldCheck size={14} />
              End-to-end encrypted
            </div>
            <h1 className="text-balance text-[clamp(3.5rem,7vw,6.7rem)] font-medium leading-[0.88] tracking-[-0.075em]">
              Your life,
              <br />
              <span className="font-[var(--font-brand)] font-normal italic text-emerald-700 dark:text-emerald-300">
                in your eyes only.
              </span>
            </h1>
            <p className="mt-8 max-w-lg text-lg leading-8 text-black/62 dark:text-white/62">
              A beautiful home for your photos and videos—encrypted before
              upload, organized around your memories, and readable only by you.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={primaryHref}
                className="inline-flex h-13 items-center gap-2 rounded-full bg-[#111714] px-7 font-semibold text-white shadow-xl shadow-emerald-950/10 transition hover:-translate-y-0.5 dark:bg-white dark:text-black"
              >
                {signedIn ? "Open your library" : "Start your private library"}
                <ArrowRight size={17} />
              </Link>
              <a
                href="#privacy"
                className="inline-flex h-13 items-center rounded-full border border-black/15 px-7 font-semibold transition hover:bg-black/5 dark:border-white/18 dark:hover:bg-white/5"
              >
                How privacy works
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-black/52 dark:text-white/52">
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} /> Original quality
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} /> No ads
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} /> Your keys
              </span>
            </div>
          </div>

          <div className="relative mx-auto h-[510px] w-full max-w-[610px] md:h-[620px]">
            <div className="absolute inset-[8%_4%_7%_12%] rounded-[3rem] bg-emerald-300/25 blur-3xl dark:bg-emerald-500/15" />
            <div className="absolute left-[8%] top-[4%] w-[57%] rotate-[-5deg] overflow-hidden rounded-[2rem] border-[7px] border-white bg-white shadow-2xl dark:border-[#171c19] dark:bg-[#171c19]">
              <div className="photo-sky aspect-[4/5]" />
              <p className="px-4 py-3 text-sm font-semibold">A quiet morning</p>
            </div>
            <div className="absolute right-[1%] top-[18%] w-[48%] rotate-[7deg] overflow-hidden rounded-[1.7rem] border-[7px] border-white bg-white shadow-2xl dark:border-[#171c19] dark:bg-[#171c19]">
              <div className="photo-sunset aspect-[4/5]" />
              <p className="px-4 py-3 text-sm font-semibold">Golden hour</p>
            </div>
            <div className="absolute bottom-[4%] left-[25%] w-[52%] rotate-[1deg] overflow-hidden rounded-[1.8rem] border-[7px] border-white bg-white shadow-2xl dark:border-[#171c19] dark:bg-[#171c19]">
              <div className="photo-forest aspect-[5/4]" />
              <p className="px-4 py-3 text-sm font-semibold">Worth the climb</p>
            </div>
            <div className="absolute bottom-[20%] left-[2%] grid size-14 place-items-center rounded-2xl bg-white shadow-xl dark:bg-[#171c19]">
              <Heart className="fill-rose-400 text-rose-400" size={22} />
            </div>
            <div className="absolute right-[8%] top-[5%] grid size-12 place-items-center rounded-2xl bg-white shadow-xl dark:bg-[#171c19]">
              <Sparkles className="text-amber-500" size={20} />
            </div>
          </div>
        </section>

        <section
          id="privacy"
          className="mx-auto max-w-[1200px] border-x border-t border-black/8 px-5 py-24 dark:border-white/10 md:px-8 md:py-32"
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">
              Privacy is the product
            </p>
            <h2 className="mt-5 text-balance text-4xl font-medium tracking-[-0.045em] md:text-6xl">
              The cloud holds your photos.
              <br />
              <span className="font-[var(--font-brand)] italic">
                It never gets the keys.
              </span>
            </h2>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-3 md:grid-cols-3">
            {[
              [Upload, "On your device", "Your browser creates a unique file key and encrypts every upload."],
              [Cloud, "In the cloud", "Only encrypted photo bytes and protected metadata are stored."],
              [Download, "Back to you", "Your device receives the key and decrypts the original locally."],
            ].map(([Icon, title, copy], index) => {
              const StepIcon = Icon as typeof Upload;
              return (
                <article
                  key={String(title)}
                  className="relative rounded-3xl border border-black/9 bg-white/75 p-7 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
                >
                  <span className="absolute right-6 top-5 text-xs font-mono text-black/30 dark:text-white/30">
                    0{index + 1}
                  </span>
                  <div className="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
                    <StepIcon size={21} />
                  </div>
                  <h3 className="mt-8 text-xl font-semibold">{String(title)}</h3>
                  <p className="mt-3 leading-7 text-black/58 dark:text-white/58">
                    {String(copy)}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section
          id="features"
          className="mx-auto grid max-w-[1200px] gap-14 border-x border-t border-black/8 px-5 py-24 dark:border-white/10 md:grid-cols-[0.95fr_1.05fr] md:px-8 md:py-32"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">
              Made for remembering
            </p>
            <h2 className="mt-5 max-w-lg text-5xl font-medium leading-[0.98] tracking-[-0.055em] md:text-6xl">
              Less managing.
              <br />
              More <span className="font-[var(--font-brand)] italic">living.</span>
            </h2>
            <div className="mt-12 space-y-4">
              {features.map(({ icon: Icon, title, copy }) => (
                <article
                  key={title}
                  className="flex gap-5 rounded-3xl border border-transparent p-5 transition hover:border-black/8 hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-white/[0.035]"
                >
                  <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-black/10 dark:border-white/12">
                    <Icon size={19} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p className="mt-2 leading-7 text-black/58 dark:text-white/58">
                      {copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="rounded-[2.25rem] border border-black/9 bg-[#e8ece6] p-4 shadow-2xl shadow-black/5 dark:border-white/10 dark:bg-[#111613]">
            <div className="rounded-[1.7rem] bg-white p-4 dark:bg-[#090d0b]">
              <div className="flex items-center justify-between px-2 py-3">
                <Brand />
                <div className="flex gap-2">
                  <span className="grid size-9 place-items-center rounded-full bg-black/5 dark:bg-white/7">
                    <Search size={15} />
                  </span>
                  <span className="grid size-9 place-items-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                    <Upload size={15} />
                  </span>
                </div>
              </div>
              <p className="mb-4 mt-5 px-2 text-sm font-semibold text-black/50 dark:text-white/50">
                Your timeline
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {memories.map((memory, index) => (
                  <div
                    key={memory.label}
                    className={`${memory.className} group relative overflow-hidden rounded-2xl ${
                      index === 0 ? "col-span-2 aspect-[2/1] md:col-span-2" : "aspect-square"
                    }`}
                  >
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-10 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
                      {memory.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-black/[0.035] px-4 py-3 text-xs text-black/45 dark:bg-white/5 dark:text-white/45">
                <span className="inline-flex items-center gap-2">
                  <Fingerprint size={14} /> Encrypted on this device
                </span>
                <span>26 memories</span>
              </div>
            </div>
          </div>
        </section>

        <section
          id="faq"
          className="mx-auto max-w-[1200px] border-x border-t border-black/8 px-5 py-24 dark:border-white/10 md:px-8 md:py-32"
        >
          <div className="grid gap-14 md:grid-cols-[0.7fr_1.3fr]">
            <div>
              <ImageIcon className="text-emerald-700 dark:text-emerald-300" />
              <h2 className="mt-6 text-4xl font-medium tracking-[-0.045em]">
                A few good
                <br />
                questions.
              </h2>
            </div>
            <div className="divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
              {faqs.map((item) => (
                <details key={item.question} className="group py-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold">
                    {item.question}
                    <span className="text-2xl font-light transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pt-4 leading-7 text-black/58 dark:text-white/58">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] border-x border-t border-black/8 px-5 py-20 dark:border-white/10 md:px-8">
          <div className="overflow-hidden rounded-[2.5rem] bg-[#13251d] px-7 py-16 text-center text-white md:px-14 md:py-24">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-300">
              Your memories are yours
            </p>
            <h2 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-medium tracking-[-0.05em] md:text-6xl">
              Give your photos a private place to live.
            </h2>
            <Link
              href={primaryHref}
              className="mt-9 inline-flex h-13 items-center gap-2 rounded-full bg-white px-7 font-semibold text-black transition hover:-translate-y-0.5"
            >
              {signedIn ? "Open Xenode Photos" : "Create your private library"}
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mx-auto flex max-w-[1200px] flex-col gap-7 border-x border-t border-black/8 px-5 py-10 text-sm text-black/48 dark:border-white/10 dark:text-white/48 md:flex-row md:items-center md:justify-between md:px-8">
        <Brand />
        <p>End-to-end encrypted photo storage by Xenode.</p>
        <div className="flex gap-5">
          <a href={`${driveOrigin}/privacy`}>Privacy</a>
          <a href={`${driveOrigin}/terms`}>Terms</a>
        </div>
      </footer>
    </div>
  );
}
