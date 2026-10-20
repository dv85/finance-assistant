import { headers } from "next/headers";
import { localRequestAllowed } from "../src/lib/localAccess.js";

// Compatibility type for the existing route interfaces; no remote identity is trusted.
export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  if (!localRequestAllowed(requestHeaders, {
    development: process.env.NODE_ENV === "development",
    enabled: process.env.FINANCE_LOCAL_MODE === "true",
  })) return null;
  return { userId: "local-owner", displayName: "Local workspace", email: "local@example.invalid", fullName: null };
}
