import { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";
import { LandingFooter } from "@/components/landing/LandingFooter";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read Xenode's Terms of Service. Understand the rules, refund policy, and usage guidelines for our end-to-end encrypted cloud storage platform.",
  alternates: {
    canonical: `${BASE_URL}/terms`,
  },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/terms`,
    title: "Terms of Service | Xenode",
    description:
      "Read Xenode's Terms of Service. Understand the rules, refund policy, and usage guidelines for our end-to-end encrypted cloud storage platform.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Xenode Terms of Service",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms of Service | Xenode",
    description:
      "Read Xenode's Terms of Service for end-to-end encrypted cloud storage.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

export default function TermsPage() {
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: BASE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Terms of Service",
        item: `${BASE_URL}/terms`,
      },
    ],
  };

  const lastUpdated = "June 2, 2026";

  return (
    <div className="relative min-h-screen flex flex-col font-sans bg-background text-foreground transition-colors duration-300">
      <ThemeGradientBackground />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd),
        }}
      />

      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{
          backgroundImage: "url('/grain.png')",
        }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex justify-center px-6 md:px-8">
        <article className="w-full max-w-[800px] py-16 md:py-24">
          {/* Header */}
          <header className="mb-12 md:mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Legal
            </p>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-brand italic text-foreground mb-4">
              Terms of Service
            </h1>
            <p className="text-sm text-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          </header>

          {/* Content */}
          <div className="space-y-12 text-foreground/80 leading-relaxed">
            {/* Introduction */}
            <section id="introduction">
              <p className="text-base md:text-lg">
                Welcome to <span className="font-brand italic">Xenode</span> —
                an open-source, end-to-end encrypted cloud storage platform
                built on the belief that privacy and transparency go hand in
                hand. These Terms of Service (&ldquo;Terms&rdquo;) govern your
                access to and use of the Xenode platform, including our
                website, applications, and cloud storage services
                (collectively, the &ldquo;Service&rdquo;). By accessing or using
                the Service, you agree to be bound by these Terms.
              </p>
            </section>

            {/* Section 1 */}
            <section id="acceptance-of-terms">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                1. Acceptance of Terms
              </h2>
              <p className="mb-4">
                By creating an account or using the Service, you acknowledge that
                you have read, understood, and agree to be bound by these Terms
                and our{" "}
                <Link
                  href="/privacy"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  Privacy Policy
                </Link>
                . If you do not agree to these Terms, you must not access or use
                the Service.
              </p>
              <p>
                You must be at least 18 years of age or the age of legal majority
                in your jurisdiction to use this Service. By using the Service,
                you represent and warrant that you meet this requirement.
              </p>
            </section>

            {/* Section 2 */}
            <section id="description-of-service">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                2. Description of Service
              </h2>
              <p className="mb-4">
                Xenode is an open-source, end-to-end encrypted cloud storage
                platform. Our entire codebase is publicly available on{" "}
                <a
                  href="https://github.com/xenode-in/xenode"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  GitHub
                </a>
                , allowing anyone to inspect, audit, and verify our security
                practices. Your files are encrypted on your device before being
                uploaded to our servers — no one, not even Xenode, can read or
                access the contents of your stored files.
              </p>
              <p>
                We reserve the right to modify, suspend, or discontinue any
                aspect of the Service at any time, with or without notice. We
                will make reasonable efforts to notify you of significant changes
                that may affect your use of the Service. As an open-source
                project, all changes to the codebase are publicly tracked.
              </p>
            </section>

            {/* Section 3 */}
            <section id="accounts-and-registration">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                3. Accounts & Registration
              </h2>
              <p className="mb-4">
                To use certain features of the Service, you must register for an
                account. You agree to provide accurate information during
                registration and to keep your account credentials secure.
              </p>
              <p>
                You are solely responsible for all activity that occurs under
                your account. If you suspect any unauthorized use of your
                account, you must notify us immediately. Xenode is not liable for
                any loss or damage arising from unauthorized access to your
                account.
              </p>
            </section>

            {/* Section 4 — Refund Policy */}
            <section id="refund-policy">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                4. Payments & Refund Policy
              </h2>
              <p className="mb-4">
                Xenode offers both free and paid subscription plans. By
                subscribing to a paid plan, you agree to pay the applicable fees
                as described on our{" "}
                <Link
                  href="/pricing"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  Pricing page
                </Link>
                .
              </p>
              <div className="rounded-xl border border-border bg-card/50 p-6 my-6">
                <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary text-sm font-bold">
                    14
                  </span>
                  14-Day Refund Window
                </h3>
                <p className="text-foreground/70">
                  All purchases made on Xenode are eligible for a full refund
                  within <strong className="text-foreground">14 days</strong> of
                  the original purchase date. If you are not satisfied with the
                  Service for any reason, you may request a refund by contacting
                  our support team within this window. Refunds will be processed
                  to the original payment method. After the 14-day period, all
                  purchases are considered final and non-refundable.
                </p>
              </div>
              <p>
                Xenode reserves the right to change its pricing at any time. Any
                price changes will apply to billing cycles starting after the
                date of the change, and you will be notified in advance.
              </p>
            </section>

            {/* Section 5 */}
            <section id="acceptable-use">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                5. Acceptable Use
              </h2>
              <p className="mb-4">You agree not to use the Service to:</p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  Upload, store, or share content that violates any applicable
                  law or regulation.
                </li>
                <li>
                  Infringe upon the intellectual property rights of any third
                  party.
                </li>
                <li>
                  Distribute malware, viruses, or any other harmful software.
                </li>
                <li>
                  Attempt to gain unauthorized access to the Service, other
                  accounts, or any related systems or networks.
                </li>
                <li>
                  Use the Service for any unlawful, fraudulent, or deceptive
                  purpose.
                </li>
                <li>
                  Interfere with or disrupt the integrity or performance of the
                  Service.
                </li>
              </ul>
              <p className="mt-4">
                Violation of this Acceptable Use policy may result in the
                immediate suspension or termination of your account without
                notice.
              </p>
            </section>

            {/* Section 6 */}
            <section id="open-source">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                6. Open Source & Intellectual Property
              </h2>
              <div className="rounded-xl border border-border bg-card/50 p-6 my-4">
                <p className="text-foreground/80">
                  Xenode is proudly open source. Our source code is publicly
                  available on{" "}
                  <a
                    href="https://github.com/xenode-in/xenode"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                  >
                    GitHub
                  </a>
                  , and we encourage the community to review, contribute to, and
                  build upon our work. Contributions to the project are governed
                  by the project&apos;s open-source license as specified in the
                  repository.
                </p>
              </div>
              <p className="mb-4">
                While the codebase is open source, the Xenode name, logo,
                trademarks, and brand assets remain the property of Xenode and
                may not be used without prior written permission, except as
                permitted by the open-source license.
              </p>
              <p>
                You retain full ownership of the files you upload to the Service.
                By using Xenode, you do not grant us any rights to your content,
                and due to our end-to-end encryption, we cannot access your files
                in any case.
              </p>
            </section>

            {/* Section 7 */}
            <section id="data-and-privacy">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                7. Data & Privacy
              </h2>
              <p className="mb-4">
                Your privacy is fundamental to our Service. We do not use your
                personal information — including your name, email address, or any
                related identifying information — for purposes beyond what is
                necessary to operate the Service.
              </p>
              <p>
                For complete details on how we handle your data, please refer to
                our{" "}
                <Link
                  href="/privacy"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </section>

            {/* Section 8 */}
            <section id="termination">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                8. Termination
              </h2>
              <p className="mb-4">
                You may terminate your account at any time by contacting our
                support team or through your account settings. Upon termination,
                your right to use the Service will immediately cease.
              </p>
              <p>
                We may also terminate or suspend your account at our sole
                discretion, without prior notice, if we believe you have violated
                these Terms or engaged in conduct that is harmful to other users,
                Xenode, or third parties.
              </p>
            </section>

            {/* Section 9 */}
            <section id="limitation-of-liability">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                9. Limitation of Liability
              </h2>
              <p className="mb-4">
                To the maximum extent permitted by applicable law, Xenode and its
                affiliates, officers, directors, employees, and agents shall not
                be liable for any indirect, incidental, special, consequential,
                or punitive damages, or any loss of profits, data, use, or
                goodwill arising out of or in connection with your use of the
                Service.
              </p>
              <p className="mb-4">
                Due to the nature of end-to-end encryption, Xenode cannot recover
                your files if you lose your encryption keys or account
                credentials. You are solely responsible for maintaining backups
                of your encryption keys. Our open-source code allows you to
                independently verify these security claims.
              </p>
            </section>

            {/* Section 10 */}
            <section id="disclaimer-of-warranties">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                10. Disclaimer of Warranties
              </h2>
              <p>
                The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
                available&rdquo; basis without warranties of any kind, either
                express or implied, including but not limited to implied
                warranties of merchantability, fitness for a particular purpose,
                and non-infringement. Xenode does not guarantee that the Service
                will be uninterrupted, secure, or error-free.
              </p>
            </section>

            {/* Section 11 */}
            <section id="governing-law">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                11. Governing Law
              </h2>
              <p>
                These Terms shall be governed by and construed in accordance with
                the laws of India, without regard to its conflict of law
                provisions. Any disputes arising under these Terms shall be
                subject to the exclusive jurisdiction of the courts located in
                India.
              </p>
            </section>

            {/* Section 12 */}
            <section id="changes-to-terms">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                12. Changes to These Terms
              </h2>
              <p>
                We reserve the right to update or modify these Terms at any time.
                When we do, we will revise the &ldquo;Last updated&rdquo; date at
                the top of this page. Your continued use of the Service after any
                changes constitutes your acceptance of the updated Terms. We
                encourage you to review these Terms periodically.
              </p>
            </section>

            {/* Section 13 */}
            <section id="contact-us">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                13. Contact Us
              </h2>
              <p className="mb-4">
                If you have any questions about these Terms, please reach out to
                us:
              </p>
              <div className="rounded-xl border border-border bg-card/50 p-6">
                <p className="text-foreground">
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:support@xenode.io"
                    className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                  >
                    support@xenode.io
                  </a>
                </p>
              </div>
            </section>
          </div>
        </article>
      </main>

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
