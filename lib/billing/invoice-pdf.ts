import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import dbConnect from "@/lib/mongodb";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Subscription from "@/models/Subscription";
import { User } from "@/models/User";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/b2/client";
import { uploadObject } from "@/lib/b2/objects";
import fontkit from "@pdf-lib/fontkit";

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free Tier",
  basic: "Basic Plan",
  pro: "Pro Plan",
  plus: "Plus Plan",
  max: "Max Plan",
  enterprise: "Enterprise Suite",
};

/**
 * Formats a date into "Month DD, YYYY" (e.g., "June 02, 2026")
 */
function formatDateString(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}

/**
 * Generates the subscription plan period string based on the cycle
 */
function getPeriodString(startDate: Date, cycle: string): string {
  const start = new Date(startDate);
  const end = new Date(startDate);

  if (cycle === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else if (cycle === "quarterly") {
    end.setMonth(end.getMonth() + 3);
  } else {
    // Default to monthly
    end.setMonth(end.getMonth() + 1);
  }

  const formatShortDate = (d: Date) => {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  };

  return `(${formatShortDate(start)} - ${formatShortDate(end)})`;
}

/**
 * Main function to generate the filled PDF bytes for a given invoice and user.
 * Performs user scoping checks to ensure users can only generate their own invoices.
 */
export async function generateInvoicePdfBuffer(
  invoiceId: string,
  userId: string,
): Promise<Uint8Array> {
  await dbConnect();

  // 1. Fetch Invoice
  const invoice = await SubscriptionInvoice.findById(invoiceId).lean();
  if (!invoice) {
    throw new Error("Invoice not found");
  }

  // 2. Fetch Subscription associated with invoice
  const subscription = await Subscription.findOne({
    subscription_id: invoice.subscription_id,
  }).lean();

  if (!subscription) {
    throw new Error("Subscription not found for this invoice");
  }

  // Security Check: Ensure caller owns the subscription/invoice
  if (subscription.userId !== userId) {
    throw new Error("Unauthorized access to invoice");
  }

  const bucketName = process.env.S3_BUCKET_NAME || "xenode-drive-storage";
  let s3Key = `invoices/${invoiceId}.pdf`;

  // 3. Try to fetch cached PDF from S3/B2 if pdfUrl is set
  if (invoice.pdfUrl) {
    try {
      if (invoice.pdfUrl.startsWith("s3://")) {
        const parts = invoice.pdfUrl.replace("s3://", "").split("/");
        parts.shift(); // Remove the bucket name part
        s3Key = parts.join("/");
      } else {
        s3Key = invoice.pdfUrl;
      }

      const s3Client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });
      const s3Response = await s3Client.send(command);
      if (s3Response.Body) {
        const bytes = await s3Response.Body.transformToByteArray();
        console.log(`[S3/B2 Cache] Served cached invoice PDF from S3 key: ${s3Key}`);
        return bytes;
      }
    } catch (err: any) {
      console.warn(`[S3/B2 Cache Warning] Failed to fetch cached PDF from key "${s3Key}": ${err.message}. Re-generating...`);
    }
  }

  // 4. Fetch User profile details
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new Error("User profile not found");
  }

  // 5. Determine amounts (handling Paise to Rupee conversions and metadata)
  const totalAmount = invoice.amount; // already in Rupees in SubscriptionInvoice
  
  // Extract base plan price from subscription metadata if available, else default to total amount
  let basePrice = totalAmount;
  if (subscription.metadata) {
    if (typeof subscription.metadata.basePlanAmountINR === "number") {
      basePrice = subscription.metadata.basePlanAmountINR;
    } else if (typeof subscription.metadata.basePlanAmount === "number") {
      basePrice = subscription.metadata.basePlanAmount / 100;
    }
  }

  // Ensure base price is at least total amount
  if (basePrice < totalAmount) {
    basePrice = totalAmount;
  }

  const discountAmount = Math.max(0, basePrice - totalAmount);

  // 6. Construct field values mapped to the PDF form text fields
  const invoiceData = {
    invoice_id: invoice.number || `XEN-INV-${String(invoice._id).substring(18).toUpperCase()}`,
    date: formatDateString(invoice.billing_date),
    billed_to: `${user.name || "Customer"}\n${user.email}`,
    payment_details: `Transaction ID: ${invoice.payment_id}\nPaid via: Razorpay\nStatus: ${invoice.status.toUpperCase()}`,
    plan: PLAN_DISPLAY_NAMES[subscription.planSlug] || `${subscription.planSlug.toUpperCase()} Plan`,
    plan_period: getPeriodString(invoice.billing_date, subscription.billingCycle),
    amount: `INR ${basePrice.toFixed(2)}`,
    sub_total: `INR ${basePrice.toFixed(2)}`,
    discount: `INR ${discountAmount.toFixed(2)}`,
    total: `INR ${totalAmount.toFixed(2)}`,
  };

  // 7. Read fillable PDF template
  const templatePath = path.join(process.cwd(), "fillabale.pdf");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PDF template file not found at: ${templatePath}`);
  }
  const templateBytes = fs.readFileSync(templatePath);

  // 8. Load, fill and flatten PDF form
  const pdfDoc = await PDFDocument.load(templateBytes);

  // Load and embed custom Seasons TTF font if it exists
  const fontPath = path.join(process.cwd(), "public", "The Seasons Light.ttf");
  let customFont;
  if (fs.existsSync(fontPath)) {
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = fs.readFileSync(fontPath);
    customFont = await pdfDoc.embedFont(fontBytes);
    console.log(`[Font] Embedded Seasons TTF font into PDF invoice`);
  }

  const form = pdfDoc.getForm();

  for (const [key, value] of Object.entries(invoiceData)) {
    try {
      const field = form.getTextField(key);
      let textValue = value !== undefined && value !== null ? String(value) : "";
      // Replace Rupee symbol with INR to prevent WinAnsi standard font crashes
      textValue = textValue.replace(/₹/g, "INR ");
      field.setText(textValue);
      if (customFont) {
        field.updateAppearances(customFont);
      }
    } catch (err: any) {
      console.warn(`[Warning] Could not fill field "${key}": ${err.message}`);
    }
  }

  // Flatten the form to make the fields non-editable and render text to the PDF body
  form.flatten();

  // 9. Serialize the PDF to bytes
  const pdfBytes = await pdfDoc.save();

  // 10. Upload the generated PDF to S3/B2 and map the URL back to MongoDB
  try {
    const uploadKey = `invoices/${invoiceId}.pdf`;
    await uploadObject(
      bucketName,
      uploadKey,
      pdfBytes,
      "application/pdf",
      pdfBytes.byteLength
    );
    await SubscriptionInvoice.updateOne(
      { _id: invoiceId },
      { $set: { pdfUrl: `s3://${bucketName}/${uploadKey}` } }
    );
    console.log(`[S3/B2 Upload] Uploaded generated PDF and updated MongoDB for invoice: ${invoiceId}`);
  } catch (uploadErr: any) {
    console.error(`[S3/B2 Upload Error] Failed to upload PDF for invoice ${invoiceId}:`, uploadErr);
  }

  return pdfBytes;
}
