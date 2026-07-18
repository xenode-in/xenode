const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function main() {
  const pdfPath = path.join(__dirname, '..', 'fillabale.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF file not found at: ${pdfPath}`);
    process.exit(1);
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  console.log(`Found ${fields.length} fields in the PDF:`);
  fields.forEach(field => {
    const type = field.constructor.name;
    const name = field.getName();
    console.log(`- [${type}] Name: "${name}"`);
  });
}

main().catch(err => {
  console.error(err);
});
