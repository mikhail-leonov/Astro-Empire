/** A user object that is safe to expose to templates (no password hash). */
export interface PublicUser {
  id: number;
  username: string;
  email: string;
  created_at: Date;
  last_seen: Date;
}
