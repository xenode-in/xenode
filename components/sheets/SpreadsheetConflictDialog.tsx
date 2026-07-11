"use client";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
export function SpreadsheetConflictDialog({ open, onReload, onDownload, onSaveCopy, onCancel }: { open: boolean; onReload: () => void; onDownload: () => void; onSaveCopy: () => void; onCancel: () => void }) {
  return <AlertDialog open={open}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>A newer revision exists</AlertDialogTitle><AlertDialogDescription>Your local edits were not overwritten or uploaded. Choose how to resolve the conflict.</AlertDialogDescription></AlertDialogHeader><div className="grid gap-2"><Button onClick={onReload}>Reload latest encrypted version</Button><Button variant="outline" onClick={onDownload}>Download local edited workbook</Button><Button variant="outline" onClick={onSaveCopy}>Save local edits as a new file</Button></div><AlertDialogFooter><AlertDialogCancel onClick={onCancel}>Keep editing locally</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

