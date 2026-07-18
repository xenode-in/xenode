const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

/**
 * Fills a fillable PDF invoice with provided data.
 * 
 * @param {string} sourcePath - Path to the fillable PDF template
 * @param {string} outputPath - Path where the filled PDF will be saved
 * @param {Object} data - Key-value pairs matching PDF form field names
 * @param {boolean} flatten - If true, flattens the form fields so the PDF is no longer editable
 */
async function fillInvoicePdf(sourcePath, outputPath, data, flatten = true) {
  try {
    // Read the PDF template
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Template PDF file not found at: ${sourcePath}`);
    }
    const pdfBytes = fs.readFileSync(sourcePath);

    // Load the PDF document
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Register fontkit and embed the custom Seasons TTF font if it exists
    const fontPath = path.join(__dirname, '..', 'public', 'The Seasons Light.ttf');
    let customFont;
    if (fs.existsSync(fontPath)) {
      const fontkit = require('@pdf-lib/fontkit');
      pdfDoc.registerFontkit(fontkit);
      const fontBytes = fs.readFileSync(fontPath);
      // Use embedFont to support custom OTF/TTF files
      customFont = await pdfDoc.embedFont(fontBytes);
      console.log(`[Font] Loaded and embedded custom font: The Seasons Light.ttf`);
    }

    // Get the interactive form
    const form = pdfDoc.getForm();

    // Fill each field in the data object
    for (const [key, value] of Object.entries(data)) {
      try {
        const field = form.getTextField(key);
        // Ensure value is a string and sanitize unsupported characters
        let textValue = value !== undefined && value !== null ? String(value) : '';
        // Replace Rupee symbol with INR to prevent encoding issues
        textValue = textValue.replace(/₹/g, 'INR ');
        
        field.setText(textValue);
        if (customFont) {
          field.updateAppearances(customFont);
        }
      } catch (err) {
        console.warn(`[Warning] Could not fill field "${key}": ${err.message}`);
      }
    }

    // Flatten form fields if requested (renders the values into the page contents and removes form controls)
    if (flatten) {
      form.flatten();
    }

    // Serialize the PDF to bytes
    const filledPdfBytes = await pdfDoc.save();

    // Write output file
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, filledPdfBytes);

    console.log(`[Success] Filled PDF saved successfully to: ${outputPath}`);
    return true;
  } catch (error) {
    console.error(`[Error] Failed to fill PDF:`, error);
    throw error;
  }
}

// Dry-testing block
if (require.main === module) {
  const sourcePdf = path.join(__dirname, '..', 'fillabale.pdf');
  const outputPdf = path.join(__dirname, '..', 'test-filled-invoice.pdf');

  // Realistic mock data for Xenode SaaS subscription
  const mockInvoiceData = {
    invoice_id: "XN-2026-06-00482",
    date: "June 02, 2026",
    billed_to: "Santhosh Kumar\nsanthosh@xenode.dev",
    payment_details: "Transaction ID: pay_P8jH2l9oK1m3\nPaid via: Razorpay (UPI)\nStatus: SUCCESS\nTime: 2026-06-02 19:40:15 IST",
    plan: "Xenode Premium - Developer Suite",
    plan_period: "(Jun 02, 2026 - Jul 02, 2026)",
    amount: "INR 1,499.00",
    sub_total: "INR 1,499.00",
    discount: "INR 150.00",
    total: "INR 1,349.00"
  };

  console.log("Starting dry run testing of PDF Invoice filling...");
  console.log(`Source: ${sourcePdf}`);
  console.log(`Destination: ${outputPdf}\n`);

  fillInvoicePdf(sourcePdf, outputPdf, mockInvoiceData, true)
    .then(() => {
      console.log("\nDry run completed successfully!");
      console.log("You can check 'test-filled-invoice.pdf' in the root directory to verify visual layout.");
    })
    .catch((err) => {
      console.error("\nDry run failed:", err.message);
      process.exit(1);
    });
}

module.exports = { fillInvoicePdf };
