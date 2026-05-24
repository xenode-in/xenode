import { ADMIN_NOTIFY_EMAIL, EMAIL_FROM, getResend } from "./client";
import {
  refundApprovedUserEmail,
  refundCompletedUserEmail,
  refundDeniedUserEmail,
  refundRequestedUserEmail,
  ticketCreatedAdminEmail,
  ticketCreatedUserEmail,
  ticketReplyUserEmail,
} from "./templates";

/**
 * Email notification helpers — fire-and-forget. Failures are logged but never
 * thrown out of the calling route. The user's billing/support flow must never
 * fail because Resend is down.
 */

async function safeSend(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn("[email] RESEND_API_KEY not set — skipping send", {
        to: args.to,
        subject: args.subject,
      });
      return;
    }
    const resend = getResend();
    await resend.emails.send({
      from: EMAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
  } catch (error) {
    console.error("[email] send failed", {
      to: args.to,
      subject: args.subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Ticket notifications ─────────────────────────────────────────────────

export async function notifyTicketCreated(args: {
  userEmail: string;
  userName: string;
  subject: string;
  description: string;
  category: string;
  ticketId: string;
}): Promise<void> {
  const userEmail = ticketCreatedUserEmail({
    userName: args.userName,
    subject: args.subject,
    ticketId: args.ticketId,
    category: args.category,
  });
  const adminEmail = ticketCreatedAdminEmail({
    userEmail: args.userEmail,
    userName: args.userName,
    subject: args.subject,
    category: args.category,
    ticketId: args.ticketId,
    description: args.description,
  });

  await Promise.all([
    safeSend({ to: args.userEmail, ...userEmail }),
    safeSend({ to: ADMIN_NOTIFY_EMAIL, ...adminEmail }),
  ]);
}

export async function notifyTicketReply(args: {
  userEmail: string;
  userName: string;
  subject: string;
  ticketId: string;
  replyPreview: string;
  recipient: "user" | "admin";
}): Promise<void> {
  if (args.recipient === "user") {
    const email = ticketReplyUserEmail({
      userName: args.userName,
      subject: args.subject,
      ticketId: args.ticketId,
      replyPreview: args.replyPreview,
    });
    await safeSend({ to: args.userEmail, ...email });
  } else {
    // Admin reply notification — uses the same template but addressed to the
    // admin notify mailbox. Kept lightweight; admins primarily watch the panel.
    await safeSend({
      to: ADMIN_NOTIFY_EMAIL,
      subject: `[#${args.ticketId.slice(-8)}] User replied: ${args.subject}`,
      html: `<p>User ${args.userName} (${args.userEmail}) replied on ticket #${args.ticketId.slice(-8)}.</p><p>${args.replyPreview.slice(0, 500)}</p>`,
      text: `User ${args.userName} replied on ticket #${args.ticketId.slice(-8)}: ${args.replyPreview}`,
    });
  }
}

// ─── Refund notifications ─────────────────────────────────────────────────

export async function notifyRefundRequested(args: {
  userEmail: string;
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}): Promise<void> {
  const email = refundRequestedUserEmail({
    userName: args.userName,
    amount: args.amount,
    currency: args.currency,
    ticketId: args.ticketId,
  });
  await safeSend({ to: args.userEmail, ...email });
}

export async function notifyRefundApproved(args: {
  userEmail: string;
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}): Promise<void> {
  const email = refundApprovedUserEmail({
    userName: args.userName,
    amount: args.amount,
    currency: args.currency,
    ticketId: args.ticketId,
  });
  await safeSend({ to: args.userEmail, ...email });
}

export async function notifyRefundDenied(args: {
  userEmail: string;
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
  reason: string;
}): Promise<void> {
  const email = refundDeniedUserEmail({
    userName: args.userName,
    amount: args.amount,
    currency: args.currency,
    ticketId: args.ticketId,
    reason: args.reason,
  });
  await safeSend({ to: args.userEmail, ...email });
}

export async function notifyRefundCompleted(args: {
  userEmail: string;
  userName: string;
  amount: number;
  currency: string;
  ticketId: string;
}): Promise<void> {
  const email = refundCompletedUserEmail({
    userName: args.userName,
    amount: args.amount,
    currency: args.currency,
    ticketId: args.ticketId,
  });
  await safeSend({ to: args.userEmail, ...email });
}
