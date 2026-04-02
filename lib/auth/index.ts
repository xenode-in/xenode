import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";
import { expo } from "@better-auth/expo";
import { Resend } from "resend";

function createAuth() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  const client = new MongoClient(MONGODB_URI);
  const db = client.db();
  const resend = new Resend(process.env.RESEND_API_KEY || "fallback");

  return betterAuth({
    database: mongodbAdapter(db, {
      usePlural: false,
      transaction: false,
    }),
    plugins: [expo()],
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await resend.emails.send({
            from: "Xenode <noreply@alerts.xenode.in>",
            to: user.email,
            subject: "Verify your email address - Xenode",
            html: `
              <!--
* Xenode - Email Verification
-->
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<title>Verify your Xenode account</title>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" content="" />
<meta content="target-densitydpi=device-dpi" name="viewport" />
<meta content="true" name="HandheldFriendly" />
<meta content="width=device-width" name="viewport" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<style type="text/css">
table { border-collapse: separate; table-layout: fixed; mso-table-lspace: 0pt; mso-table-rspace: 0pt }
table td { border-collapse: collapse }
.ExternalClass { width: 100% }
.ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100% }
body, a, li, p, h1, h2, h3 { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100% }
html { -webkit-text-size-adjust: none !important }
body { min-width: 100%; Margin: 0px; padding: 0px }
body, #innerTable { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale }
#innerTable img+div { display: none !important }
img { Margin: 0; padding: 0; -ms-interpolation-mode: bicubic }
h1, h2, h3, p, a { overflow-wrap: normal; white-space: normal; word-break: break-word }
a { text-decoration: none }
h1, h2, h3, p { min-width: 100%!important; width: 100%!important; max-width: 100%!important; display: inline-block!important; border: 0; padding: 0; margin: 0 }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important }
u + #body a { color: inherit; text-decoration: none; font-size: inherit; font-family: inherit; font-weight: inherit; line-height: inherit }
a[href^="mailto"], a[href^="tel"], a[href^="sms"] { color: inherit; text-decoration: none }
</style>

<style type="text/css">
@media (min-width: 481px) { .hd { display: none!important } }
@media (max-width: 480px) { .hm { display: none!important } }
@media (max-width: 480px) {
  .t5, .t53 { mso-line-height-alt: 0px!important; line-height: 0!important; display: none!important }
  .t6 { border-top-left-radius: 0!important; border-top-right-radius: 0!important }
  .t44 { border-bottom-right-radius: 0!important; border-bottom-left-radius: 0!important }
}
</style>

<style type="text/css">
/* ─── LIGHT MODE DEFAULTS ─────────────────────────── */
.body-bg            { background-color: #f5f7f6 !important; }
.outer-bg           { background-color: #f5f7f6 !important; }
.card-bg            { background-color: #ffffff !important; }
.card-border        { border-left: 1px solid #e6eae8 !important; border-right: 1px solid #e6eae8 !important; border-bottom: 1px solid #e6eae8 !important; }
.divider-line       { border-top: 1px solid #e6eae8 !important; }
.text-greeting      { color: #111827 !important; }
.text-body          { color: #374151 !important; }
.text-muted         { color: #9ca3af !important; }
.text-strong        { color: #111827 !important; }
.text-expiry-strong { color: #374151 !important; }
.text-footer        { color: #9ca3af !important; }
.link-fallback      { color: #295d32 !important; }
.btn-bg             { background-color: #295d32 !important; }
.btn-text           { color: #cdd6b0 !important; }

/* ─── DARK MODE OVERRIDES ─────────────────────────── */
@media (prefers-color-scheme: dark) {
  /* Neutral near-black — not green */
  .body-bg  { background-color: #0b0b0c !important; }
  .outer-bg { background-color: #0b0b0c !important; }

  /* Elevated card — Notion/Linear style dark surface */
  .card-bg     { background-color: #161718 !important; }
  .card-border {
    border-left:   1px solid rgba(255,255,255,0.08) !important;
    border-right:  1px solid rgba(255,255,255,0.08) !important;
    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
  }
  .divider-line { border-top: 1px solid rgba(255,255,255,0.08) !important; }

  /* Clean grayscale typography — no green tint */
  .text-greeting      { color: #f9fafb !important; }
  .text-body          { color: #d1d5db !important; }
  .text-muted         { color: #9ca3af !important; }
  .text-strong        { color: #f9fafb !important; }
  .text-expiry-strong { color: #d1d5db !important; }
  .text-footer        { color: #6b7280 !important; }

  /* Green used ONLY for action — not backgrounds */
  .link-fallback { color: #7cb686 !important; }
  .btn-bg        { background-color: #7cb686 !important; }
  .btn-text      { color: #0f1a12 !important; }
}
</style>

<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital@1&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" type="text/css" />
</head>

<body id="body" class="body-bg" style="min-width:100%;Margin:0px;padding:0px;background-color:#f5f7f6;">
<div class="outer-bg" style="background-color:#f5f7f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center">
<tr>
  <td class="outer-bg" style="font-size:0;line-height:0;mso-line-height-rule:exactly;background-color:#f5f7f6;" valign="top" align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" id="innerTable">

      <!-- Top spacer -->
      <tr><td><div class="t5" style="mso-line-height-rule:exactly;mso-line-height-alt:60px;line-height:60px;font-size:1px;display:block;">&nbsp;</div></td></tr>

      <!-- ═══════════════════════════════════════════════
           HEADER — Brand gradient, unchanged both modes
           ═══════════════════════════════════════════════ -->
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;">
        <tr><td width="600" style="width:600px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td class="t6" style="overflow:hidden;border-radius:14px 14px 0 0;padding:0;background-color:#27432c;">
              <!--[if mso]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
              <v:fill type="gradient" color="#295d32" color2="#27432c" angle="268"/>
              <v:textbox inset="0,0,0,0">
              <![endif]-->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="
                  padding: 44px 40px 44px 40px;
                  border-radius: 14px 14px 0 0;
                  background-image:
                    linear-gradient(268deg, rgb(41, 93, 50) 4.2%, rgb(39, 63, 44) 98.63%),
                    url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAMAAAAp4XiDAAAAUVBMVEWFhYWDg4N3d3dtbW17e3t1dXWBgYGHh4t5eXlzc3OLi4ubm5uVlZWPj4+NjY19fX2JiYl/f39ra2uRkZGZmZlpaWmXl5dvb29xcXGTk5NnZ2c8TV1mAAAAG3RSTlNAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAvEOwtAAAFVklEQVR4XpWWB67c2BUFb3g557T/hRo9/WUMZHlgr4Bg8Z4qQgQJlHI4A8SzFVrapvmTF9O7dmYRFZ60YiBhJRCgh1FYhiLAmdvX0CzTOpNE77ME0Zty/nWWzchDtiqrmQDeuv3powQ5ta2eN0FY0InkqDD73lT9c9lEzwUNqgFHs9VQce3TVClFCQrSTfOiYkVJQBmpbq2L6iZavPnAPcoU0dSw0SUTqz/GtrGuXfbyyBniKykOWQWGqwwMA7QiYAxi+IlPdqo+hYHnUt5ZPfnsHJyNiDtnpJyayNBkF6cWoYGAMY92ZBFgSkAAAAAElFTkSuQmCC');
                  background-blend-mode: normal, overlay;
                ">
                  <p style="
                    margin:0;Margin:0;
                    font-family:'Libre Baskerville','Libre Baskerville Fallback',Georgia,'Times New Roman',serif;
                    line-height:1;
                    font-weight:100;
                    font-style:italic;
                    font-size:42px;
                    text-decoration:none;
                    direction:ltr;
                    color:#cdd6b0;
                    text-align:left;
                    letter-spacing:-0.5px;
                  ">
                    Xenode
                  </p>
                </td>
              </tr>
              </table>
              <!--[if mso]>
              </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          </table>
        </td></tr>
        </table>
      </td></tr>

      <!-- ═══════════════════════════════════════════════
           BODY CARD
           ═══════════════════════════════════════════════ -->
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;">
        <tr><td width="600" style="width:600px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td class="t44 card-bg card-border" style="
              overflow:hidden;
              background-color:#ffffff;
              padding:44px 40px 44px 40px;
              border-radius:0 0 14px 14px;
              border-left:1px solid #e6eae8;
              border-right:1px solid #e6eae8;
              border-bottom:1px solid #e6eae8;
            ">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                <!-- Greeting -->
                <tr><td>
                  <p class="text-greeting" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:28px;font-weight:600;font-size:22px;color:#111827;text-align:left;">
                    Hi ${user.name},
                  </p>
                </td></tr>

                <tr><td><div style="line-height:16px;font-size:1px;display:block;">&nbsp;</div></td></tr>

                <!-- Body text -->
                <tr><td>
                  <p class="text-body" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:26px;font-weight:400;font-size:15px;color:#374151;text-align:left;">
                    Welcome to Xenode. Your end-to-end encrypted personal storage hub. Please verify your email address to complete your registration and get started with secure file storage.
                  </p>
                </td></tr>

                <tr><td><div style="line-height:32px;font-size:1px;display:block;">&nbsp;</div></td></tr>

                <!-- CTA Button -->
                <tr><td align="left">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="Margin-right:auto;">
                  <tr>
                    <td class="btn-bg" style="background-color:#295d32;border-radius:8px;text-align:center;padding:14px 32px;">
                      <a href="${url}" class="btn-text" style="display:block;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:24px;font-weight:700;font-size:15px;text-decoration:none;color:#cdd6b0;white-space:nowrap;">
                        Verify Email Address →
                      </a>
                    </td>
                  </tr>
                  </table>
                </td></tr>

                <tr><td><div style="line-height:32px;font-size:1px;display:block;">&nbsp;</div></td></tr>

                <!-- Fallback link -->
                <tr><td>
                  <p class="text-muted" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-size:12px;color:#9ca3af;text-align:left;">
                    If the button doesn't work, copy and paste this link into your browser:<br/>
                    <a href="${url}" class="link-fallback" style="color:#295d32;word-break:break-all;font-size:12px;">${url}</a>
                  </p>
                </td></tr>

                <tr><td><div style="line-height:28px;font-size:1px;display:block;">&nbsp;</div></td></tr>

                <!-- Expiry notice -->
                <tr><td>
                  <p class="text-muted" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-size:13px;color:#9ca3af;text-align:left;">
                    This link expires in <strong class="text-expiry-strong" style="color:#374151;">10 minutes</strong>. If you didn't create a Xenode account, you can safely ignore this email.
                  </p>
                </td></tr>

                                <tr><td class="divider-line" style="border-top:1px solid #e6eae8;">&nbsp;</td></tr>
                <tr><td><div style="line-height:24px;font-size:1px;display:block;">&nbsp;</div></td></tr>

                <!-- Sign-off -->
                <tr><td>
                  <p class="text-body" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:22px;font-weight:400;font-size:14px;color:#374151;text-align:left;">
                    Thank you,<br/>
                    <strong class="text-strong" style="color:#111827;">Xenode Team</strong>
                  </p>
                </td></tr>

              </table>
            </td>
          </tr>
          </table>
        </td></tr>
        </table>
      </td></tr>

      <!-- ═══════════════════════════════════════════════
           FOOTER
           ═══════════════════════════════════════════════ -->
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="Margin-left:auto;Margin-right:auto;">
        <tr><td width="600" style="width:600px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:24px 40px 24px 40px;">
              <p class="text-footer" style="margin:0;Margin:0;font-family:Inter,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;line-height:20px;font-weight:400;font-size:12px;color:#9ca3af;text-align:center;">
                © 2026 Xenode. All rights reserved.<br/>
                You're receiving this because you signed up at xenode.in
              </p>
            </td>
          </tr>
          </table>
        </td></tr>
        </table>
      </td></tr>

      <!-- Bottom spacer -->
      <tr><td><div class="t53" style="mso-line-height-rule:exactly;mso-line-height-alt:60px;line-height:60px;font-size:1px;display:block;">&nbsp;</div></td></tr>

    </table>
  </td>
</tr>
</table>
</div>
</body>
</html>
            `,
          });
        } catch (error) {
          console.error("Failed to send verification email:", error);
          // Don't throw the error, just log it so we don't crash the signup process
        }
      },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        enabled: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
        scope: [
          "https://www.googleapis.com/auth/drive.readonly",
          "profile",
          "email",
        ],
        accessType: "offline",
        prompt: "consent",
        disableSignUp: true,
        overrideUserInfoOnSignIn: false,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    rateLimit: {
      window: 60, // time window in seconds
      max: 100, // max requests in the window
      customRules: {
        "/send-verification-email": {
          window: 60 * 10, // 10 minutes
          max: 3, // 3 requests per 10 minutes
        },
      },
    },
    trustedOrigins: [
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "xenode://",
      "xenode://*",
      "http://localhost:8081",
      ...(process.env.NODE_ENV === "development"
        ? ["exp://", "exp://**", "exp://192.168.*.*:*/**"]
        : []),
    ],
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },
    user: {
      additionalFields: {
        onboarded: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        encryptByDefault: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        authVerifier: {
          type: "string",
          required: false,
        },
        authSalt: {
          type: "string",
          required: false,
        },
        passwordChangedAt: {
          type: "date",
          required: false,
        },
        credentialEpoch: {
          type: "date",
          required: false,
        },
      },
    },
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
