# Project Sky Sniper Prototype

Unity実装前に、コアの遊びを検証するためのブラウザ版プロトタイプです。

## 起動

`index.html` をブラウザで開きます。

## テスト・静的検証

```bash
node --check prototype/game.js
node prototype/test_game.js
```

## 操作

- `START SORTIE`: ゲーム開始
- タップ / クリック: 照準中心へ投下。装填1.6秒・同時1発のみ
- 長押し: ボムゲージ100%時に急降下爆撃
- 横フリック: 隣レーンへクイックバンク。気づき回避への介入用
- 左右黒帯の `BANK` ボタンをクリック: PCテスト用のクイックバンク
- `A` / `D` または `←` / `→`: PCテスト用のクイックバンク
- `FOCUS` ボタンまたは `Space`: ハントフォーカスのON/OFF

## コア設計：爆撃手視点の一射一殺

- カメラは鳥基準の真下見下ろし。鳥の影がある照準中心が常に着弾点
- 地面は高速、車は相対速度で低速スクロールし、鳥が車に追いついていく感覚を作る
- ロック中の車には「**鳥影マーカー**」がリリースポイントに表示される
- 鳥影が獲物に重なった瞬間（影のリム発光＋FIRE!表示）がジャストタイミング
- 装填に1.6秒かかるため連打は不可能。1発外すとその車はほぼ取り逃しになる緊張感
- スポーンはリリース時刻ベースで管理し、ターゲット車両同士の射撃窓が理不尽に詰まらないよう保証する

## 実装済み

- 縦画面の真下見下ろし道路
- 3レーン車両スポーン（鳥基準の相対速度＋リリース時刻スケジューラ）
- 車両ごとの相対速度、スコア、サイズ差、個別ドライバープロフィール保持
- 照準中心固定＋鳥影マーカーによるタイミング射撃（レーン・蛇行・回避予測を加味した横軸整合判定付き）
- ロック車両レーンへの自動バンク追従
- ターゲットキューUI（リリース順の残り秒数）
- ドライバー気づき予兆（スワーブ／急ブレーキ／急加速のテル表示）
- 手動ハントフォーカス（FOCUSゲージ制）とクイックバンク
- BUSTED!ボーナスと専用リアクションセリフ
- サンルーフ開閉サイクル、PIERCED!（ガラス破片演出＋専用セリフ） / DEFLECT / DEFENDED
- ドライバーリアクション・カットイン（命中時に画面下部へ1.2秒間顔グラ＋ドライバー別5種以上のセリフ表示、直近2件の重複防止）
- 芋虫キャッチ、装填トークン（リロード中の即時発射対応）、ランチブレイク、フェーズ遷移バナー表示
- ROOKIE PROTECTION（最初の3回のOVERSHOOTはライフ減なし）
- 鳥の影、翼端、ビル屋上パララックス、2層スクロール
- 装填制（1.6秒、リロードリング＋RELOADING表示）
- HIT / JUST SNIPE / MISS、JUST時ヒットストップ
- コンボ、スタイルランク、スコア倍率
- ライフ制（3）、OVERSHOOT取り逃しペナルティ
- ボムゲージと全体攻撃（主役車両のプロフィール・セリフ連動リプレイ）
- 簡易HUD、ヒット演出、振動対応端末でのバイブレーション
- `index.html?debug=1`: リリース残り秒数と隣接ギャップを表示

## 次に検証すること

- 手動フォーカスのゲージ運用が楽しいリソース判断になっているか
- 鳥影マーカーが破線フレームより直感的に読めるか
- サンルーフ閉状態へのPIERCED!狙いが挑戦として成立するか
- 芋虫キャッチと装填トークンがリカバリー／連射の爽快感になっているか
- ランチブレイクが難易度の谷としてテンポよく機能するか
- リムジン／ゴールドを撃つか見送るかのグリード判断が成立しているか

## Bomb Cinematic Update

- Long press at 100% bomb gauge now starts the full cinematic sequence: cut-in, dive zoom, impact flash, instant replay, and result count-up.
- During the cinematic, world updates are frozen: spawning, car movement, awareness, snacks, and focus do not advance.
- The main replay target is selected from on-screen unhit cars by highest base score, with release proximity as the tie-breaker.
- The first bomb cinematic in a run plays in full. From the second bomb onward, tapping during replay skips to the result phase.
- `index.html?debug=1` exposes `window.__skySniperDebug` for prototype testing: `setBomb()`, `spawnTestCars()`, `triggerBomb()`, and `getState()`.
