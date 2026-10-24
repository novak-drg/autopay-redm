const CSRF_HEADER = 'x-admin-requested-with';
const CSRF_VALUE  = 'XMLHttpRequest';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(
    (options.method ?? 'GET').toUpperCase()
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(isMutation ? { [CSRF_HEADER]: CSRF_VALUE } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const baseMsg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    const details = (body as { details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } }).details;
    // Attach readable field errors when available
    if (details?.fieldErrors && Object.keys(details.fieldErrors).length > 0) {
      const fields = Object.entries(details.fieldErrors)
        .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
        .join(' | ');
      throw new Error(`${baseMsg}::${fields}`);
    }
    throw new Error(baseMsg);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                      => request<T>(path),
  post:   <T>(path: string, body: unknown)       => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)       => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                      => request<T>(path, { method: 'DELETE' }),
};
