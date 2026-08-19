# TypeScriptで同じ値のオブジェクトを`Map`で検索すると`undefined`になる理由をデバッグする

## はじめに

HTTPリクエストのボディやJSONから復元した `{ tenantId, userId }` をキーにして、ログイン済みセッションを取り出す場面を考えます。保存時と検索時でプロパティの値は同じなのに、`Map#get()`が`undefined`を返すことがあります。

この問題はTypeScriptの型検査を通過します。したがって、型エラーを直す題材ではなく、**実行時に観測した`AssertionError`を読み、値の同一性と参照の同一性を区別する**題材です。本記事では、修正前のコミットから失敗を実行し、出力を根拠に最小修正と回帰テストへ進みます。

> `Map`のオブジェクトキーは値ではなく参照で比較されます。同じプロパティを持つ別のオブジェクトは、同じキーとして扱われません。[1] [2]

## 今回の問題

| 項目 | 内容 |
|---|---|
| 対象 | TypeScript 5.9.3 / Node.js 22.13.0 |
| モデル化した場面 | 保存時の利用者キーと、HTTPリクエストから復元した検索キーでセッションを照合する。 |
| 保存時のキー | `{ tenantId: "acme", userId: "u-42" }` |
| 検索時のキー | `{ tenantId: "acme", userId: "u-42" }`（別に生成したオブジェクト） |
| 期待した結果 | `{ token: "token-42" }` を取得する。 |
| 実際の結果 | `undefined` が返り、テストが`ERR_ASSERTION`で失敗する。 |

リポジトリ全体は最小構成です。`src/session-store.ts`に保存・検索の実装を置き、`test/session-store.test.ts`にNode標準テストランナーのテストを置いています。修正前はコミット [`c3b06e2`](../../commit/c3b06e2)、最小修正後は [`e4adc44`](../../commit/e4adc44) です。

## 再現コード

まず、修正前の実装では`Map<UserKey, Session>`を使います。

```ts
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
```

テストでは保存時と検索時に別々のオブジェクトリテラルを渡します。各プロパティは同じ値です。

```ts
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
```

ここで固定した契約は、**同じテナントIDと利用者IDで識別される利用者なら、別のリクエストで復元されたオブジェクトでも同じセッションを取得できること**です。

## エラーを発生させる

修正前のコミットに移動して、対象テストだけを実行します。

```bash
git checkout c3b06e2
npm install
NO_COLOR=1 npm run test:bug
```

実際に終了コード `1` で失敗しました。以下は観測結果から、診断に必要な部分をそのまま抜き出したものです。

```text
# Subtest: 同じ値の別オブジェクトでも保存したセッションを取得できる
not ok 2 - 同じ値の別オブジェクトでも保存したセッションを取得できる
  failureType: 'testCodeFailure'
  error: |-
    HTTPリクエストから復元した同じ利用者キーでもセッションを取得したい
    + actual - expected

    + undefined
    - {
    -   token: 'token-42'
    - }

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    token: 'token-42'
  operator: 'deepStrictEqual'
  stack: |-
    TestContext.<anonymous> (file:///.../dist/test/session-store.test.js:15:12)

# pass 1
# fail 1
exit_code=1
```

全出力は [`evidence/bug-test-output.txt`](./evidence/bug-test-output.txt) に保存しています。なお、同じオブジェクト参照を保存・検索の両方に渡すテストは成功しました。この比較が、原因を切り分ける最初の手掛かりです。

## エラーメッセージを読む

`AssertionError`は「セッションを検索する実装が例外を投げた」ことを表しているのではありません。テストが指定した期待値と、`find()`が実際に返した値が一致しなかったことを表します。Nodeの厳格アサーションは、オブジェクトの差分を`actual`と`expected`として表示します。[3]

| 診断の断片 | 読み取れること | 対応するコード・状態 |
|---|---|---|
| `failureType: 'testCodeFailure'` | 実行基盤ではなく、テスト本体のアサーションが失敗した。 | `assert.deepStrictEqual(...)` |
| `+ actual - expected` | 上が実際の戻り値、下がテストが要求した戻り値である。 | `find(rehydratedKey)`と`{ token: "token-42" }` |
| `+ undefined` | `Map#get()`はキーを見つけられず`undefined`を返した。 | `sessions.get(key)` |
| `code: 'ERR_ASSERTION'` | Nodeのアサーション失敗である。 | テストの期待値違反 |
| `operator: 'deepStrictEqual'` | 比較に使った関数が明示されている。 | `assert.deepStrictEqual` |
| `stack: ...session-store.test.js:15:12` | 直接失敗した位置は、期待値を検証したテスト行である。 | アサーション呼び出し |

