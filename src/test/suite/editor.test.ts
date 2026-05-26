import * as assert from "node:assert";
import { beforeEach, describe, test } from "node:test";
import * as vscode from "vscode";
import { editorText, markUpHtml } from "../../editor.js";

describe("Editor Test Suite", () => {
  describe("editorText", () => {
    let textDoc: vscode.TextDocument;
    let textEditor: vscode.TextEditor;
    beforeEach(async () => {
      textDoc = await vscode.workspace.openTextDocument({
        language: "text",
        content: "こんにちは",
      });
      textEditor = await vscode.window.showTextDocument(textDoc);
    });
    test("カーソル位置にspanが入り、id付きの段落タグで囲まれる", () => {
      assert.strictEqual<string>(
        editorText(textEditor),
        '<p id="l-0"><span id="cursor">こ</span>んにちは</p>',
      );
    });
  });

  describe("markUpHtml", () => {
    test("プレーンな文字列はそのまま通る", () => {
      assert.strictEqual<string>(
        markUpHtml("こんにちは。"),
        "こんにちは。",
      );
    });

    test("Markdown見出し「#」がh1に変換される", () => {
      assert.strictEqual<string>(
        markUpHtml('<p id="l-0"># タイトル</p>'),
        '<h1 id="l-0">タイトル</h1>',
      );
    });

    test("Markdown見出し「##」がh2に変換される", () => {
      assert.strictEqual<string>(
        markUpHtml('<p id="l-3">## 章</p>'),
        '<h2 id="l-3">章</h2>',
      );
    });

    test("青空文庫注記法の大見出しがh1に変換される", () => {
      assert.strictEqual<string>(
        markUpHtml('<p id="l-5">序章［＃「序章」は大見出し］</p>'),
        '<h1 id="l-5">序章</h1>',
      );
    });

    test("字下げ開始タグがdivに変換される", () => {
      assert.strictEqual<string>(
        markUpHtml('<p id="l-1">［＃ここから１文字下げ］</p>'),
        '<div class="indent-1">',
      );
    });

    test("字下げ終了タグが閉じdivに変換される", () => {
      assert.strictEqual<string>(
        markUpHtml('<p id="l-2">［＃ここで字下げ終わり］</p>'),
        "</div>",
      );
    });
  });
});
