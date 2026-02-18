"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import React, { useEffect, useState } from "react";
import { Plyr } from "plyr-react";
import "plyr-react/plyr.css";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ObjectData {
  id: string;
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

const MediaPlayer = ({ url, type }: { url: string; type: string }) => {
  const isAudio = type.startsWith("audio/");
  return (
    <div className={isAudio ? "w-full p-4" : "w-full"}>
      <Plyr
        source={{
          type: isAudio ? "audio" : "video",
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
  );
};
// Memoize to prevent re-renders if props haven't changed
const MemoizedMediaPlayer = React.memo(MediaPlayer);

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
      fetch(`/api/objects/${file.id}`)
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
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground/60">Loading preview...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center p-20 min-h-[300px] text-center">
          <AlertCircle className="w-12 h-12 text-destructive mb-4" />
          <p className="text-destructive mb-6">{error}</p>
          <Button
            onClick={onClose}
            variant="outline"
            className="text-foreground"
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

    // Video or Audio
    if (type.startsWith("video/") || type.startsWith("audio/")) {
      return (
        <div
          className={`rounded-lg overflow-hidden bg-black w-full flex items-center justify-center ${
            type.startsWith("video/") ? "aspect-video" : "min-h-[150px]"
          }`}
        >
          <MemoizedMediaPlayer url={url} type={type} />
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
      <DialogContent className="max-w-5xl w-full bg-card border-border text-foreground p-0 overflow-hidden gap-0">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-card/50">
          <div>
            <DialogTitle className="text-lg font-medium text-foreground truncate max-w-md">
              {file.key.split("/").pop()}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/40 text-xs mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB • {file.contentType}
            </DialogDescription>
          </div>
          <div className="flex gap-2">
            {url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(url, "_blank")}
                className="text-primary border-primary/20 hover:bg-primary/10 h-8"
              >
                Download
              </Button>
            )}
          </div>
        </div>
        <div className="p-6 bg-muted/50 flex items-center justify-center">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
