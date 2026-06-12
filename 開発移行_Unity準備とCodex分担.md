# Unity 2D 開発移行計画：ユーザー準備とCodex作業分担

ゲームデザインは確定（企画書＋仕様書＋視点再設計版）。HTML5プロトタイプ（prototype/）を**挙動のリファレンス（動く仕様書）**として、Unity 2Dへ移植する。

---

## 0. 基本方針：役割分担の原則

| 担当 | 内容 |
|---|---|
| **ユーザー** | GUI操作（Unityエディタ・Unity Hub）、インストール、アカウント・課金の判断、テストプレイとフィードバック |
| **Codex** | すべてのファイル作業：C#スクリプト、設定ファイル（manifest.json等）、エディタ拡張スクリプト、.gitignore |

### 最重要の工夫：「Codexはエディタを操作できない」問題への対策
CodexはC#を書けるが、Unityエディタ上のクリック作業（シーンへのオブジェクト配置、Inspectorの紐付け、アセット作成）はできない。そこで：

1. **ランタイム生成中心の構成**：ゲームオブジェクトは起動時にコードから生成する（HTMLプロトタイプと同じ発想）。シーンは「ブートシーン1個」だけ
2. **メニュー実行型エディタスクリプト**：シーンや設定アセットの生成が必要な場合、Codexに「メニュー項目（例：`BirdBomber > Setup Scene`）を追加するエディタスクリプト」を書かせ、**ユーザーはメニューを1回クリックするだけ**にする
3. シーンファイル（.unity）やプレハブのYAMLをCodexに直接編集させない（壊れやすく差分も読めない）。生成・変更は必ずエディタスクリプト経由

これでユーザーのエディタ作業は「メニュークリック」と「Playボタン」にほぼ限定される。

---

## 1. ユーザー側で準備すること

### 1-1. 今すぐ（開発開始前に1回だけ）

1. **Unity Hub をインストール**（unity.com から）
2. Hub から **Unity 6 LTS（6000.0系の最新）** をインストール
   - モジュールは **Android Build Support**（OpenJDK・SDK・NDK含む）にチェック
   - iOSビルドはMacが必要なので当面対象外（設計上はiOS対応を維持）