**直接失敗した位置**は`assert.deepStrictEqual()`です。しかし、**問題となる状態を作った位置**は、その前の`save()`で`Map`にオブジェクトをキーとして入れ、後の`find()`で別オブジェクトを渡した箇所です。

`undefined`は「保存処理が必ず失敗した」ことを意味しません。最初のテストが通っているため、同じ参照なら保存も検索もできます。ここから、「`Map`の検索はプロパティの中身ではなく、キーの参照そのものを見ているのではないか」という仮説を立てられます。

## 原因を切り分ける

仮説を一度に複数変えず、保存済みキーと検索キーの関係だけを変えて確認しました。

| 仮説 | 検証 | 結果 | 判断 |
|---|---|---|---|
| 保存処理が失敗している | 保存時に使った同じ`UserKey`参照で検索する。 | `{ token: "token-42" }`を取得できた。 | 棄却 |
| プロパティ値が一致していない | `tenantId`・`userId`がともに同じ文字列の別オブジェクトで検索する。 | `undefined`になった。 | 値の不一致ではない |
| 参照の違いがキー検索に影響する | 同じプロパティを持つ別インスタンスと、保存時と同じインスタンスを比較する。 | 同一参照だけが検索できた。 | 採用 |

`Map`はキーの等価性にSameValueZeroを使い、オブジェクトキーについては**オブジェクト同一性、すなわち参照**で比較します。[1] `Map.prototype.get()`も、見つからないキーには`undefined`を返すと定義されています。[2]

## 根本原因

根本原因は、`UserKey`を「値で識別したいドメイン上のキー」として扱っているのに、保存先に`Map<UserKey, Session>`を使ったことです。`Map`にとってオブジェクトは可変な値の束ではなく、固有の参照を持つ1個のオブジェクトです。

次の二つの式は、プロパティ値が同じでも異なる参照を生成します。

```ts
{ tenantId: "acme", userId: "u-42" } === { tenantId: "acme", userId: "u-42" };
// false
```

この仕様は、オブジェクトの構造全体を毎回比較せずに、特定のインスタンスをキーとして扱う用途に適しています。例えば、DOMノード、接続オブジェクト、キャッシュ対象のインスタンスごとに状態を紐付ける場合です。一方、HTTPやJSONの境界をまたぐ利用者IDのように、毎回オブジェクトが復元される値は参照を保持できません。そこで、境界をまたいでも安定する値キーを選ぶ必要があります。

TypeScriptが見逃したのは、型の不備ではありません。`Map<UserKey, Session>`も`find(key: UserKey)`も型として正しいためです。ここで必要なのは型注釈を増やすことではなく、**識別子の意味を参照同一性から値同一性へ変換する設計**です。

## 最小修正

今回の利用者キーは二つの文字列で構成されるため、保存時と検索時に同じ配列をJSON化して文字列キーへ正規化します。

```diff
+function toStorageKey(key: UserKey): string {
+  return JSON.stringify([key.tenantId, key.userId]);
+}
+
 export class SessionStore {
-  private readonly sessions = new Map<UserKey, Session>();
+  private readonly sessions = new Map<string, Session>();
 
   save(key: UserKey, session: Session): void {
-    this.sessions.set(key, session);
+    this.sessions.set(toStorageKey(key), session);
   }
 
   find(key: UserKey): Session | undefined {
-    return this.sessions.get(key);
+    return this.sessions.get(toStorageKey(key));
   }
 }
```

`JSON.stringify([tenantId, userId])`は、二つの文字列と順序を含む同じ表現を保存・検索の両方で生成します。`Map`が比較する対象はオブジェクト参照から文字列値に変わるため、別のHTTPリクエストで復元した`UserKey`でも同じエントリに到達できます。

重要なのは`toStorageKey()`を1箇所へ集約したことです。`save()`だけで文字列化して`find()`をそのままにすると、型が合わず実装できないか、別の不整合を作ります。正規化規則を一つの関数で共有することで、保存と検索の契約を明示できます。

