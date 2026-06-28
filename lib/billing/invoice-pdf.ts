import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import fs from "fs";
import path from "path";
import dbConnect from "@/lib/mongodb";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Subscription from "@/models/Subscription";
import Payment from "@/models/Payment";
import { User } from "@/models/User";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/b2/client";
import { uploadObject } from "@/lib/b2/objects";

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free Tier",
  basic: "Basic Plan",
  pro: "Pro Plan",
  plus: "Plus Plan",
  max: "Max Plan",
  enterprise: "Enterprise Suite",
};

// ── Seller details ──────────────────────────────────────────────────────────
// Xenode is not GST-registered, so no GSTIN / tax fields appear on the invoice.
// TODO: replace addressLines with the real registered office address.
const COMPANY = {
  name: "Xenode Technologies Pvt. Ltd.",
  addressLines: ["India"],
  supportUrl: "xenode.in/dashboard/support",
  billingEmail: "billing@xenode.in",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  upi_autopay: "UPI Autopay",
  upi: "UPI",
  card: "Card",
  netbanking: "Net Banking",
  wallet: "Wallet",
  emandate: "e-Mandate",
};

// ── A4 geometry (points) ──────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const ML = 45; // left margin
const MR = PAGE_W - 45; // right edge
const CW = MR - ML; // content width

// ── Palette (RGB of the invoice.html theme) ──
const COLOR = {
  primary: rgb(46 / 255, 107 / 255, 66 / 255),
  fg: rgb(22 / 255, 36 / 255, 26 / 255),
  muted: rgb(110 / 255, 118 / 255, 113 / 255),
  bg: rgb(251 / 255, 251 / 255, 248 / 255),
  white: rgb(1, 1, 1),
  border: rgb(223 / 255, 225 / 255, 223 / 255),
  chip: rgb(244 / 255, 247 / 255, 245 / 255),
  successBg: rgb(243 / 255, 247 / 255, 244 / 255),
  successBorder: rgb(209 / 255, 224 / 255, 213 / 255),
  warn: rgb(156 / 255, 106 / 255, 28 / 255),
  warnBg: rgb(253 / 255, 246 / 255, 233 / 255),
  warnBorder: rgb(231 / 255, 217 / 255, 192 / 255),
};

function formatDateString(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}

function getPeriodString(startDate: Date, cycle: string): string {
  const start = new Date(startDate);
  const end = new Date(startDate);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else if (cycle === "quarterly") end.setMonth(end.getMonth() + 3);
  else end.setMonth(end.getMonth() + 1);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  return `${fmt(start)} - ${fmt(end)}`;
}

