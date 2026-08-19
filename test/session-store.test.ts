import assert from "node:assert/strict";
import test from "node:test";

import { SessionStore } from "../src/session-store.js";

test("同じオブジェクト参照なら保存したセッションを取得できる", () => {
  const store = new SessionStore();
  const savedKey = { tenantId: "acme", userId: "u-42" };
  const session = { token: "token-42" };

  store.save(savedKey, session);

  assert.deepStrictEqual(store.find(savedKey), session);
});

test("同じ値の別オブジェクトでも保存したセッションを取得できる", () => {
  const store = new SessionStore();

  store.save(
    { tenantId: "acme", userId: "u-42" },
    { token: "token-42" },
  );

  const rehydratedKey = { tenantId: "acme", userId: "u-42" };

  assert.deepStrictEqual(
    store.find(rehydratedKey),
    { token: "token-42" },
    "HTTPリクエストから復元した同じ利用者キーでもセッションを取得したい",
  );
});
