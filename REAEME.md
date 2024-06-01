GitHubActionsの仕様を簡単に書くので英語ドキュメントしてまとめてください。GitHubのREADME.mdとして使うのでマークダウンのソースファイルとして書いてください。なお、私が書く形式に従う必要はないので、適切なドキュメントとして適切な表現になおしてください。

このアクションが行うこと。

- リポジトリ内のDockerfileを自動的にビルドしてイメージをGHCRにPUSHする。

定義されている引数

token: GHCRにアクセスするためのトークン(必須)
branch: 対象となるブランチ名(必須)。このブランチがPUSHされた場合にのみ動作する
only_changed: trueの場合は前回のコミットにDockerfileが含まれていればビルドおよびPUSHを行う(オプショナル。default=true)
with_branch: trueの場合イメージ名にブランチ名を含める(オプショナル。default=false)
width_timestamp: trueの場合イメージ名にタイムスタンプを含める()
