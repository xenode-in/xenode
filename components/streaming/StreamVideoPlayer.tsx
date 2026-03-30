"use client";

import { useEffect, useRef } from "react";
import { useMSEStream } from "@/hooks/useMSEStream";

export default function StreamVideoPlayer({ streamOpts, type }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useMSEStream(streamOpts, videoRef.current);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      {type.startsWith("audio/") ? (
        <audio
          ref={videoRef as any}
          controls
          autoPlay
          className="w-full"
        />
      ) : (
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="w-full h-full object-contain bg-black"
        />
      )}
    </div>
  );
}
