import type { ReactNode } from "react";

export const metadata = { title: "Xenode Photos", description: "Private, end-to-end encrypted photos" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ margin: 0, fontFamily: "system-ui", background: "#09090b", color: "#fafafa" }}>{children}</body></html>;
}
