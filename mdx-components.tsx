import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="text-4xl font-bold mt-8 mb-4 text-[#e8e4d9]">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-3xl font-semibold mt-8 mb-3 text-[#e8e4d9]">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-2xl font-semibold mt-6 mb-2 text-[#e8e4d9]">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-lg leading-relaxed mb-4 text-[#e8e4d9]/80">
        {children}
      </p>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-[#7cb686] hover:text-[#a5d4ad] underline underline-offset-2 transition-colors"
      >
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-4 space-y-2 text-[#e8e4d9]/80">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-4 space-y-2 text-[#e8e4d9]/80">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="text-lg">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-[#7cb686] pl-4 italic my-4 text-[#e8e4d9]/70">
        {children}
      </blockquote>
    ),
    code: ({ children }) => (
      <code className="bg-black/30 px-1.5 py-0.5 rounded text-sm font-mono text-[#7cb686]">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-black/40 rounded-lg p-4 overflow-x-auto my-4 border ">
        {children}
      </pre>
    ),
    hr: () => <hr className="border-white/20 my-8" />,
    ...components,
  };
}
