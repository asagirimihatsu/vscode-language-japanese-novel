import * as assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as vscode from "vscode";
import * as sinon from "sinon";

import { getConfig } from "../../config.js";

describe("Config Test Suite", () => {
  let sandbox: sinon.SinonSandbox;

  vscode.window.showInformationMessage("Start config tests.");

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("When novel configuration is empty", () => {
    beforeEach(() => {
      function fakeGetFunc(_key: string, defaultVal: string | number) {
        return defaultVal;
      }

      const configMock = {
        get: fakeGetFunc,
      } as unknown as vscode.WorkspaceConfiguration;

      sandbox.stub(vscode.workspace, "getConfiguration").returns(configMock);
    });

    test("lineHeightRate should be 1.75", () => {
      assert.strictEqual<number>(getConfig().lineHeightRate, 1.75);
    });

    test("fontFamily should be serif", () => {
      assert.strictEqual<string>(getConfig().fontFamily, '"Hiragino Mincho ProN","Yu Mincho","YuMincho","MS PMincho",serif"');
    });
  });

  describe("When novel configuration has some values", () => {
    beforeEach(() => {
      function fakeGetFunc(key: string, defaultVal: string | number) {
        switch (key) {
          case "preview.fontFamily":
            return "Helvetica";
          case "preview.lineLength":
            return 48;
          default:
            return defaultVal;
        }
      }

      const configMock = {
        get: fakeGetFunc,
      } as unknown as vscode.WorkspaceConfiguration;

      sandbox.stub(vscode.workspace, "getConfiguration").returns(configMock);
    });

    test("lineHeightRate should be 1.75", () => {
      assert.strictEqual<number>(getConfig().lineHeightRate, 1.75);
    });

    test("fontFamily should be Helvetica", () => {
      assert.strictEqual<string>(getConfig().fontFamily, "Helvetica");
    });

    test("lineLength should be 48", () => {
      assert.strictEqual<number>(getConfig().lineLength, 48);
    });
  });
});
