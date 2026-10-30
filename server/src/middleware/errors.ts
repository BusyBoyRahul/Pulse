import {Request, Response, NextFunction} from 'express';
import {ZodError} from 'zod';

/** Wrap async route handlers so thrown errors reach the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({error: err.issues[0]?.message ?? 'Invalid request.'});
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({error: err.message});
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({error: 'Internal server error.'});
}
