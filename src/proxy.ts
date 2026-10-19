import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { isWorkosConfigured } from "@/lib/auth/config";

/**
 * AuthKit middleware wiring. Graceful no-op when WorkOS isn't configured
 * (dev without creds, or AUTH_FAKE=1) — otherwise every request would 500.
 * Matcher excludes static assets, API routes, the auth callback, and the PWA
 * shell files (sw.js, offline.html, manifest) which must never be routed
 * through the auth gate (cubic P2 sw.js:9).
 */

const guarded: NextMiddleware = authkitProxy();

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isWorkosConfigured()) return NextResponse.next();
  return guarded(request, event);
}

export const config = {
  matcher: [
    // Run on everything except static files, the PWA shell, and the API
    // surface (the AuthKit callback route needs no proxy run of its own).
    "/((?!_next/static|_next/image|favicon.ico|api/|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
