export type UserKey = {
  readonly tenantId: string;
  readonly userId: string;
};

export type Session = {
  readonly token: string;
};

export class SessionStore {
  private readonly sessions = new Map<UserKey, Session>();

  save(key: UserKey, session: Session): void {
    this.sessions.set(key, session);
  }

  find(key: UserKey): Session | undefined {
    return this.sessions.get(key);
  }
}
