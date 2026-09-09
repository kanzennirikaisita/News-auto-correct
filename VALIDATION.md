# 初期MVP検証記録

検証日: 2026-09-09。公開用mainへのマージ前、`feature/initial-personal-radar` で確認。

## 成功した確認

- [実収集Actions](https://github.com/kanzennirikaisita/News-auto-correct/actions/runs/34307278743): 13 / 13ソース取得成功、218件をlatest.jsonへ保存。Botのcommit / push成功。
- [自動テストActions](https://github.com/kanzennirikaisita/News-auto-correct/actions/runs/34307278849): 成功。
- Python 8件: RSS / Atom / RDF、HTML、GitHub Releases、URL重複、更新世代、30日保持、部分・全ソース失敗時のデータ保持、XMLコード例、同一出力の書込み抑制。
- JavaScript 7件: 既読記事の更新後未読化、収集時刻を基準とした確認位置、複合フィルタ、保存記事の保持、入力検証、Service Workerのサブパス・オフラインフォールバック・他キャッシュとの分離。
- Chrome実画面: 222件の取得済みデータが表示。Workカテゴリ + 「ガバメントクラウド」検索で1件に絞り込み。既読で未読一覧から消え、保存と既読状態は再読込後も保持。
- Chrome実画面: 「確認済みにする」で重要変化が0になり、再読込後も0を維持。次の更新データでは更新記事が再表示。
- 幅390pxのiframeでレスポンシブ表示: 実描画幅375px、scrollWidthも375px。下部ナビ・重要情報・記事操作が表示。ダーク設定と保存画面切替も操作確認。
- 秘密情報を示すパターンの検査: 秘密キー等の混入なし。公開設定と必要なWeb資産だけをPagesへ配置。

## 実データ確認で修正した点

1. 初期化を止めるapp.jsの構文エラーを修正。
2. FF14タイトルに混じるscript内容を除去し、日時用の数値だけを日付として抽出。
3. GitHub ChangelogのCDATA内に含まれるDOCTYPEのコード例を、実際のXML実体宣言と区別。
4. Codex APIの応答サイズ超過を解消するため直近10件へ制限。
5. 初期取得に含まれた古い既知日付の項目を整理。同時検知の記事は配信日時で新しい順に表示。

## 未確認・環境上の制約

- GitHub Pages実URLの表示: mainへのマージとSettings → Pages → GitHub Actionsの設定後に確認が必要。
- iPhone / Safari / WebKit実機、ホーム画面追加: 未確認。Apple向けmeta、PNGアイコン、standalone、safe-areaは実装。
- ブラウザでの実際のService Worker登録・機内モード: プレビューが通常HTTPのため未確認。オフライン動作はService Workerコードを実行するモックテストで確認。
- 390pxの確認はレスポンシブレイアウトの確認であり、iPhone実機やSafariエミュレーションではない。

## 公開後の最終チェック

1. PRマージとPagesのActions方式設定後、収集とDeploy GitHub Pagesの成功を確認。
2. SafariでPagesを開き、最終収集日時と情報源状態を確認。
3. ホーム画面に追加。PWAをオンラインで一度開き、データ表示後に閉じる。
4. 機内モードでPWAを開き、直前データが読めることを確認。元記事のリンク先はオフライン対象外。
5. 通信を戻し「更新」。既読・保存・確認位置が保持されることを確認。
