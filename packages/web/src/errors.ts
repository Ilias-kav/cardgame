import { ApiError } from './api.js';

/** A message a player can understand, from any error thrown by the API client. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      const parts = (error.details as Array<{ message?: string }>).map((d) => d.message).filter(Boolean);
      if (parts.length > 0) return parts.join('. ');
    }
    if (error.code === 'DECK_INVALID' && Array.isArray(error.details)) {
      const parts = (error.details as Array<{ message?: string }>).map((d) => d.message).filter(Boolean);
      if (parts.length > 0) return `${error.message}: ${parts.join('; ')}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
