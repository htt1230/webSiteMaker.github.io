# SiteCanvas

SiteCanvasは、ブラウザ上で文字や画像を自由に配置し、Webページを作れるエディターです。アカウント登録やビルドは不要です。

## 使い方

1. 4つのファイルを同じフォルダーに置き、PCのブラウザで `index.html` を開きます。
2. サンプルを編集するか、「新規作成」で白紙から始めます。左側のパネルでテキスト、画像、ボタン、四角形を追加できます。
3. キャンバス上の要素をドラッグして移動します。右下のつまみでサイズを変え、右側のパネルで色や文字などを調整できます。
4. 「PC」「スマホ」を切り替えて、それぞれの配置を整えます。「プレビュー」で完成時の見た目を確認できます。
5. 「HTMLを書き出す」を押すと、CSSと画像を含むHTMLファイル1枚が保存されます。「ファイルを開く」から、SiteCanvasで書き出したHTMLを再編集できます。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | エディター画面 |
| `style.css` | エディター画面のスタイル |
| `script.js` | 編集、プレビュー、HTMLの書き出しと読み込み |
| `README.md` | 使い方と公開手順 |

## GitHub Pagesでエディターを公開

1. この4つのファイルをGitHubリポジトリのルートにアップロードします。
2. リポジトリの **Settings → Pages** を開きます。
3. **Build and deployment** の **Source** に **Deploy from a branch** を選びます。
4. ファイルを置いたブランチ（例 `main`）と **/(root)** を選択し、**Save** を押します。
5. 公開後、**Settings → Pages** に表示されるURLからエディターを開きます。

[GitHub Pagesの公開元を設定する手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

SiteCanvasで作ったページは、別のリポジトリや公開フォルダーに置けます。書き出したHTMLをその公開先の `index.html` にすると、そのページがトップに表示されます。
