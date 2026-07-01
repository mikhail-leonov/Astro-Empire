import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Logged-in user's id, set on register/login. */
    userId?: number;
    /** Logged-in user's username, cached for the navbar. */
    username?: string;
    /** Logged-in user's role ('user' | 'admin'), cached for route guards. */
    role?: string;
    /** Per-session CSRF token. */
    csrfToken?: string;
    /** One-shot flash messages shown on the next render. */
    flash?: FlashMessage[];
  }
}

export interface FlashMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}
