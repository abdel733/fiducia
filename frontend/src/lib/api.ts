export async function apiRequest<T>(path: string, accessToken?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(`/api/backend/${path}`, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Une erreur est survenue." })) as { message?: string | string[] };
    const message = Array.isArray(error.message) ? error.message.join(" ") : error.message;
    throw new Error(message ?? "Une erreur est survenue.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}