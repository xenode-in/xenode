import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

function safePdfText(value: string): string {
  return value.replace(/[^\x20-\x7E]/gu, "").slice(0, 120);
}

export async function createRecoveryKitPdf(params: {
  accountLabel: string;
  generatedDate: string;
  recoveryPhrase: string;
}): Promise<Uint8Array> {
  const words = params.recoveryPhrase.trim().split(/\s+/u);
  if (words.length !== 12) {
    throw new Error("Recovery phrase must contain exactly 12 words.");
  }

  const document = await PDFDocument.create();
  document.setTitle("Xenode Recovery Kit");
  document.setSubject("End-to-end encrypted account recovery phrase");
  document.setCreator("Xenode Accounts");

  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const mono = await document.embedFont(StandardFonts.CourierBold);
  const blue = rgb(0.05, 0.3, 0.78);
  const ink = rgb(0.03, 0.09, 0.2);
  const muted = rgb(0.32, 0.38, 0.49);
  const line = rgb(0.82, 0.86, 0.93);
  const wash = rgb(0.96, 0.97, 1);

  page.drawText("Xenode", {
    x: 52,
    y: 776,
    size: 26,
    font: bold,
    color: blue,
  });
  page.drawText("ACCOUNT RECOVERY KIT", {
    x: 52,
    y: 757,
    size: 9,
    font: bold,
    color: muted,
  });
  page.drawText(`Account: ${safePdfText(params.accountLabel)}`, {
    x: 355,
    y: 778,
    size: 9,
    font: regular,
    color: muted,
  });
  page.drawText(`Generated: ${safePdfText(params.generatedDate)}`, {
    x: 355,
    y: 761,
    size: 9,
    font: regular,
    color: muted,
  });
  page.drawLine({
    start: { x: 52, y: 738 },
    end: { x: 543, y: 738 },
    thickness: 1.2,
    color: line,
  });

  page.drawText("Your 12-word recovery phrase", {
    x: 52,
    y: 700,
    size: 21,
    font: bold,
    color: ink,
  });
  page.drawText(
    "Use this phrase if you lose every trusted device, passkey, or Vault password.",
    { x: 52, y: 675, size: 10.5, font: regular, color: muted },
  );
  page.drawText(
    "Xenode never receives it and cannot recover it for you.",
    { x: 52, y: 659, size: 10.5, font: regular, color: muted },
  );

  page.drawRectangle({
    x: 52,
    y: 410,
    width: 491,
    height: 220,
    borderColor: line,
    borderWidth: 1,
    color: wash,
  });
  page.drawText("RECOVERY PHRASE", {
    x: 70,
    y: 604,
    size: 9,
    font: bold,
    color: blue,
  });

  const cellWidth = 146;
  const cellHeight = 38;
  words.forEach((word, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 70 + column * (cellWidth + 10);
    const y = 548 - row * (cellHeight + 9);
    page.drawRectangle({
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      borderColor: line,
      borderWidth: 0.8,
      color: rgb(1, 1, 1),
    });
    page.drawText(`${index + 1}.`, {
      x: x + 10,
      y: y + 14,
      size: 8.5,
      font: regular,
      color: muted,
    });
    page.drawText(safePdfText(word), {
      x: x + 31,
      y: y + 12,
      size: 12,
      font: mono,
      color: ink,
    });
  });

  page.drawText("KEEP IT SAFE", {
    x: 52,
    y: 365,
    size: 10,
    font: bold,
    color: ink,
  });
  const tips = [
    "Store this PDF offline or print it and keep it in a secure place.",
    "Keep all words in the exact order shown above.",
    "Do not email, message, photograph, or share this phrase.",
    "Anyone with this phrase can unlock your encrypted Vault.",
  ];
  tips.forEach((tip, index) => {
    page.drawCircle({
      x: 58,
      y: 341 - index * 25,
      size: 2.2,
      color: blue,
    });
    page.drawText(tip, {
      x: 70,
      y: 337 - index * 25,
      size: 10.5,
      font: regular,
      color: muted,
    });
  });

  page.drawRectangle({
    x: 52,
    y: 190,
    width: 491,
    height: 58,
    borderColor: rgb(0.91, 0.68, 0.28),
    borderWidth: 1,
    color: rgb(1, 0.97, 0.89),
  });
  page.drawText("Security warning", {
    x: 68,
    y: 223,
    size: 10.5,
    font: bold,
    color: rgb(0.48, 0.31, 0.05),
  });
  page.drawText(
    "Treat this document like the key to a safe. Xenode support will never ask for it.",
    {
      x: 68,
      y: 204,
      size: 9.5,
      font: regular,
      color: rgb(0.48, 0.31, 0.05),
    },
  );

  page.drawLine({
    start: { x: 52, y: 142 },
    end: { x: 543, y: 142 },
    thickness: 0.8,
    color: line,
  });
  page.drawText(
    "Generated locally in your browser. The recovery phrase never left this device.",
    { x: 105, y: 121, size: 9, font: regular, color: muted },
  );

  return document.save();
}
