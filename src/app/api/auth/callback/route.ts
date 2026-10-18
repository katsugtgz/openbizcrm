import { handleAuth } from "@workos-inc/authkit-nextjs";

/** WorkOS OAuth callback — required by authkit-nextjs. */
export const GET = handleAuth({ returnPathname: "/" });
