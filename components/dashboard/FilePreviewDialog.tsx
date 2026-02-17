"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { Plyr } from "plyr-react";
import "plyr-react/plyr.css";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ObjectData {
  _id: string;
  key: string;
  size: number;
  contentType: string;
  createdAt: string;
}

interface FilePreviewDialogProps {
  file: ObjectData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function FilePreviewDialog({
  file,
  isOpen,
  onClose,
}: FilePreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && file) {
      setLoading(true);
      setError("");
      // Fetch fresh url
      fetch(`/api/objects/${file._id}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to get URL");
          return res.json();
        })
        .then((data) => {
          if (data.url) setUrl(data.url);
          else throw new Error("No URL returned");
        })
        .catch((err) => {
          console.error(err);
          setError("Failed to load preview. Please try downloading instead.");
        })
        .finally(() => setLoading(false));
    } else {
      setUrl(null);
      setError("");
    }
  }, [isOpen, file]);

  if (!file) return null;

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center p-20 min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#7cb686] mb-4" />
          <p className="text-[#e8e4d9]/60">Loading preview...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center p-20 min-h-[300px] text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
          <p className="text-red-400 mb-6">{error}</p>
          <Button
            onClick={onClose}
            variant="outline"
            className="text-[#e8e4d9]"
          >
            Close Preview
          </Button>
        </div>
      );
    }

    if (!url) return null;

    const type = file.contentType;

    // Image
    if (type.startsWith("image/")) {
      return (
        <div className="flex items-center justify-center bg-black/40 rounded-lg overflow-hidden min-h-[300px] max-h-[70vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={file.key}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      );
    }

    // Video
    if (type.startsWith("video/")) {
      return (
        <div className="rounded-lg overflow-hidden bg-black aspect-video w-full flex items-center justify-center">
          <div className="w-full">
            <Plyr
              source={{
                type: "video",
                sources: [
                  {
                    src: url,
                    type: type,
                  },
                ],
              }}
              options={{
                autoplay: true,
              }}
            />
          </div>
        </div>
      );
    }

    // PDF -> Explicit iframe usually better than DocViewer for simple PDF
    if (type === "application/pdf") {
      return (
        <div className="w-full h-[70vh] bg-white rounded-lg overflow-hidden">
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={file.key}
          />
        </div>
      );
    }

    // Docs (DocViewer)
    const docs = [{ uri: url, fileType: type }];

    return (
      <div className="w-full h-[70vh] bg-white rounded-lg overflow-hidden doc-viewer-container">
        <DocViewer
          documents={docs}
          pluginRenderers={DocViewerRenderers}
          config={{
            header: {
              disableHeader: true,
              disableFileName: true,
              retainURLParams: true,
            },
            pdfVerticalScrollByDefault: true,
          }}
          style={{ height: "100%" }}
        />
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-full bg-[#1a2e1d] border-white/10 text-[#e8e4d9] p-0 overflow-hidden gap-0">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-[#1a2e1d]/50">
          <div>
            <DialogTitle className="text-lg font-medium text-[#e8e4d9] truncate max-w-md">
              {file.key.split("/").pop()}
            </DialogTitle>
            <DialogDescription className="text-[#e8e4d9]/40 text-xs mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB • {file.contentType}
            </DialogDescription>
          </div>
          <div className="flex gap-2">
            {url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(url, "_blank")}
                className="text-[#7cb686] border-[#7cb686]/20 hover:bg-[#7cb686]/10 h-8"
              >
                Download
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-[#e8e4d9]/60 hover:text-[#e8e4d9] h-8 w-8"
            >
              {/* Close handled by DialogPrimitive but explicit valid too */}
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>
        <div className="p-6 bg-[#0f1a12]/50 flex items-center justify-center">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