function inr(n: number): string {
  return (
    "INR " +
    n.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** The plain data the renderer needs — decoupled from DB models for testability. */
export interface InvoiceRenderData {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  clientName: string;
  clientEmail: string;
  planName: string;
  billingPeriod: string;
  status: string; // "paid" | "due" | ...
  lineItemDesc: string; // e.g. "Monthly subscription"
  unitPrice: number;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  transactionId: string;
  paymentDate: Date;
  note: string;
}

/**
 * Draws the invoice with pdf-lib primitives (matching invoice.html) and returns
 * the PDF bytes. All text is real, selectable text. No tax/GST, no client
 * address — Xenode is not GST-registered and addresses aren't collected.
 */
export async function renderInvoicePdf(
  data: InvoiceRenderData,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const timesI = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const timesB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const courier = await pdf.embedFont(StandardFonts.Courier);

  // Helpers — `top` is the distance from the page top to the text baseline / box top.
  const yOf = (top: number) => PAGE_H - top;
  const text = (
    str: string,
    x: number,
    top: number,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: RGB;
      align?: "left" | "right" | "center";
    } = {},
  ) => {
    const font = opts.font ?? helv;
    const size = opts.size ?? 9;
    let drawX = x;
    if (opts.align === "right")
      drawX = x - font.widthOfTextAtSize(str, size);
    else if (opts.align === "center")
      drawX = x - font.widthOfTextAtSize(str, size) / 2;
    page.drawText(str, {
      x: drawX,
      y: yOf(top),
      size,
      font,
      color: opts.color ?? COLOR.fg,
    });
  };
  const box = (
    x: number,
    top: number,
    w: number,
    h: number,
    fill?: RGB,
    borderColor?: RGB,
    borderWidth = 0.75,
  ) => {
    page.drawRectangle({
      x,
      y: yOf(top) - h,
      width: w,
      height: h,
      color: fill,
      borderColor,
      borderWidth: borderColor ? borderWidth : undefined,
    });
  };
  const hline = (x1: number, x2: number, top: number, color = COLOR.border) => {
    page.drawLine({
      start: { x: x1, y: yOf(top) },
      end: { x: x2, y: yOf(top) },
      thickness: 0.75,
      color,
    });
  };
  const wrap = (
    str: string,
    font: PDFFont,
    size: number,
    maxW: number,
  ): string[] => {
    const words = str.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(t, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Page background
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COLOR.bg });

  // ───────────── Header ─────────────
  // Logo (pulled from invoice.html's inline PNG, optional)
  try {
    const tplPath = path.join(process.cwd(), "public", "html", "invoice.html");
    const tpl = fs.readFileSync(tplPath, "utf8");
    const m = tpl.match(/class="logo"[\s\S]*?src="data:image\/png;base64,([^"]+)"/);
    if (m?.[1]) {
      const logo = await pdf.embedPng(Buffer.from(m[1], "base64"));
      page.drawImage(logo, { x: ML, y: yOf(44) - 26, width: 26, height: 26 });
    }
  } catch {
    // logo optional
  }

  text("Xenode", ML + 33, 60, { font: timesI, size: 20, color: COLOR.fg });
  text("INVOICE", ML + 33, 71, { font: helv, size: 7.5, color: COLOR.muted });

  const metaRow = (label: string, value: string, top: number) => {
    text(label, MR, top, {
      font: helv,
      size: 6.8,
      color: COLOR.primary,
      align: "right",
    });
    text(value, MR, top + 9, {
      font: helv,
      size: 8.5,
      color: COLOR.fg,
      align: "right",
    });
  };
  metaRow("INVOICE NO.", data.invoiceNumber, 48);
  metaRow("ISSUE DATE", formatDateString(data.issueDate), 68);
  metaRow("DUE DATE", formatDateString(data.dueDate), 88);

  hline(ML, MR, 110);

  // ───────────── Info row: From / Bill To / Status ─────────────
  const infoTop = 124;
  const gap = 14;
  const cardW = (CW - 2 * gap) / 3;
  const infoH = 82;
  const pad = 12;
  const x1 = ML;
  const x2 = ML + cardW + gap;
  const x3 = ML + 2 * (cardW + gap);

  const card = (x: number) => box(x, infoTop, cardW, infoH, COLOR.white, COLOR.border);
  card(x1);
  card(x2);
  card(x3);

  const eyebrow = (label: string, x: number, top: number) =>
    text(label, x, top, { font: helvB, size: 7, color: COLOR.primary });

  // From
  eyebrow("FROM", x1 + pad, infoTop + 14);
  let fy = infoTop + 26;
  for (const ln of wrap(COMPANY.name, helvB, 8, cardW - 2 * pad)) {
    text(ln, x1 + pad, fy, { font: helvB, size: 8, color: COLOR.fg });
    fy += 11;
  }
  for (const ln of COMPANY.addressLines) {
    text(ln, x1 + pad, fy, { font: helv, size: 8, color: COLOR.muted });
    fy += 11;
  }

  // Bill To
  eyebrow("BILL TO", x2 + pad, infoTop + 14);
  let by = infoTop + 26;
  for (const ln of wrap(data.clientName || "Customer", helvB, 8, cardW - 2 * pad)) {
    text(ln, x2 + pad, by, { font: helvB, size: 8, color: COLOR.fg });
    by += 11;
  }
  for (const ln of wrap(data.clientEmail, helv, 8, cardW - 2 * pad)) {
    text(ln, x2 + pad, by, { font: helv, size: 8, color: COLOR.muted });
    by += 11;
  }

  // Status
  eyebrow("STATUS", x3 + pad, infoTop + 14);
  text(data.planName, x3 + pad, infoTop + 26, {
    font: helvB,
    size: 8,
    color: COLOR.fg,
  });
  text(data.billingPeriod, x3 + pad, infoTop + 37, {
    font: helv,
    size: 7.5,
    color: COLOR.muted,
  });
  // Status badge
  const isPaid = data.status.toLowerCase() === "paid";
  const badgeLabel = isPaid ? "PAID" : data.status.toUpperCase();
  const badgeW = helvB.widthOfTextAtSize(badgeLabel, 7) + 12;
  box(
    x3 + pad,
    infoTop + 44,
    badgeW,
    12,
    isPaid ? COLOR.successBg : COLOR.warnBg,
    isPaid ? COLOR.successBorder : COLOR.warnBorder,
    0.5,
  );
  text(badgeLabel, x3 + pad + 6, infoTop + 52.5, {
    font: helvB,
    size: 7,
    color: isPaid ? COLOR.primary : COLOR.warn,
  });
  // Invoice number chip
  const chipText = data.invoiceNumber;
  const chipW = courier.widthOfTextAtSize(chipText, 8) + 12;
  box(x3 + pad, infoTop + 60, chipW, 12, COLOR.chip, COLOR.successBorder, 0.5);
  text(chipText, x3 + pad + 6, infoTop + 68.5, {
    font: courier,
    size: 8,
    color: COLOR.primary,
  });

  // ───────────── Line items table ─────────────
  let top = infoTop + infoH + 20;

  // Column geometry
  const innerL = ML + 14;
  const innerR = MR - 14;
  const innerW = innerR - innerL;
  const colDescX = innerL;
  const colQtyC = innerL + innerW * 0.58; // qty centre
  const colUnitC = innerL + innerW * 0.76; // unit price centre
  const colAmtR = innerR; // amount right edge

  // Body rows (single subscription line item)
  const descLines = wrap(data.lineItemDesc, helv, 7.5, innerW * 0.5);
  const rowH = 14 + descLines.length * 9;
  const headerH = 18;
  const footerRows = 3;
  const footerH = footerRows * 16 + 8;
  const tableH = 12 + headerH + rowH + footerH + 10;

  box(ML, top, CW, tableH, COLOR.white, COLOR.border);

  // Header band
  box(ML, top, CW, headerH + 12, COLOR.chip);
  const headBase = top + 19;
  text("DESCRIPTION", colDescX, headBase, {
    font: helvB,
    size: 7,
    color: COLOR.primary,
  });
  text("QTY", colQtyC, headBase, {
    font: helvB,
    size: 7,
    color: COLOR.primary,
    align: "center",
  });
  text("UNIT PRICE", colUnitC, headBase, {
    font: helvB,
    size: 7,
    color: COLOR.primary,
    align: "center",
  });
  text("AMOUNT", colAmtR, headBase, {
    font: helvB,
    size: 7,
    color: COLOR.primary,
    align: "right",
  });
  hline(ML, MR, top + headerH + 12);

  // Item row
  let rowTop = top + headerH + 12 + 16;
  text(data.planName, colDescX, rowTop, { font: helv, size: 8.5, color: COLOR.fg });
  let dly = rowTop + 9;
  for (const ln of descLines) {
    text(ln, colDescX, dly, { font: helv, size: 7.5, color: COLOR.muted });
    dly += 9;
  }
  text("1", colQtyC, rowTop, { font: helv, size: 8.5, color: COLOR.fg, align: "center" });
  text(inr(data.unitPrice), colUnitC, rowTop, {
    font: helv,
    size: 8.5,
    color: COLOR.fg,
    align: "center",
  });
  text(inr(data.unitPrice), colAmtR, rowTop, {
    font: helv,
    size: 8.5,
    color: COLOR.fg,
    align: "right",
  });

  // Footer totals
  let fTop = top + headerH + 12 + rowH + 6;
  hline(colQtyC - 20, MR, fTop - 6);
  const totalRow = (
    label: string,
    value: string,
    t: number,
    bold = false,
  ) => {
    text(label, colUnitC, t, {
      font: bold ? timesB : helv,
      size: bold ? 10 : 8.5,
      color: bold ? COLOR.fg : COLOR.muted,
      align: "right",
    });
    text(value, colAmtR, t, {
      font: bold ? helvB : helv,
      size: bold ? 10 : 8.5,
      color: bold ? COLOR.fg : COLOR.muted,
      align: "right",
    });
  };
  totalRow("Subtotal", inr(data.subtotal), fTop + 6);
  totalRow("Discount", inr(data.discount), fTop + 22);
  hline(colUnitC - 60, MR, fTop + 32, COLOR.successBorder);
  totalRow("Total Due", inr(data.total), fTop + 44, true);

  // ───────────── Payment details ─────────────
  top = top + tableH + 18;
  const payH = 50;
  box(ML, top, CW, payH, COLOR.white, COLOR.border);
  eyebrow("PAYMENT DETAILS", ML + 14, top + 14);
  const payColW = (CW - 28) / 3;
  const payItem = (label: string, value: string, i: number) => {
    const px = ML + 14 + i * payColW;
    text(label, px, top + 28, { font: helv, size: 6.8, color: COLOR.primary });
    for (const [j, ln] of wrap(value, helv, 8.5, payColW - 8).entries()) {
      text(ln, px, top + 38 + j * 10, { font: helv, size: 8.5, color: COLOR.fg });
    }
  };
  payItem("PAYMENT METHOD", data.paymentMethod, 0);
  payItem("TRANSACTION ID", data.transactionId, 1);
  payItem("PAYMENT DATE", formatDateString(data.paymentDate), 2);

  // ───────────── Note ─────────────
  top = top + payH + 18;
  const noteLines = wrap(data.note, helv, 8.4, CW - 28);
  const noteH = 22 + noteLines.length * 11;
  box(ML, top, CW, noteH, COLOR.warnBg, COLOR.warnBorder);
  eyebrow("NOTE", ML + 14, top + 14);
  let ny = top + 26;
  for (const ln of noteLines) {
    text(ln, ML + 14, ny, { font: helv, size: 8.4, color: COLOR.fg });
    ny += 11;
  }

  // ───────────── Footer ─────────────
  const footTop = PAGE_H - 36;
  hline(ML, MR, footTop - 8);
  text(`Questions? ${COMPANY.supportUrl}  ·  ${COMPANY.billingEmail}`, ML, footTop, {
    font: helv,
    size: 7.3,
    color: COLOR.muted,
  });
  text("Thank you for choosing Xenode.", MR, footTop, {
    font: helv,
    size: 7.3,
    color: COLOR.muted,
    align: "right",
  });

  return pdf.save();
}

