import React from "react";
import { motion } from "framer-motion";

const CheckIcon = () => (
  <svg
    className="w-4 h-4 text-gray-400 mr-3 flex-shrink-0 mt-0.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    <circle cx="12" cy="12" r="10" />
  </svg>
);

const pricingPlans = [
  {
    name: "Starter Plan",
    description:
      "Beginners who want to explore Synthesia without any commitment.",
    price: "18.00",
    buttonText: "Upgrade",
    buttonClass:
      "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10",
    cardClass: "bg-[#0f111a] border-[#1f2233]",
    headerGlow: "from-blue-600/40 via-indigo-500/20 to-transparent",
    limits: ["1 editor, 3 guest commenters", "120 video minutes per year"],
    featuresTitle: "Features",
    features: [
      "125+ AI avatars",
      "3 personal avatars",
      "AI assistant",
      "Sharing and commenting",
      "Studio avatars (paid add-on)",
      "Download videos",
    ],
  },
  {
    name: "Creator Plan",
    description:
      "Freelancers or small teams that need more flexibility and downloadable content.",
    price: "64.00",
    buttonText: "Upgrade",
    buttonClass:
      "bg-gradient-to-r from-indigo-500/80 via-purple-500/80 to-pink-500/80 hover:opacity-90 text-white border-0",
    cardClass: "bg-gradient-to-b from-[#1a1325] to-[#2a1b38] border-[#3a2848]",
    headerGlow: "from-pink-600/40 via-purple-500/30 to-transparent",
    badge: "Save 25%",
    limits: ["1 editor, 5 guest commenters", "360 video minutes per year"],
    featuresTitle: "Everything In Starter Plus...",
    features: [
      "Selected industry avatars",
      "5 personal avatars",
      "Premium voices",
      "Custom fonts",
      "Branded share page",
      "Synthesia API",
    ],
  },
  {
    name: "Enterprise Plan",
    description:
      "Content creators, marketers, and small businesses producing video content regularly.",
    price: "112.00",
    buttonText: "Book Demo",
    buttonClass:
      "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10",
    cardClass: "bg-gradient-to-b from-[#0a1512] to-[#10201c] border-[#1a3028]",
    headerGlow: "from-emerald-600/30 via-teal-500/20 to-transparent",
    limits: ["Custom no. of editors and guests", "Unlimited video minutes"],
    featuresTitle: "Everything In Creator Plus...",
    features: [
      "All industry avatars",
      "Unlimited personal avatars",
      "Branded AI avatars (paid add-on)",
      "Voice cloning",
      "Shared workspace",
      "SAML/SSO",
    ],
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" as const },
  },
};

export default function PricingSection() {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 font-sans text-gray-200">
      <motion.div
        className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-3 gap-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {pricingPlans.map((plan, index) => (
          <motion.div
            key={plan.name}
            variants={cardVariants}
            whileHover={{ y: -8, transition: { duration: 0.3 } }}
            className={`relative flex flex-col rounded-3xl border overflow-hidden ${plan.cardClass} shadow-2xl`}
          >
            {/* Abstract Header Glow (Simulating the fluid images) */}
            <div
              className={`absolute top-0 left-0 right-0 h-40 bg-gradient-to-b ${plan.headerGlow} opacity-60 blur-2xl pointer-events-none`}
            />

            {/* Badge for Creator Plan */}
            {plan.badge && (
              <div className="absolute top-0 right-6 bg-black text-white text-xs font-semibold px-3 py-4 rounded-b-xl shadow-lg z-10 flex flex-col items-center">
                <span className="text-gray-400 text-[10px] leading-tight">
                  Save
                </span>
                <span>25%</span>
              </div>
            )}

            <div className="p-8 relative z-10 flex-grow flex flex-col">
              {/* Header Info */}
              <div className="mb-8 mt-4">
                <h3 className="text-xl font-medium text-white mb-3">
                  {plan.name}
                </h3>
                <p className="text-sm text-gray-400 leading-relaxed min-h-[40px]">
                  {plan.description}
                </p>
              </div>

              {/* Price */}
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-semibold text-white">
                  ${plan.price}
                </span>
                <span className="text-sm text-gray-500 ml-2">/ monthly</span>
              </div>

              {/* Action Button */}
              <button
                className={`w-full py-3 px-4 rounded-xl text-sm font-medium transition-all duration-300 mb-8 ${plan.buttonClass}`}
              >
                {plan.buttonText}
              </button>

              <hr className="border-t border-white/5 mb-8" />

              {/* Plan Limits */}
              <div className="mb-8">
                <h4 className="text-[15px] font-medium text-white mb-4">
                  Plan Limits
                </h4>
                <ul className="space-y-3">
                  {plan.limits.map((limit, i) => (
                    <li
                      key={i}
                      className="flex items-start text-sm text-gray-300"
                    >
                      <CheckIcon />
                      <span>{limit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Features */}
              <div className="flex-grow">
                <h4 className="text-[15px] font-medium text-white mb-4">
                  {plan.featuresTitle}
                </h4>
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li
                      key={i}
                      className="flex items-start text-sm text-gray-300"
                    >
                      <CheckIcon />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
