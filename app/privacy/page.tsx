import { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";
import { LandingFooter } from "@/components/landing/LandingFooter";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Xenode's Privacy Policy. Learn how we protect your data with end-to-end encryption and our commitment to never using your personal information.",
  alternates: {
    canonical: `${BASE_URL}/privacy`,
  },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/privacy`,
    title: "Privacy Policy | Xenode",
    description:
      "Xenode's Privacy Policy. Learn how we protect your data with end-to-end encryption and our commitment to never using your personal information.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Xenode Privacy Policy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy | Xenode",
    description:
      "Learn how Xenode protects your data with end-to-end encryption.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

export default function PrivacyPage() {
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
        name: "Privacy Policy",
        item: `${BASE_URL}/privacy`,
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
              Privacy Policy
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
                At <span className="font-brand italic">Xenode</span>, privacy
                isn&apos;t a feature — it&apos;s the foundation. As an
                open-source project, we believe transparency is the strongest
                form of trust. This Privacy Policy explains what data we
                collect, how we use it, and the lengths we go to in order to
                protect your information. You don&apos;t just have to take our
                word for it — our entire codebase is publicly available on{" "}
                <a
                  href="https://github.com/santhoshkumar-dev/Xenode"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  GitHub
                </a>{" "}
                for anyone to audit and verify.
              </p>
            </section>

            {/* Section 1 */}
            <section id="our-commitment">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                1. Our Commitment to Your Privacy
              </h2>
              <div className="rounded-xl border border-border bg-card/50 p-6 my-4">
                <p className="text-foreground/80 text-base md:text-lg">
                  <strong className="text-foreground">
                    We do not use your personal information.
                  </strong>{" "}
                  Your name, email address, and any other personally
                  identifiable information you provide is used solely for
                  account authentication and service operation. We will never
                  sell, rent, or share your personal data with third parties for
                  their marketing purposes.
                </p>
              </div>
            </section>

            {/* Section 2 */}
            <section id="information-we-collect">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                2. Information We Collect
              </h2>

              <h3 className="text-lg font-semibold text-foreground mt-6 mb-3">
                2.1 Account Information
              </h3>
              <p className="mb-4">
                When you create an account, we collect the minimum information
                necessary to provide the Service, such as your email address and
                authentication credentials. This information is used solely for:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70 mb-4">
                <li>Account creation and authentication</li>
                <li>Communicating with you about your account</li>
                <li>Providing customer support</li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6 mb-3">
                2.2 File Data
              </h3>
              <p className="mb-4">
                All files stored on Xenode are protected with end-to-end
                encryption (AES-256). Your files are encrypted on your device
                before being transmitted to our servers. This means:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70 mb-4">
                <li>
                  <strong className="text-foreground">
                    We cannot read your files.
                  </strong>{" "}
                  Not even Xenode employees can access the contents of your
                  stored data.
                </li>
                <li>
                  <strong className="text-foreground">
                    We cannot share what we don&apos;t have.
                  </strong>{" "}
                  Since your encryption keys never leave your device, your data
                  remains yours alone.
                </li>
                <li>
                  <strong className="text-foreground">
                    Zero-knowledge architecture.
                  </strong>{" "}
                  We store only encrypted blobs with no knowledge of their
                  contents.
                </li>
              </ul>

              <h3 className="text-lg font-semibold text-foreground mt-6 mb-3">
                2.3 Usage & Technical Data
              </h3>
              <p>
                We may collect basic, anonymized usage data to improve the
                Service, such as browser type, operating system, and general
                interaction patterns. This data is aggregated and cannot be used
                to identify individual users.
              </p>
            </section>

            {/* Section 3 */}
            <section id="how-we-use-information">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                3. How We Use Your Information
              </h2>
              <p className="mb-4">
                We use the limited information we collect exclusively for the
                following purposes:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  <strong className="text-foreground">
                    Operating the Service:
                  </strong>{" "}
                  Account management, authentication, and customer support.
                </li>
                <li>
                  <strong className="text-foreground">
                    Service improvements:
                  </strong>{" "}
                  Analyzing aggregated, anonymized usage patterns to enhance
                  performance, reliability, and user experience.
                </li>
                <li>
                  <strong className="text-foreground">
                    Security & compliance:
                  </strong>{" "}
                  Preventing fraud, abuse, and unauthorized access to the
                  Service.
                </li>
              </ul>
            </section>

            {/* Section 4 — Promotional Communications */}
            <section id="promotional-communications">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                4. Promotional Communications
              </h2>
              <div className="rounded-xl border border-border bg-card/50 p-6 my-4">
                <p className="text-foreground/80">
                  From time to time, we may use your email address to send you
                  information about promotional campaigns, special offers,
                  product updates, or new features related to Xenode. These
                  communications are intended to keep you informed about
                  improvements and value we can offer.
                </p>
                <div className="mt-4 pt-4 border-t border-border/50">
                  <p className="text-foreground/70 text-sm">
                    <strong className="text-foreground">Your choice:</strong>{" "}
                    You can opt out of promotional emails at any time by
                    clicking the unsubscribe link included in every promotional
                    email, or by contacting our support team. Opting out of
                    promotional emails will not affect essential service
                    communications (e.g., billing confirmations, security
                    alerts).
                  </p>
                </div>
              </div>
            </section>

            {/* Section 5 */}
            <section id="data-sharing">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                5. Data Sharing & Third Parties
              </h2>
              <p className="mb-4">
                We do not sell or rent your personal information to third
                parties. We may share limited information only in the following
                circumstances:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  <strong className="text-foreground">
                    Payment processors:
                  </strong>{" "}
                  To process payments securely (e.g., Razorpay). Payment
                  processors handle your billing information directly and are
                  bound by their own privacy policies.
                </li>
                <li>
                  <strong className="text-foreground">
                    Legal requirements:
                  </strong>{" "}
                  If required by law, regulation, or legal process, we may
                  disclose information to comply with valid legal obligations.
                  However, due to our zero-knowledge architecture, file contents
                  remain encrypted and inaccessible even in such cases.
                </li>
              </ul>
            </section>

            {/* Section 6 */}
            <section id="data-retention">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                6. Data Retention
              </h2>
              <p className="mb-4">
                We retain your account data for as long as your account is
                active or as needed to provide the Service. If you choose to
                delete your account:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  Your encrypted files will be permanently deleted from our
                  servers.
                </li>
                <li>
                  Account-related data will be removed within 30 days of
                  account deletion.
                </li>
                <li>
                  Some anonymized, aggregated data may be retained for
                  analytical purposes.
                </li>
              </ul>
            </section>

            {/* Section 7 */}
            <section id="data-security">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                7. Data Security
              </h2>
              <p className="mb-4">
                We implement industry-standard security measures to protect your
                information, including:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  <strong className="text-foreground">
                    End-to-end encryption (AES-256):
                  </strong>{" "}
                  All file data is encrypted before leaving your device.
                </li>
                <li>
                  <strong className="text-foreground">TLS encryption:</strong>{" "}
                  All data in transit is protected with TLS encryption.
                </li>
                <li>
                  <strong className="text-foreground">
                    Zero-knowledge architecture:
                  </strong>{" "}
                  We structurally cannot access your encrypted file contents.
                </li>
                <li>
                  <strong className="text-foreground">
                    Open-source transparency:
                  </strong>{" "}
                  Our entire codebase is{" "}
                  <a
                    href="https://github.com/santhoshkumar-dev/Xenode"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                  >
                    publicly available on GitHub
                  </a>
                  . You can independently verify every security claim we make.
                </li>
                <li>
                  <strong className="text-foreground">
                    Secure infrastructure:
                  </strong>{" "}
                  Our servers employ robust security practices, regular audits,
                  and access controls.
                </li>
              </ul>
            </section>

            {/* Section 8 */}
            <section id="your-rights">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                8. Your Rights
              </h2>
              <p className="mb-4">
                Depending on your jurisdiction, you may have the following rights
                regarding your personal data:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-foreground/70">
                <li>
                  <strong className="text-foreground">Access:</strong> Request a
                  copy of the personal data we hold about you.
                </li>
                <li>
                  <strong className="text-foreground">Correction:</strong>{" "}
                  Request correction of inaccurate personal data.
                </li>
                <li>
                  <strong className="text-foreground">Deletion:</strong> Request
                  deletion of your personal data and account.
                </li>
                <li>
                  <strong className="text-foreground">Portability:</strong>{" "}
                  Request your data in a portable format.
                </li>
                <li>
                  <strong className="text-foreground">Opt-out:</strong> Opt out
                  of promotional communications at any time.
                </li>
              </ul>
              <p className="mt-4">
                To exercise any of these rights, please contact us at the email
                address provided below.
              </p>
            </section>

            {/* Section 9 */}
            <section id="cookies">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                9. Cookies & Local Storage
              </h2>
              <p>
                Xenode uses essential cookies and local storage to maintain your
                session, remember your preferences (such as theme selection), and
                ensure the Service functions properly. We do not use tracking
                cookies or third-party advertising cookies. Your encryption keys
                may be stored in your browser&apos;s local storage for
                convenience, and never transmitted to our servers.
              </p>
            </section>

            {/* Section 10 */}
            <section id="childrens-privacy">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                10. Children&apos;s Privacy
              </h2>
              <p>
                The Service is not intended for users under the age of 18. We do
                not knowingly collect personal information from children. If we
                become aware that a child under 18 has provided us with personal
                data, we will take steps to delete such information promptly.
              </p>
            </section>

            {/* Section 11 */}
            <section id="changes-to-policy">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                11. Changes to This Policy
              </h2>
              <p>
                We may update this Privacy Policy from time to time. When we
                make significant changes, we will notify you by updating the
                &ldquo;Last updated&rdquo; date at the top of this page and, where
                appropriate, through in-app notifications or email. As an
                open-source project, all changes to our codebase — including
                those related to data handling — are publicly tracked on our{" "}
                <a
                  href="https://github.com/santhoshkumar-dev/Xenode"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >
                  GitHub repository
                </a>
                . Your continued use of the Service after changes are posted
                constitutes your acceptance of the revised policy.
              </p>
            </section>

            {/* Section 12 */}
            <section id="contact-us">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-4 pb-2 border-b border-border/50">
                12. Contact Us
              </h2>
              <p className="mb-4">
                If you have any questions or concerns about this Privacy Policy
                or our data practices, please contact us:
              </p>
              <div className="rounded-xl border border-border bg-card/50 p-6">
                <p className="text-foreground">
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:privacy@xenode.io"
                    className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                  >
                    privacy@xenode.io
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
