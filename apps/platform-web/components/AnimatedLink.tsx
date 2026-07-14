"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function AnimatedLink({
  href,
  children,
  onClick,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link
      href={href}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`anim-link relative inline-flex overflow-hidden px-1 py-0.5 transition-opacity duration-300 group-has-[.anim-link:hover]:opacity-40 hover:opacity-100! ${className}`}
    >
      <span className="relative z-10">{children}</span>
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ left: "-40%" }}
            animate={{ left: "140%" }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="absolute top-0 bottom-0 w-4 bg-[#e4eac8]/20 z-0"
          />
        )}
      </AnimatePresence>
    </Link>
  );
}
