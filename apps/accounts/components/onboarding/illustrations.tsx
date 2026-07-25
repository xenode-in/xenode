"use client";

import { motion } from "framer-motion";

/**
 * On-brand animated onboarding illustrations, in the spirit of the v1 wizard
 * (welcome balloons, recovery kit, preferences, giving heart) but rebuilt as
 * compact, original framer-motion SVGs using the Xenode palette
 * (--primary #003fba, teal accent). `currentColor` + CSS vars keep them
 * theme-aware.
 */

const BLUE = "#003fba";
const BLUE_SOFT = "#3f6fe0";
const TEAL = "#17b8a6";
const PINK = "#f06fae";

export function WelcomeBalloons({ className }: { className?: string }) {
  const balloons: Array<{ x: number; fill: string; delay: number }> = [
    { x: 70, fill: BLUE, delay: 0 },
    { x: 120, fill: TEAL, delay: 0.4 },
    { x: 170, fill: PINK, delay: 0.8 },
  ];
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {balloons.map((b, i) => (
        <motion.g
          key={i}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: [0, -10, 0], opacity: 1 }}
          transition={{
            y: { duration: 4 + i, repeat: Infinity, ease: "easeInOut" },
            opacity: { duration: 0.6, delay: b.delay },
          }}
          style={{ transformOrigin: `${b.x}px 90px` }}
        >
          <line x1={b.x} y1="118" x2={120} y2="180" stroke="#c5d2e8" strokeWidth="1.5" />
          <ellipse cx={b.x} cy="90" rx="26" ry="32" fill={b.fill} />
          <ellipse cx={b.x - 8} cy="80" rx="7" ry="10" fill="#ffffff" opacity="0.35" />
          <path d={`M${b.x - 5} 121 L${b.x + 5} 121 L${b.x} 128 Z`} fill={b.fill} />
        </motion.g>
      ))}
      <motion.circle
        cx="120"
        cy="188"
        r="14"
        fill={BLUE}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", delay: 0.3 }}
      />
      <rect x="106" y="196" width="28" height="34" rx="12" fill={BLUE_SOFT} />
    </svg>
  );
}

export function RecoveryShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <motion.path
        d="M120 40 L180 62 V118 C180 158 154 186 120 200 C86 186 60 158 60 118 V62 Z"
        fill="#e8efff"
        stroke={BLUE}
        strokeWidth="3"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: "easeInOut" }}
      />
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", delay: 0.6 }}
        style={{ transformOrigin: "120px 118px" }}
      >
        <circle cx="120" cy="106" r="20" fill="none" stroke={BLUE} strokeWidth="6" />
        <rect x="104" y="118" width="32" height="30" rx="6" fill={BLUE} />
        <circle cx="120" cy="130" r="4" fill="#ffffff" />
        <rect x="118" y="132" width="4" height="9" rx="2" fill="#ffffff" />
      </motion.g>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={72 + i * 48}
          cy={i === 1 ? 58 : 70}
          r="4"
          fill={TEAL}
          animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.25 }}
        />
      ))}
    </svg>
  );
}

export function PreferencesScene({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="46" y="58" width="148" height="112" rx="14" fill="#e8efff" stroke={BLUE} strokeWidth="3" />
      <motion.g
        initial={{ rotate: 0 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "84px 100px" }}
      >
        <circle cx="84" cy="100" r="16" fill="none" stroke={BLUE} strokeWidth="6" />
        {Array.from({ length: 8 }).map((_, i) => (
          <rect
            key={i}
            x="81"
            y="76"
            width="6"
            height="10"
            rx="2"
            fill={BLUE}
            transform={`rotate(${i * 45} 84 100)`}
          />
        ))}
      </motion.g>
      {[132, 148].map((y, row) => (
        <g key={y}>
          <rect x="112" y={y - 3} width="66" height="6" rx="3" fill="#c5d2e8" />
          <motion.circle
            cx={row === 0 ? 132 : 158}
            cy={y}
            r="8"
            fill={TEAL}
            animate={{ cx: row === 0 ? [132, 168, 132] : [158, 122, 158] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
        </g>
      ))}
    </svg>
  );
}

export function GivingHeart({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="120" cy="150" r="52" fill="#e8efff" />
      <motion.path
        d="M120 96 C112 78 84 78 84 104 C84 126 120 148 120 148 C120 148 156 126 156 104 C156 78 128 78 120 96 Z"
        fill={TEAL}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: [1, 1.08, 1], opacity: 1 }}
        transition={{
          scale: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
          opacity: { duration: 0.5 },
        }}
        style={{ transformOrigin: "120px 118px" }}
      />
      {[0, 1, 2, 3].map((i) => (
        <motion.circle
          key={i}
          cx={70 + i * 33}
          cy={70}
          r="3.5"
          fill={i % 2 ? PINK : BLUE}
          animate={{ y: [0, -10, 0], opacity: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </svg>
  );
}
