"use client";

import { AnimatePresence, motion, Variants } from "framer-motion";

import { cn } from "@/lib/utils";

interface GradualSpacingProps {
  text: string;
  duration?: number;
  delayMultiple?: number;
  framerProps?: Variants;
  className?: string;
}

function GradualSpacing({
  text,
  duration = 0.5,
  delayMultiple = 0.04,
  framerProps = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0 },
  },
  className,
}: GradualSpacingProps) {
  return (
    <div className="flex justify-start flex-wrap">
      <AnimatePresence>
        {text.split(" ").map((word, wordIndex) => (
          <div key={wordIndex} className="flex whitespace-nowrap">
            {word.split("").map((char, charIndex) => {
              const globalIndex =
                text.split(" ").slice(0, wordIndex).join("").length +
                wordIndex +
                charIndex;
              
              return (
                <motion.h1
                  key={globalIndex}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  variants={framerProps}
                  transition={{ duration, delay: globalIndex * delayMultiple }}
                  className={cn("drop-shadow-sm", className)}
                >
                  {char}
                </motion.h1>
              );
            })}
            {wordIndex < text.split(" ").length - 1 && (
              <span className={className}>&nbsp;</span>
            )}
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export { GradualSpacing };