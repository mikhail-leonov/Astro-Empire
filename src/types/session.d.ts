import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    role?: string;
    csrfToken?: string;
    flash?: { type: 'success' | 'error' | 'info'; message: string }[];
  }
}
