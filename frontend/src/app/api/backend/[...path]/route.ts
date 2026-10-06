import { NextRequest, NextResponse } from "next/server";

const apiBase = process.env.FIDUCIA_API_URL ?? "http://localhost:4000/v1";
const refreshCookie = "fiducia_refresh";
const cookiePath = "/api/backend/auth";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const endpoint = path.join("/");
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  const accessToken = request.headers.get("authorization");
  if (accessToken) headers.set("authorization", accessToken);

  let body: BodyInit | undefined;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    if (endpoint === "auth/refresh") {
      headers.set("content-type", "application/json");
      body = JSON.stringify({ refreshToken: request.cookies.get(refreshCookie)?.value ?? "" });
    } else if (endpoint === "auth/logout") {
      headers.set("content-type", "application/json");
      body = JSON.stringify({ refreshToken: request.cookies.get(refreshCookie)?.value ?? "" });
    } else {
      body = await request.arrayBuffer();
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/${endpoint}`, { method: request.method, headers, body, cache: "no-store" });
  } catch {
    return NextResponse.json({ message: "Service temporairement indisponible. Réessayez." }, { status: 503 });
  }

  if (upstream.status === 204) {
    const response = new NextResponse(null, { status: 204 });
    if (endpoint === "auth/logout") clearRefreshCookie(response);
    return response;
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const responseBody = await upstream.arrayBuffer();
  const response = new NextResponse(responseBody, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });

  if ((endpoint === "auth/otp/verify" || endpoint === "auth/refresh") && upstream.ok) {
    const session = JSON.parse(Buffer.from(responseBody).toString("utf8")) as { refreshToken?: string };
    if (session.refreshToken) {
      const sanitized = NextResponse.json(session, { status: upstream.status, headers: { "cache-control": "no-store" } });
      sanitized.cookies.set(refreshCookie, session.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: cookiePath,
        maxAge: 60 * 60 * 24 * 30,
      });
      delete session.refreshToken;
      return NextResponse.json(session, { status: upstream.status, headers: { "cache-control": "no-store", "set-cookie": sanitized.headers.get("set-cookie") ?? "" } });
    }
  }

  if (endpoint === "users/me" && request.method === "DELETE" && upstream.ok) clearRefreshCookie(response);
  return response;
}

function clearRefreshCookie(response: NextResponse): void {
  response.cookies.set(refreshCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: cookiePath, maxAge: 0 });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;