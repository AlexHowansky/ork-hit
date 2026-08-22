/**
 * Typed client for the JSON API.
 *
 * Every response carries either the payload or `{ error: { code, message } }`,
 * where the message is already written for a person to read. `ApiError` keeps
 * both so a caller can show the message and branch on the code.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const GENERIC = "Something went wrong. Please try again.";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    // A network failure, or the server restarting mid-request.
    throw new ApiError("network", "We couldn't reach the server. Check your connection.", 0);
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(error?.code ?? "unknown", error?.message ?? GENERIC, response.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  postJson: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  putJson: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  patchJson: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  // Multipart, for the endpoints that take an upload. The browser sets the
  // Content-Type (with its boundary) itself.
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),

  patchForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "PATCH", body: form }),

  delete: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),

  post: <T = void>(path: string) => request<T>(path, { method: "POST" }),
};
