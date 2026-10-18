import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";

/**
 * AuthKit middleware wiring. Graceful no-op when WorkOS isn't configured
 * (dev without creds, or AUTH_FAKE=1) — otherwise every request would 500.
 * Matcher excludes static assets, API routes, and the auth callback.
 */
function isWorkosConfigured(): boolean {
  return (
    process.env.AUTH_FAKE !== "1" &&
    !!process.env.WORKOS_API_KEY &&
    !!process.env.WORKOS_CLIENT_ID &&
    !!process.env.WORKOS_COOKIE_PASSWORD
  );
}

const guarded: NextMiddleware = authkitProxy();

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!isWorkosConfigured()) return NextResponse.next();
  return guarded(request, event);
}

export const config = {
  matcher: [
    // Run on everything except static files, api/auth callback, and assets.
    "/((?!_next/static|_next/image|favicon.ico|api/auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
