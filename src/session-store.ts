export type UserKey = {
  readonly tenantId: string;
  readonly userId: string;
};

export type Session = {
  readonly token: string;
};

function toStorageKey(key: UserKey): string {
  return JSON.stringify([key.tenantId, key.userId]);
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  save(key: UserKey, session: Session): void {
    this.sessions.set(toStorageKey(key), session);
  }

  find(key: UserKey): Session | undefined {
    return this.sessions.get(toStorageKey(key));
  }
}
