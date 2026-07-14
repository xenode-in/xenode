import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="text-4xl font-bold mt-8 mb-4 text-foreground">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-3xl font-semibold mt-8 mb-3 text-foreground">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-2xl font-semibold mt-6 mb-2 text-foreground">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-lg leading-relaxed mb-4 text-muted-foreground">
        {children}
      </p>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
      >
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-4 space-y-2 text-muted-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-4 space-y-2 text-muted-foreground">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="text-lg">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children }) => (
      <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-primary">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-muted rounded-lg p-4 overflow-x-auto my-4 border border-border">
        {children}
      </pre>
    ),
    hr: () => <hr className="border-border my-8" />,
    ...components,
  };
}
