function safeFileName(value: string | undefined): string {
  const normalized = (value || "download")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return normalized || "download";
}

export async function downloadFromUrl(
  url: string,
  fileName?: string,
): Promise<void> {
  const parsed = new URL(url, window.location.origin);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Unsupported download URL");
  }

  const response = await fetch(parsed.toString(), {
    method: "GET",
    credentials: parsed.origin === window.location.origin ? "same-origin" : "omit",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(
    new Blob([blob], { type: "application/octet-stream" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeFileName(fileName);
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
