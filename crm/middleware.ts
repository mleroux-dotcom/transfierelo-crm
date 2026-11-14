import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, apiKeyFrom, safeEqual, sessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/health" || pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }

  const expected = await sessionToken();
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const loggedIn = !!expected && !!cookie && safeEqual(cookie, expected);

  if (pathname.startsWith("/api/")) {
    const apiKey = process.env.CRM_API_KEY;
    const provided = apiKeyFrom(req.headers);
    if (loggedIn || (apiKey && provided && safeEqual(provided, apiKey))) return NextResponse.next();
    return NextResponse.json({ error: "No autorizado. Envía la cabecera x-api-key." }, { status: 401 });
  }

  if (!loggedIn) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
