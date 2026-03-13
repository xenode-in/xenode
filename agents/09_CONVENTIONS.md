# Code Conventions & Patterns

Follow these conventions when adding or modifying code in this codebase.

---

## File & Folder Naming

- **React components:** `PascalCase.tsx` (e.g. `FileTable.tsx`, `BucketCard.tsx`)
- **Utilities/libs:** `camelCase.ts` (e.g. `downloadCache.ts`, `logRequest.ts`)
- **API route files:** always named `route.ts` (Next.js App Router convention)
- **Page files:** always named `page.tsx`
- **Layout files:** always named `layout.tsx`
- **Models:** `PascalCase.ts` matching the collection name (e.g. `StorageObject.ts`)

---

## TypeScript

- Always use explicit return types on functions
- Prefer `interface` for object shapes, `type` for unions/intersections
- Never use `any` — use `unknown` + type narrowing or proper generics
- All Mongoose models must have a TypeScript interface alongside the schema
- Zod schemas in `lib/validations.ts` → use `z.infer<typeof schema>` for types

---

## API Routes

Every API route should follow this pattern:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import dbConnect from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  // 1. Auth check first
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Connect DB
  await dbConnect();

  // 3. Parse + validate body
  const body = await request.json();
  const result = mySchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: result.error.message }, { status: 400 });

  // 4. Business logic
  try {
    // ...
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/xxx]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## React Components

- Use **server components by default** (no `'use client'` unless necessary)
- Add `'use client'` only for:
  - Components using hooks (`useState`, `useEffect`, context consumers)
  - Components with browser event handlers
  - Components using browser APIs (Web Crypto, Blob, etc.)
- Use `cn()` from `lib/utils.ts` for all className merging (never template literals with conditionals)
- Destructure props at the function signature level

---

## Styling

- **Tailwind CSS v4** — use utility classes directly
- CSS variables defined in `app/globals.css` for theming
- For complex component variants, use `class-variance-authority` (cva)
- Never use inline `style={{}}` except for dynamic values (e.g. progress percentages)
- Dark mode: use `dark:` Tailwind variant — ThemeProvider handles the class switching

---

## Database / Mongoose

- Always call `await dbConnect()` at the top of any API route that touches models
- Use `.lean()` on queries that don't need Mongoose document methods (better performance)
- Always handle the case where a document is `null` after `findById` / `findOne`
- Use Mongoose's built-in `timestamps: true` option — sets `createdAt`/`updatedAt` automatically
- Never store binary data (files) in MongoDB

---

## Error Handling

- All errors must be caught and logged with `console.error('[ROUTE_NAME]', error)`
- Return structured JSON errors: `{ error: string, code?: string }`
- Never expose stack traces or internal error messages to the client in production
- For expected errors (validation, auth), use 4xx status codes
- For unexpected errors (DB failure, B2 timeout), use 500 and log extensively

---

## Environment Variables

- Server-only secrets: no `NEXT_PUBLIC_` prefix
- Client-safe vars: must use `NEXT_PUBLIC_` prefix
- Always add new vars to `.env.example` with a comment
- Access in code: `process.env.VAR_NAME` (or `env.VAR_NAME` if using a typed env package)

---

## Imports & Path Aliases

Use the `@/` alias for all internal imports (configured in `tsconfig.json`):

```typescript
// Good
import dbConnect from '@/lib/mongodb';
import { Button } from '@/components/ui/button';

// Bad
import dbConnect from '../../../lib/mongodb';
```

---

## Testing

- Test files go in `tests/` directory
- Use Vitest (`describe`, `it`, `expect`)
- Unit test: pure functions in `lib/` (especially crypto, metering, validations)
- API routes: test with Vitest + fetch mocks
- Run tests: `npx vitest`