3. **Unityアカウント作成**（Personalライセンスは無料。年収10万ドル未満なら商用リリースも可）
4. **プロジェクト作成**：Hubで New Project →テンプレート **「Universal 2D」（URP）** → 名前 `BirdBomberUnity` → 保存先 `C:\Users\snaga\birdbomber\unity\`
5. **リポジトリのGit化**（birdbomberフォルダはまだgit管理されていない）：
   ```
   cd C:\Users\snaga\birdbomber
   git init
   ```
   ※ Unity用 .gitignore は最初のCodexタスク（M0）で作らせる。**git init → Codexに.gitignore作成→ 初回コミット** の順を守る（Library/等の巨大フォルダをコミットしないため）

### 1-2. 日常の運用（毎セッション）

1. Codexが作業 → Unityエディタにフォーカスを戻す（自動で再コンパイル＆.meta生成）
2. Codexから指示があれば、メニュー（`BirdBomber > ...`）を実行
3. Playボタンでテストプレイ → 感想・違和感を次の指示にフィードバック
4. 動作確認できたらコミット
- 注意：**Play中（再生中）にCodexへファイル変更させない**。停止してから依頼する
- 注意：新規ファイル追加後は必ず一度Unityにフォーカスして .meta を生成させてからコミットする

### 1-3. 後で（ビルド・リリース段階になったら）

- Android実機（開発者向けオプション＋USBデバッグ有効化）
- Google Play Console 登録（$25・買い切り）／ Apple Developer Program（$99/年・Mac入手後）
- フォント（サイバー系等幅）・効果音・BGMの調達判断（無料アセットか購入か。**権利確認はユーザーの判断事項**）
- 広告SDK（AdMob）のアカウント作成 — リリース判断後でよい

---

## 2. Codexにさせること（マイルストーン順）

### M0：足場づくり
- Unity用 `.gitignore`（Library/, Temp/, Logs/, obj/ 等の除外。prototype/ とドキュメントは管理対象のまま）
- `Packages/manifest.json` の編集：**Input System** を追加（TextMeshProはUnity 6では同梱のUGUIに統合済み）
- フォルダ構成：`Assets/Scripts/{Core,Systems,UI,Cinematic,Editor}`、`Assets/Settings`
- **GameConfig / VehicleType の ScriptableObject 定義**（HTMLプロトタイプの `config` と `vehicleTypes` をそのまま移植。チューニング値をコードから分離するという仕様書§冒頭の方針を実現）
- エディタスクリプト `BirdBomber > Setup Scene`：ブートシーン生成、縦9:16カメラ、設定アセットの自動作成（→ユーザーは1クリック）

### M1：コアループ移植（ゴール＝HTML版と同じ手触り）
prototype/game.js を仕様書として、以下をC#へ移植：
- 鳥基準フレームの2層スクロール（地面高速／車低速）＋ビル屋上パララックス
- リリース時刻ベースのスポーンスケジューラ＋ターゲットキューUI
- 一射一殺射撃（装填1.6秒・落下0.9秒・HIT/JUST/MISS・ヒットストップ）
- 鳥影マーカー、自動バンク、クイックバンク、手動ハントフォーカス（ゲージ制）
- ドライバー気づき（テル3種）、サンルーフ開閉＋PIERCED/DEFLECT、芋虫＋ランチブレイク
- コンボ／スタイルランク／ボムゲージ／ライフ／ROOKIE PROTECTION
- HUD（スコア・ゲージ類・メッセージ）、デバッグオーバーレイ
- 入力：Input System で「タップ／長押し／フリック／A・D・矢印／Space」を抽象化（PC＝マウス＋キー、モバイル＝タッチを同じアクションにバインド）
- グラフィックは当面プレースホルダ（単色スプライトをコード生成）でよい。**見た目より挙動の同一性を受け入れ基準にする**

### M2：シネマティック＆ジュース
- 必殺技6フェーズのフルシネマティック（§6-1。ステートマシン、VSカットイン、6倍ズーム、リプレイ風シーン）
- ハプティクス抽象化レイヤー（モバイル＝振動、PC＝画面シェイクで代替）
- 命中エフェクト・フラッシュ・スコアポップ等のジュース移植

### M3：モバイル対応
- 縦画面固定・セーフエリア対応・解像度スケーリング
- Androidビルド設定（Player Settings をエディタスクリプトで構成）→ **ビルドボタンを押すのはユーザー**
- タッチ入力の実機検証用デバッグ表示

### Codexへの最初の指示文（コピペ用）

> C:\Users\snaga\birdbomber\unity\BirdBomberUnity に Unity 6（URP 2Dテンプレート）の新規プロジェクトがあります。リポジトリ直下の設計書3点（企画書_ProjectSkySniper.md、仕様書_ProjectSkySniper.md、仕様書_視点再設計_BombsightView.md）と、挙動リファレンスである prototype/game.js を読んだ上で、M0（足場づくり）を実行してください：
>
> 1. リポジトリ直下に Unity 用 .gitignore を作成（unity/BirdBomberUnity/ の Library, Temp, Logs, obj, UserSettings を除外。prototype/ と *.md は管理対象のまま）。
> 2. Packages/manifest.json に Input System（com.unity.inputsystem）を追加。
> 3. Assets/Scripts/{Core,Systems,UI,Cinematic,Editor} と Assets/Settings のフォルダ構成を作成。
> 4. game.js の config と vehicleTypes を移植した GameConfig / VehicleTypeDefinition の ScriptableObject クラスを定義。
> 5. メニュー「BirdBomber > Setup Scene」を追加するエディタスクリプトを作成：実行すると Boot シーン（縦9:16のカメラ＋GameBootstrap空オブジェクト）と Settings 配下の設定アセット（初期値入り）を自動生成する。
> 6. ここまでで一旦停止し、私がUnityでメニューを実行して確認します。シーンやプレハブのYAMLは直接編集せず、生成はすべてエディタスクリプト経由にしてください。今後も .meta ファイルは自分で作らないでください（Unityに生成させる）。

---

## 3. 進め方の確認事項（最初のテストプレイまで）

1. ユーザー：§1-1 の 1〜5 を実施（Unityインストール〜git init）
2. Codex：M0 → ユーザー：Unityフォーカス→「BirdBomber > Setup Scene」実行→初回コミット
3. Codex：M1 を機能単位で小刻みに（スクロール→射撃→スケジューラ→…の順）。各段階でユーザーがPlayして手触りをHTML版と比較
4. M1完了時点で一度「HTML版と同じ面白さが出ているか」を判定してから M2 へ
