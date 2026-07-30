import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export const notFound = (resource: string) =>
  new AppError(404, 'NOT_FOUND', `${resource} was not found.`);

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'The request contains invalid data.',
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  if (error instanceof Error) {
    if (error.message === 'SIMULATION_END_REACHED') {
      return new AppError(
        409,
        'SIMULATION_END_REACHED',
        'The simulation cannot advance beyond 1945.',
      );
    }
    if (error.message.startsWith('UNKNOWN_NATION_STATE:')) {
      return new AppError(422, 'INVALID_AI_RESPONSE', 'The AI referenced an unknown nation.');
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
}

export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const appError = toAppError(error);
  const requestId = String(res.locals.requestId ?? 'unknown');
  if (appError.status >= 500) {
    req.app.locals.logger?.error({ err: error, requestId }, 'request failed');
  }
  res
    .status(appError.status)
    .type('application/problem+json')
    .json({
      type: `https://what-if-history.local/problems/${appError.code.toLowerCase()}`,
      title: appError.code
        .toLowerCase()
        .split('_')
        .map((word) => word[0]?.toUpperCase() + word.slice(1))
        .join(' '),
      status: appError.status,
      code: appError.code,
      detail: appError.message,
      requestId,
      ...(appError.issues ? { issues: appError.issues } : {}),
    });
}
