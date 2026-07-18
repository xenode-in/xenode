import { APP_URL } from "./client";

/**
 * Transactional email templates for support tickets and refunds.
 *
 * Styled to match the auth OTP email (header, card, footer, dark-mode support).
 * Each template returns full HTML. Plain-text equivalents are auto-derived by
 * Resend, but we pass an explicit `text` fallback per Resend's recommendation.
 */

interface BaseLayoutArgs {
  title: string;
  preheader?: string;
  bodyHtml: string;
}

function baseLayout({ title, preheader, bodyHtml }: BaseLayoutArgs): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body { margin:0; padding:0; background:#f5f7f6; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
.preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; }
.container { max-width:600px; margin:0 auto; }
.header { background:linear-gradient(268deg,#295d32 4.2%,#273f2c 98.63%); padding:36px 40px; border-radius:14px 14px 0 0; color:#cdd6b0; }
.brand { font-family:"Libre Baskerville",Georgia,serif; font-size:34px; font-style:italic; letter-spacing:-0.5px; margin:0; }
.card { background:#ffffff; padding:36px 40px; border-radius:0 0 14px 14px; border:1px solid #e6eae8; border-top:0; }
.h1 { font-size:20px; font-weight:600; color:#111827; margin:0 0 12px; }
.p { font-size:14px; line-height:22px; color:#374151; margin:0 0 16px; }
.muted { font-size:13px; color:#6b7280; }
.button { display:inline-block; background:#295d32; color:#ffffff !important; text-decoration:none; padding:10px 22px; border-radius:8px; font-size:14px; font-weight:500; }
.box { background:#f7faf7; border:1px solid #e6eae8; border-radius:10px; padding:16px 18px; margin:16px 0; font-size:13px; color:#374151; }
.kv { display:block; margin:4px 0; }
.kv .k { color:#6b7280; }
.kv .v { color:#111827; font-weight:500; }
.footer { text-align:center; padding:24px; font-size:12px; color:#9ca3af; }
@media (prefers-color-scheme: dark) {
  body { background:#0b0b0c; }
  .card { background:#161718; border-color:rgba(255,255,255,0.08); }
  .h1 { color:#f9fafb; }
  .p { color:#d1d5db; }
  .muted, .footer { color:#9ca3af; }
  .box { background:#1a1c1d; border-color:rgba(255,255,255,0.08); color:#d1d5db; }
  .kv .v { color:#f9fafb; }
}
</style>
</head>
<body>
${preheader ? `<div class="preheader">${escapeHtml(preheader)}</div>` : ""}
<div style="padding:32px 16px;">
  <div class="container">
    <div class="header"><p class="brand">Xenode</p></div>
    <div class="card">
      ${bodyHtml}
    </div>
    <div class="footer">© ${new Date().getFullYear()} Xenode. All rights reserved.</div>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ticketUrl(ticketId: string, isAdmin = false): string {
  return isAdmin
    ? `${APP_URL}/admin/dashboard/support/${ticketId}`
    : `${APP_URL}/dashboard/support/${ticketId}`;
}

function organizationInvitationUrl(invitationId: string): string {
  return `${APP_URL}/invite/${invitationId}`;
}

export function organizationInvitationEmail(args: {
  inviterName: string;
  organizationName: string;
  invitationId: string;
  role: string;
  expiresAt: Date;
}) {
  const invitationUrl = organizationInvitationUrl(args.invitationId);
  const expiresAt = args.expiresAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const body = `
<p class="h1">You're invited to ${escapeHtml(args.organizationName)}</p>
<p class="p">${escapeHtml(args.inviterName)} invited you to join ${escapeHtml(args.organizationName)} as ${escapeHtml(args.role)}.</p>
<div class="box">
  <span class="kv"><span class="k">Organization:</span> <span class="v">${escapeHtml(args.organizationName)}</span></span>
  <span class="kv"><span class="k">Role:</span> <span class="v">${escapeHtml(args.role)}</span></span>
  <span class="kv"><span class="k">Expires:</span> <span class="v">${escapeHtml(expiresAt)}</span></span>
</div>
<p class="p"><a class="button" href="${invitationUrl}">Review invitation</a></p>
<p class="muted">For encrypted organization spaces, Xenode will only activate access after your space key is ready.</p>
`;
  return {
    subject: `Invitation to join ${args.organizationName}`,
    html: baseLayout({
      title: "Organization invitation",
      preheader: `Join ${args.organizationName} on Xenode`,
      bodyHtml: body,
    }),
    text: `${args.inviterName} invited you to join ${args.organizationName} as ${args.role}.\n\nReview: ${invitationUrl}\nExpires: ${expiresAt}\n`,
  };
}

// ─── User-facing ──────────────────────────────────────────────────────────

export function ticketCreatedUserEmail(args: {
  userName: string;
  subject: string;
  ticketId: string;
  category: string;
}) {
  const body = `
<p class="h1">We received your support request</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">Thanks for reaching out. Our support team has received your request and will respond as soon as possible.</p>
<div class="box">
  <span class="kv"><span class="k">Subject:</span> <span class="v">${escapeHtml(args.subject)}</span></span>
  <span class="kv"><span class="k">Category:</span> <span class="v">${escapeHtml(args.category.replace(/_/g, " "))}</span></span>
  <span class="kv"><span class="k">Ticket ID:</span> <span class="v">#${args.ticketId.slice(-8)}</span></span>
</div>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">View ticket</a></p>
<p class="muted">You'll receive an email when our team replies.</p>
`;
  return {
    subject: `[#${args.ticketId.slice(-8)}] ${args.subject}`,
    html: baseLayout({
      title: "Support request received",
      preheader: `We received your support request: ${args.subject}`,
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nWe received your support request: "${args.subject}".\nTicket #${args.ticketId.slice(-8)}\n\nView: ${ticketUrl(args.ticketId)}\n`,
  };
}

export function ticketReplyUserEmail(args: {
  userName: string;
  subject: string;
  ticketId: string;
  replyPreview: string;
}) {
  const body = `
<p class="h1">New reply on your ticket</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">Our support team has replied to your ticket:</p>
<div class="box">${escapeHtml(args.replyPreview).slice(0, 600)}</div>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">Open ticket</a></p>
`;
  return {
    subject: `[#${args.ticketId.slice(-8)}] Re: ${args.subject}`,
    html: baseLayout({
      title: "New reply on your ticket",
      preheader: "Support team replied to your ticket",
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nSupport replied to ticket #${args.ticketId.slice(-8)}:\n\n${args.replyPreview}\n\nView: ${ticketUrl(args.ticketId)}\n`,
  };
}

export function refundRequestedUserEmail(args: {
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}) {
  const body = `
<p class="h1">Refund request received</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">We've received your refund request for <strong>${escapeHtml(args.currency)} ${args.amount.toFixed(2)}</strong>. Our team will review it within 1-2 business days under our 14-day money-back guarantee.</p>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">Track request</a></p>
<p class="muted">You'll be notified by email once a decision has been made.</p>
`;
  return {
    subject: `Refund request received — #${args.ticketId.slice(-8)}`,
    html: baseLayout({
      title: "Refund request received",
      preheader: "We're reviewing your refund request",
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nWe received your refund request for ${args.currency} ${args.amount.toFixed(2)}. Our team will review within 1-2 business days.\n\nTrack: ${ticketUrl(args.ticketId)}\n`,
  };
}

export function refundApprovedUserEmail(args: {
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}) {
  const body = `
<p class="h1">Your refund is being processed</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">Your refund of <strong>${escapeHtml(args.currency)} ${args.amount.toFixed(2)}</strong> has been approved and sent to your bank. Funds typically arrive in <strong>5-7 business days</strong> depending on your payment method.</p>
<p class="p">Your subscription has been cancelled and your account will be downgraded to the free plan once the refund settles.</p>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">View details</a></p>
`;
  return {
    subject: `Refund approved — ${args.currency} ${args.amount.toFixed(2)}`,
    html: baseLayout({
      title: "Refund approved",
      preheader: "Refund is on its way — 5-7 business days to settle",
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nYour refund of ${args.currency} ${args.amount.toFixed(2)} has been approved. Funds typically arrive in 5-7 business days.\n\nView: ${ticketUrl(args.ticketId)}\n`,
  };
}

export function refundDeniedUserEmail(args: {
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
  reason: string;
}) {
  const body = `
<p class="h1">Refund request — update</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">We've reviewed your refund request for <strong>${escapeHtml(args.currency)} ${args.amount.toFixed(2)}</strong> and we're unable to approve it at this time.</p>
<div class="box"><strong>Reason:</strong><br/>${escapeHtml(args.reason)}</div>
<p class="p">If you have questions or believe this decision should be revisited, please reply on the ticket below.</p>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">Reply on ticket</a></p>
`;
  return {
    subject: `Refund request — update needed`,
    html: baseLayout({
      title: "Refund request — update",
      preheader: "Your refund request requires further review",
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nWe're unable to approve your refund of ${args.currency} ${args.amount.toFixed(2)}.\n\nReason: ${args.reason}\n\nReply: ${ticketUrl(args.ticketId)}\n`,
  };
}

export function refundCompletedUserEmail(args: {
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}) {
  const body = `
<p class="h1">Refund completed</p>
<p class="p">Hi ${escapeHtml(args.userName)},</p>
<p class="p">Your refund of <strong>${escapeHtml(args.currency)} ${args.amount.toFixed(2)}</strong> has been processed successfully and should now reflect on your original payment method.</p>
<p class="p">Your account has been moved to the free plan. We're sorry to see you go — if there's anything we could have done differently, we'd love to hear it.</p>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId)}">View receipt</a></p>
`;
  return {
    subject: `Refund completed — ${args.currency} ${args.amount.toFixed(2)}`,
    html: baseLayout({
      title: "Refund completed",
      preheader: "Refund has been processed to your account",
      bodyHtml: body,
    }),
    text: `Hi ${args.userName},\n\nYour refund of ${args.currency} ${args.amount.toFixed(2)} has been processed. Your account is now on the free plan.\n\nView: ${ticketUrl(args.ticketId)}\n`,
  };
}

// ─── Admin-facing ─────────────────────────────────────────────────────────

export function ticketCreatedAdminEmail(args: {
  userEmail: string;
  userName: string;
  subject: string;
  category: string;
  ticketId: string;
  description: string;
}) {
  const isRefund = args.category === "refund_request";
  const body = `
<p class="h1">${isRefund ? "New refund request" : "New support ticket"}</p>
<p class="p">A user has submitted a new ${isRefund ? "refund request" : "ticket"}.</p>
<div class="box">
  <span class="kv"><span class="k">From:</span> <span class="v">${escapeHtml(args.userName)} (${escapeHtml(args.userEmail)})</span></span>
  <span class="kv"><span class="k">Subject:</span> <span class="v">${escapeHtml(args.subject)}</span></span>
  <span class="kv"><span class="k">Category:</span> <span class="v">${escapeHtml(args.category.replace(/_/g, " "))}</span></span>
  <span class="kv"><span class="k">Ticket:</span> <span class="v">#${args.ticketId.slice(-8)}</span></span>
</div>
<div class="box"><strong>Message:</strong><br/>${escapeHtml(args.description).slice(0, 1000)}</div>
<p class="p"><a class="button" href="${ticketUrl(args.ticketId, true)}">Open in admin panel</a></p>
`;
  return {
    subject: `[${args.category}] ${args.subject}`,
    html: baseLayout({
      title: "New support ticket",
      preheader: `${args.userEmail} — ${args.subject}`,
      bodyHtml: body,
    }),
    text: `New ${args.category} ticket from ${args.userEmail}: "${args.subject}"\n\n${args.description}\n\nOpen: ${ticketUrl(args.ticketId, true)}\n`,
  };
}
