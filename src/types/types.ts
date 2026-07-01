/** A user object that is safe to expose to templates (no password hash). */
export interface PublicUser {
  id: number;
  username: string;
  email: string;
  role: string;
  tierId: number;
  tierName: string;
  created_at: Date;
  last_seen: Date;
}

/** An account tier level (Free/Bronze/Silver/Gold/...), CRUD-managed by admins. */
export interface AccountTier {
  id: number;
  code: string;
  name: string;
  maxBases: number;
  maxQueue: number;
  description: string;
  sortOrder: number;
}
