import { getAuth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const dynamic = "force-dynamic";

const handler = toNextJsHandler(getAuth());
export const { GET, POST } = handler;
