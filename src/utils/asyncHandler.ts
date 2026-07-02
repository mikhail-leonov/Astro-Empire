import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async route handler so a rejected promise reaches Express's error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
