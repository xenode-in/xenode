import { notFound } from "next/navigation";
import { SpreadsheetLab } from "@/components/sheets/SpreadsheetLab";
export default function SheetsLabPage() { if (process.env.NODE_ENV === "production" && process.env.SHEETS_LAB_ENABLED !== "true") notFound(); return <SpreadsheetLab/>; }

