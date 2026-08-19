# TypeScriptで`Map`のオブジェクトキー検索が`undefined`になる最小再現

## 概要

このリポジトリは、**値が同じでも別に生成したオブジェクトを`Map`のキーとして検索すると`undefined`になる**問題を、TypeScriptとNode.jsの最小構成で再現します。HTTPリクエストやJSONから復元した利用者キーでセッションを引く場面をモデルに、実際の`AssertionError`を観測し、値キーへ正規化する最小修正と回帰テストを示します。

> `Map`はオブジェクトキーを値ではなく参照で比較します。そのため、プロパティが同じでも別に生成したオブジェクトは同じキーではありません。[1]

## 必要環境

| 項目 | このリポジトリで確認したバージョン | 確認コマンド |
|---|---:|---|
| Node.js | `v22.13.0` | `node --version` |
| npm | `10.9.2` | `npm --version` |
| TypeScript | `5.9.3` | `npx tsc --version` |
| `@types/node` | `22.20.1` | `node -p "require('./node_modules/@types/node/package.json').version"` |

Node.js 22以上を前提にします。Node標準テストランナーとTypeScriptコンパイラだけを使い、追加のテストフレームワークは導入していません。

## セットアップ

```bash
git clone <このリポジトリのURL>
cd typescript-map-object-key-lab
npm install
```

## 不具合を再現する

修正前の状態は、バグ再現コミット [`c3b06e2`](../../commit/c3b06e2) にあります。次のコマンドで移動して実行してください。

```bash
git checkout c3b06e2
NO_COLOR=1 npm run test:bug
```

終了コードは `1` となり、`ERR_ASSERTION` の`AssertionError`が出ます。`actual`は`undefined`で、`expected`は`{ token: 'token-42' }`です。実測した出力は [`evidence/bug-test-output.txt`](./evidence/bug-test-output.txt) に保存しています。

元の`main`へ戻すには、次を実行します。

```bash
git switch main
```

## 型検査とテスト

```bash
npm run typecheck
npm test
```

`npm run typecheck`は厳格な型検査を行い、`npm test`はTypeScriptをコンパイルしてNode標準テストランナーで2件のテストを実行します。いずれも終了コード `0` で完了します。

## 修正後を確認する

```bash
NO_COLOR=1 npm test
```

修正後は、同じ参照を渡した場合と、同じ値を持つ別オブジェクトを渡した場合の両方でセッションを取得できます。実測した成功出力は [`evidence/fix-test-output.txt`](./evidence/fix-test-output.txt) に保存しています。

## 構成

```text
.
├── article.md                    # 診断から修正・回帰までを解説する記事
├── evidence/
│   ├── bug-test-output.txt       # 修正前に実測した失敗出力
│   ├── fix-test-output.txt       # 修正後に実測した成功出力
│   └── typecheck-output.txt      # 型検査の成功出力
├── src/session-store.ts          # 最小のSessionStore実装
├── test/session-store.test.ts    # 回帰テスト
├── package.json
└── tsconfig.json
```

## Git履歴

| コミット | 内容 |
|---|---|
| `c3b06e2` | 同じ値の別オブジェクトでセッション検索に失敗する状態と、失敗するテストを追加。 |
| `e4adc44` | 利用者キーを文字列へ正規化し、同じ値なら同じエントリを取得できるよう修正。 |

## 関連記事

エラーの読み方、仮説の切り分け、根本原因、代替設計は [`article.md`](./article.md) を参照してください。

## 参考資料

[1]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map "MDN Web Docs: Map"
