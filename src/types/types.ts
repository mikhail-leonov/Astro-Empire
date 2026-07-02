export interface PublicUser {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
  tierName: string;
  createdAt: Date;
  lastSeen: Date;
}

export interface AccountTier {
  id: number;
  code: string;
  name: string;
  description: string;
  maxBases: number;
  maxQueue: number;
  sortOrder: number;
}
