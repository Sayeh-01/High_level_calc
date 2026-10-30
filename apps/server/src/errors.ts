export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 503,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'not_found') => new HttpError(404, what);
export const forbidden = (what = 'forbidden') => new HttpError(403, what);
export const badRequest = (code: string, message?: string, details?: unknown) => new HttpError(400, code, message, details);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
