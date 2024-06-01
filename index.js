// index.js
const core = require('@actions/core');

async function run() {
  try {
    // 成功メッセージの出力
    core.info('Action completed successfully');
  } catch (error) {
    // エラーメッセージの出力とアクションの失敗
    core.setFailed(error.message);
  }
}

run();
