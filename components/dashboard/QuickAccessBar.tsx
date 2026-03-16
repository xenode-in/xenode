import Link from "next/link";
import { Image, Music, Video, FileText, Grid3x3, Download } from "lucide-react";

const quickItems = [
  { label: "Images", icon: Image, href: "/dashboard/photos" },
  { label: "Music", icon: Music, href: "/dashboard/files?type=audio" },
  { label: "Video", icon: Video, href: "/dashboard/files?type=video" },
  { label: "Docs", icon: FileText, href: "/dashboard/files?type=docs" },
  { label: "Apps", icon: Grid3x3, href: "/dashboard/files" },
  { label: "Downloads", icon: Download, href: "/dashboard/files" },
];

export function QuickAccessBar() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-3">Quick Access</h2>
      <div className="flex items-start gap-4 flex-wrap">
        {quickItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-border flex items-center justify-center transition-all duration-200 group-hover:bg-primary/20 group-hover:scale-105">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
