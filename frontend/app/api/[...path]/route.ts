import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

async function proxy(req: NextRequest, params: { path: string[] }) {
  const path = params.path.join("/");
  const search = req.nextUrl.search;
  const url = `${BACKEND}/${path}${search}`;

  const isBodyless = ["GET", "HEAD"].includes(req.method);

  // Buffer the body upfront so we can resend it if the backend redirects.
  // FastAPI redirects /foo → /foo/ (307); undici can't resend a streamed body.
  const bodyBuffer = isBodyless ? undefined : await req.arrayBuffer();

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "host") headers.set(key, value);
  });

  const doFetch = (target: string) =>
    fetch(target, {
      method: req.method,
      headers,
      body: bodyBuffer,
      redirect: "manual",          // never let undici follow redirects automatically
    } as RequestInit);

  let upstream = await doFetch(url);

  // Follow a single 3xx redirect (trailing-slash redirect from FastAPI)
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (location) {
      const redirectTarget = location.startsWith("http")
        ? location
        : `${BACKEND}${location}`;
      upstream = await doFetch(redirectTarget);
    }
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => resHeaders.set(key, value));

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