## 修正後の確認

`main`へ戻して、型検査と全テストを実行します。

```bash
git switch main
npm run typecheck
NO_COLOR=1 npm test
```

実際の出力では2件とも成功しました。

```text
# Subtest: 同じオブジェクト参照なら保存したセッションを取得できる
ok 1 - 同じオブジェクト参照なら保存したセッションを取得できる

# Subtest: 同じ値の別オブジェクトでも保存したセッションを取得できる
ok 2 - 同じ値の別オブジェクトでも保存したセッションを取得できる

# tests 2
# pass 2
# fail 0
exit_code=0
```

型検査とテストの完全な実測結果は、それぞれ [`evidence/typecheck-output.txt`](./evidence/typecheck-output.txt) と [`evidence/fix-test-output.txt`](./evidence/fix-test-output.txt) にあります。

## 回帰テスト

今回の回帰テストは、修正前に`undefined`となって失敗した条件を固定しています。

```ts
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
  );
});
```

修正前はこのテストが`ERR_ASSERTION`で失敗し、修正後は成功します。単に`Map#get()`が動くことではなく、**異なるオブジェクト参照でもドメイン上は同じ利用者として扱う**という要件を守ります。

## 別の修正方法

最適な識別子は、境界とデータモデルによって異なります。今回の複合キー文字列化は、最小再現で文字列2項目を扱うための最小修正です。

| 方法 | 可読性・保守性 | 安全性 | 性能・メモリ | API・副作用 | 採用判断 |
|---|---|---|---|---|---|
| 配列をJSON文字列へ正規化する | 正規化関数にルールを集約できる。 | 区切り文字の衝突を避けつつ、順序も表現できる。 | 文字列を生成するコストがある。 | 呼び出し側は`UserKey`を維持できる。 | 小さな複合文字列キーで有効。 |
| 永続的な単一ID（例: `sessionId`）を使う | 最も意図が明確になりやすい。 | IDの一意性をストレージ側で保証できる。 | 文字列1件の検索で済む。 | モデルに単一IDを持たせる必要がある。 | IDを発行・保持できる実務システムで優先。 |
| 保存時の同じオブジェクト参照を再利用する | 実装は短い。 | 参照を失うとすぐ壊れる。 | 追加の正規化は不要。 | HTTP・JSON・ワーカー境界をまたげない。 | インスタンス固有の状態を扱う場合のみ採用。 |
| オブジェクトを走査して深い等価性で検索する | 比較規則が複雑になりやすい。 | 比較対象・循環参照・プロトタイプの扱いが難しい。 | 検索が線形になり得る。 | `Map`本来のキー検索契約から外れる。 | 少数要素かつ別要件がある場合に限定。 |

単に`any`へ逃がす、`undefined`を無条件に既定セッションへ置き換える、検索のたびに全エントリを深い比較で走査する、といった対応は本質的な修正ではありません。前二者は利用者を取り違えたり、未ログイン状態を隠したりする危険があります。最後の方法は性能と比較規則の問題を抱えます。

## まとめ

今回の診断で重要だったのは、`ERR_ASSERTION`の差分を読むことでした。

| 観測 | 導いた結論 |
|---|---|
| 同じ参照のテストは成功した。 | 保存処理・`Map`自体が全面的に壊れているわけではない。 |
| 同じ値の別オブジェクトでは`actual`が`undefined`になった。 | `Map#get()`が検索キーを一致と判定していない。 |
| `Map`のオブジェクトキーは参照比較である。 | ドメイン上の値同一性を、オブジェクトキーへ直接委ねられない。 |
| 正規化後、同じ回帰テストが成功した。 | 保存・検索が同じ値キーを使う契約を満たした。 |

エラーが出たテスト行だけを見ると、「期待値を直せばよい」と誤解しやすい状況です。しかし、`actual: undefined`、同じ参照では成功する対照テスト、そして`Map`のキー比較規則を順に対応付けることで、原因を「値キーとして扱うべき情報を参照キーへ置いた設計」として切り分けられます。

## 参考資料

[1]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map "MDN Web Docs: Map"
[2]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/get "MDN Web Docs: Map.prototype.get()"
[3]: https://nodejs.org/api/assert.html "Node.js Documentation: Assert"
