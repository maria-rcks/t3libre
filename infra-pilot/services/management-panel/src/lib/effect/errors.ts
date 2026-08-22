import { Cause } from 'effect';

export class ApiError extends Error {
  readonly _tag = 'ApiError';
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  readonly _tag = 'NetworkError';
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthError extends Error {
  readonly _tag = 'AuthError';
  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends Error {
  readonly _tag = 'NotFoundError';
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly _tag = 'ValidationError';
  constructor(message: string, public readonly errors?: string[]) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type DomainError = ApiError | NetworkError | AuthError | NotFoundError | ValidationError;

export const domainErrorFromCause = (cause: Cause.Cause<unknown>): DomainError | null => {
  const failure = Cause.failureOption(cause);
  if (failure._tag === 'None') return null;
  const err = failure.value;
  if (err instanceof ApiError) return err;
  if (err instanceof NetworkError) return err;
  if (err instanceof AuthError) return err;
  if (err instanceof NotFoundError) return err;
  if (err instanceof ValidationError) return err;
  return new ApiError(String(err));
};