/**
 * Fetches an invoice (user-scoped), generates the PDF via renderInvoicePdf,
 * serving/caching the result on B2. Same signature as before.
 */
export async function generateInvoicePdfBuffer(
  invoiceId: string,
  userId: string,
): Promise<Uint8Array> {
  await dbConnect();

  // 1. Invoice
  const invoice = await SubscriptionInvoice.findById(invoiceId).lean();
  if (!invoice) throw new Error("Invoice not found");

  // 2. Subscription (+ ownership check)
  const subscription = await Subscription.findOne({
    subscription_id: invoice.subscription_id,
  }).lean();
  if (!subscription) throw new Error("Subscription not found for this invoice");
  if (subscription.userId !== userId)
    throw new Error("Unauthorized access to invoice");

  const bucketName = process.env.S3_BUCKET_NAME || "xenode-drive-storage";
  let s3Key = `invoices/${invoiceId}.pdf`;

  // 3. Serve cached PDF from B2 if present
  if (invoice.pdfUrl) {
    try {
      if (invoice.pdfUrl.startsWith("s3://")) {
        const parts = invoice.pdfUrl.replace("s3://", "").split("/");
        parts.shift();
        s3Key = parts.join("/");
      } else {
        s3Key = invoice.pdfUrl;
      }
      const s3Client = getS3Client();
      const s3Response = await s3Client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
      );
      if (s3Response.Body) {
        const bytes = await s3Response.Body.transformToByteArray();
        console.log(`[S3/B2 Cache] Served cached invoice PDF from key: ${s3Key}`);
        return bytes;
      }
    } catch (err) {
      console.warn(
        `[S3/B2 Cache] Miss for "${s3Key}" (${(err as Error).message}). Regenerating…`,
      );
    }
  }

  // 4. User
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User profile not found");

  // 5. Payment (for method + date) — optional enrichment
  const payment = await Payment.findOne({ payment_id: invoice.payment_id }).lean();

  // 6. Amounts (no tax). basePrice = subtotal; discount = base - total.
  const totalAmount = invoice.amount; // Rupees
  let basePrice = totalAmount;
  if (subscription.metadata) {
    if (typeof subscription.metadata.basePlanAmountINR === "number") {
      basePrice = subscription.metadata.basePlanAmountINR;
    } else if (typeof subscription.metadata.basePlanAmount === "number") {
      basePrice = subscription.metadata.basePlanAmount / 100;
    }
  }
  if (basePrice < totalAmount) basePrice = totalAmount;
  const discountAmount = Math.max(0, basePrice - totalAmount);

  const planName =
    PLAN_DISPLAY_NAMES[subscription.planSlug] ||
    `${subscription.planSlug.toUpperCase()} Plan`;

  const cycleLabel =
    subscription.billingCycle === "yearly"
      ? "Yearly"
      : subscription.billingCycle === "quarterly"
        ? "Quarterly"
        : "Monthly";

  const methodLabel = payment?.method
    ? PAYMENT_METHOD_LABELS[payment.method] ||
      payment.method.replace(/_/g, " ")
    : "Razorpay";

  const pdfBytes = await renderInvoicePdf({
    invoiceNumber:
      invoice.number ||
      `XEN-INV-${String(invoice._id).substring(18).toUpperCase()}`,
    issueDate: invoice.billing_date,
    dueDate: invoice.billing_date,
    clientName: user.name || "Customer",
    clientEmail: user.email,
    planName,
    billingPeriod: getPeriodString(invoice.billing_date, subscription.billingCycle),
    status: invoice.status,
    lineItemDesc: `${cycleLabel} subscription`,
    unitPrice: basePrice,
    subtotal: basePrice,
    discount: discountAmount,
    total: totalAmount,
    paymentMethod: methodLabel,
    transactionId: invoice.payment_id,
    paymentDate: payment?.createdAt || invoice.billing_date,
    note: "This is a computer-generated invoice and does not require a signature. Tax is not applicable on this invoice.",
  });

  // 7. Cache to B2
  try {
    const uploadKey = `invoices/${invoiceId}.pdf`;
    await uploadObject(
      bucketName,
      uploadKey,
      pdfBytes,
      "application/pdf",
      pdfBytes.byteLength,
    );
    await SubscriptionInvoice.updateOne(
      { _id: invoiceId },
      { $set: { pdfUrl: `s3://${bucketName}/${uploadKey}` } },
    );
    console.log(`[S3/B2 Upload] Cached invoice PDF for: ${invoiceId}`);
  } catch (uploadErr) {
    console.error(
      `[S3/B2 Upload Error] invoice ${invoiceId}:`,
      (uploadErr as Error).message,
    );
  }

  return pdfBytes;
}
