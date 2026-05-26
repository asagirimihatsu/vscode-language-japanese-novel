import * as vscode from "vscode";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { getConfig } from "./config.js";
import compileDocs, { manuscriptRoot, ifFileInDraft } from "./compile.js";
import { draftsObject, resetCounter } from "./compile.js";
import { DraftWebViewProvider } from "./novel.js";
import {
  CharacterCounter,
  CharacterCounterController,
  formatSheetsAndLines,
} from "./charactorcount.js";
export * from "./charactorcount.js";
import {
  editorText,
  previewBesideSection,
  MyCodelensProvider,
} from "./editor.js";
import {
  activateTokenizer,
  changeTenseAspect,
  addRuby,
  addSesami,
  moveWordForward,
  moveWordBackward,
} from "./tokenize.js";
import { exportpdf, previewpdf } from "./pdf.js";
import { MarkdownFoldingProvider, MarkdownSymbolProvider } from "./markdown.js";

let documentRoot: vscode.Uri;
let WebViewPanel = false;
let servicePort = 8080;
let previewRedrawing = false;
export let deadlineFolderPath: string;
export let deadlineTextCount: string;

const configuration = vscode.workspace.getConfiguration();

let draftWebViewProviderInstance: DraftWebViewProvider;
let isDndActive: boolean | undefined;
export let isFileSelectedOnTree: boolean = false;

emptyPort(function (port: number) {
  servicePort = port;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emptyPort(callback: any) {
  let port = 8080;

  const socket = new net.Socket();
  const server = new net.Server();

  socket.on("error", function () {
    console.log("try:", port);
    server
      .on("listening", () => {
        server.close();
        console.log("ok:", port);
        callback(port);
      })
      .on("error", () => {
        console.log("ng:", port);
        loop();
      })
      .listen(port, "127.0.0.1");
  });

  function loop() {
    port = port + 2;
    if (port >= 20000) {
      callback(new Error("empty port not found"));
      return;
    }

    socket.connect(port, "127.0.0.1", function () {
      socket.destroy();
      loop();
    });
  }
  loop();
}

// MARK: NWアクティベーション
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.compile-draft", () =>
      compileDocs(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.vertical-preview", () =>
      verticalpreview(context),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.export-pdf", () =>
      exportpdf(context, false),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.preview-pdf", () =>
      previewpdf(context),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.launch-preview-server", () =>
      launchHeadlessServer(context),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "Novel.change-tenseAspect",
      changeTenseAspect,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.add-ruby", addRuby),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.add-sesami", addSesami),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "Novel.word-transpose-forward",
      moveWordForward,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "Novel.word-transpose-backward",
      moveWordBackward,
    ),
  );

  // MARK: 原稿ツリー
  draftWebViewProviderInstance = new DraftWebViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "draftTree",
      draftWebViewProviderInstance,
    ),
  );

  isDndActive = configuration.get("Novel.DraftTree.renumber") ?? false;
  vscode.commands.executeCommand("setContext", "isDndActive", isDndActive);

  console.log(configuration.get("Novel.DraftTree.renumber"), isDndActive);
  const toggleDragAndDrop = () => {
    isDndActive = !isDndActive;
    configuration.update("Novel.DraftTree.renumber", isDndActive);

    vscode.commands.executeCommand("setContext", "isDndActive", isDndActive);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "draftTree.activateDragAndDrop",
      toggleDragAndDrop,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "draftTree.deactivateDragAndDrop",
      toggleDragAndDrop,
    ),
  );

  const insertFile = (fileType: "file" | "folder") => {
    draftWebViewProviderInstance.insertFile(
      draftWebViewProviderInstance._webviewView!.webview,
      fileType,
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("draftTree.insertFile", () => {
      insertFile("file");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("draftTree.insertFolder", () => {
      insertFile("folder");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("draftTree.insertFileDim", () => {
      vscode.window.showInformationMessage(
        "ファイル挿入する位置を選択してください",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("draftTree.insertFolderDim", () => {
      vscode.window.showInformationMessage(
        "フォルダーを挿入する位置を選択してください",
      );
    }),
  );

  // MARK: 品詞ハイライトの初期化
  const kuromojiPath = context.extensionPath + "/node_modules/kuromoji/dict";
  activateTokenizer(context, kuromojiPath);

  // 文字数カウントの初期化
  const characterCounter = new CharacterCounter(context);
  await characterCounter.initialize();
  const controller = new CharacterCounterController(characterCounter);
  context.subscriptions.push(controller);
  context.subscriptions.push(characterCounter);

  const storedDeadlineCount = context.workspaceState.get("totacCountDeadline");
  characterCounter.deadlineCountPrevious =
    typeof storedDeadlineCount == "string" ? parseInt(storedDeadlineCount) : 0;
  const storedDeadlineCountDate = context.workspaceState.get(
    "totalCountDeadlineDate",
  );
  characterCounter.deadlineCountPreviousDate =
    typeof storedDeadlineCountDate == "number"
      ? storedDeadlineCountDate
      : new Date(new Date()).getDate() - 1;

  const deadLineFolderPath = context.workspaceState.get("deadlineFolderPath");
  const deadLineTextCount = context.workspaceState.get("deadlineTextCount");
  if (
    typeof deadLineFolderPath == "string" &&
    typeof deadLineTextCount == "string"
  ) {
    await characterCounter._setCounterToFolder(
      deadLineFolderPath,
      deadLineTextCount,
    );
  }

  //締め切りカウンター
  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.set-counter", async (e) => {
      let path = e.collapsibleState ? e.resourceUri.path : e.fsPath;
      if ((await manuscriptRoot()).match(/^[a-z]:\\/)) {
        path = path.replace(/^\//, "").split("/").join("\\");
      }
      let currentLength = 0;
      for (const element of await draftsObject(path)) {
        currentLength += element.length.lengthInNumber;
      }

      let result = await vscode.window.showInputBox({
        prompt: `設定する文字数を入力してください。原稿用紙の枚数で指定するときは、小数で入力してください（20枚の時は20.0）。\n数字を入力せずにEnterを押すと締め切りフォルダーを解除します`,
        placeHolder: `現在の文字数：${currentLength}`,
      });
      if (result) {
        try {
          parseFloat(result);
          context.workspaceState.update("deadlineFolderPath", path);
          context.workspaceState.update("deadlineTextCount", result);
          deadlineFolderPath = path;
          deadlineTextCount = result;
          console.log("saving memento", deadlineFolderPath, deadlineTextCount);
          let targetTextPrompt = "";
          if (result.includes(".")) {
            targetTextPrompt = formatSheetsAndLines(parseFloat(result));
          } else {
            targetTextPrompt = result + "文字";
          }
          vscode.window.showInformationMessage(
            `目標を: ${targetTextPrompt}に設定しました`,
          );
          await characterCounter._setCounterToFolder(path, deadlineTextCount);
        } catch (error) {
          vscode.window.showWarningMessage(`数字を入力してください`);
          result = "0";
        }
      } else {
        vscode.window.showWarningMessage(`目標文字数は設定しません`);
        await characterCounter._setCounterToFolder("", "");
        context.workspaceState.update("deadlineFolderPath", null);
        context.workspaceState.update("deadlineTextCount", null);
        deadlineFolderPath = "";
        deadlineTextCount = "";

        result = "0";
      }
      vscode.commands.executeCommand("draftTree.refresh");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.reset-progress", async () => {
      await characterCounter._resetWritingProtgress();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("Novel.resetWorkspace", async () => {
      clearWorkspaceStateCommand(context);
    }),
  );

  documentRoot = vscode.Uri.joinPath(context.extensionUri, "htdocs");

  context.subscriptions.push(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vscode.commands.registerCommand("Novel.openfile", (args: any) => {
      vscode.commands.executeCommand("vscode.open", args);
    }),
  );

  const provider = new MarkdownFoldingProvider();
  vscode.languages.registerFoldingRangeProvider(
    { language: "novel" },
    provider,
  );

  const symbolProvider = new MarkdownSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: "novel" },
      symbolProvider,
    ),
  );

  const codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
    { language: "novel", scheme: "file" },
    new MyCodelensProvider(),
  );

  context.subscriptions.push(codeLensProviderDisposable);

  vscode.workspace.onDidOpenTextDocument(() => {
    const editor = vscode.window.activeTextEditor;
    if (typeof editor != "undefined") {
      latestEditor = editor;
    }
    if (editor?.document.languageId == "novel") {
      void previewBesideSection(editor);
    }
  });

  // 初期化時にすべての開かれているドキュメントに対して処理を実行
  for (const document of vscode.workspace.textDocuments) {
    void setTypeAsNovel(document);
  }

  for (const editor of vscode.window.visibleTextEditors) {
    void setTypeAsNovel(editor.document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        void setTypeAsNovel(editor.document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void setTypeAsNovel(document);
    }),
  );

  async function setTypeAsNovel(document: vscode.TextDocument | undefined) {
    if (
      document &&
      ((await ifFileInDraft(document.uri.fsPath)) ||
        isInPublishFolder(document.uri.fsPath)) &&
      path.extname(document.uri.fsPath) == getConfig().draftFileType
    ) {
      await vscode.languages.setTextDocumentLanguage(document, "novel");
    }
  }

  function isInPublishFolder(filePath: string): boolean {
    return filePath.includes("/publish/");
  }
}

// インスタンスを返す関数をエクスポートする
export function getDraftWebViewProviderInstance(): DraftWebViewProvider {
  return draftWebViewProviderInstance;
}

let latestEditor: vscode.TextEditor;

// MARK: プレビューサーバー起動
function launchserver(
  context: vscode.ExtensionContext,
  originEditor: vscode.TextEditor,
) {
  latestEditor = originEditor;
  console.log("サーバー起動", latestEditor);

  const viewerServer = http.createServer((request, response) => {
    const Response = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      "200": (file: Buffer, _filename: string) => {
        const header = {
          "Access-Control-Allow-Origin": "*",
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
        };
        response.writeHead(200, header);
        response.write(file, "binary");
        response.end();
      },
      "404": () => {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.write("404 Not Found\n");
        response.end();
      },
      "500": (err: unknown) => {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.write(err + "\n");
        response.end();
      },
    };

    const uri = request.url;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let filename = path.join(documentRoot.fsPath, uri!);

    void (async () => {
      try {
        const stats = await fs.stat(filename);
        console.log(filename + " " + stats);
        if (stats.isDirectory()) {
          filename += "/index.html";
        }
        try {
          const file = await fs.readFile(filename);
          Response["200"](file, filename);
        } catch (err) {
          Response["500"](err);
        }
      } catch {
        Response["404"]();
      }
    })();
  });

  viewerServer.listen(servicePort);

  // Node Websockets Serverを起動する
  const s = new WebSocketServer({ port: servicePort + 1 });

  s.on("connection", (ws) => {
    ws.on("message", (messageRaw, isBinary) => {
      const message = isBinary ? messageRaw : messageRaw.toString();

      console.log("Received: " + message);

      void (async () => {
        if (message == "hello") {
          ws.send(JSON.stringify(getConfig()));
          ws.send(editorText(originEditor));
        } else if (message == "givemedata") {
          console.log("sending body");
          ws.send(editorText(originEditor));
        } else if (message == "redrawFinished") {
          previewRedrawing = false;
          if (keyPressStored) publishWebsocketsDelay.presskey(s);
        } else if (message == "giveMeObject") {
          resetCounter();
          const sendingObjects = await draftsObject(await manuscriptRoot());
          console.log("send:", sendingObjects);
          ws.send(JSON.stringify(sendingObjects));
        } else if (
          typeof message == "string" &&
          message.match(/^{"label":"jump"/)
        ) {
          const messageObject = JSON.parse(message);

          const targetLine = parseInt(messageObject.id.split("-")[1]);
          const targetPosition = new vscode.Position(
            targetLine,
            messageObject.cursor,
          );
          latestEditor.selection = new vscode.Selection(
            targetPosition,
            targetPosition,
          );

          latestEditor.revealRange(
            latestEditor.selection,
            vscode.TextEditorRevealType.InCenter,
          );
          vscode.window.showTextDocument(
            latestEditor.document,
            latestEditor.viewColumn,
          );
          ws.send(editorText(latestEditor));
        }
      })();
    });
  });

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document == vscode.window.activeTextEditor?.document) {
      const editor = vscode.window.activeTextEditor;
      if (typeof editor != "undefined") {
        latestEditor = editor;
        console.log("editor changed!");
      }
      if (
        editor?.document.languageId == "novel" ||
        editor?.document.languageId == "markdown" ||
        editor?.document.languageId == "plaintext"
      ) {
        publishWebsocketsDelay.presskey(s);
      }
    }
  });

  vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor == vscode.window.activeTextEditor) {
      const editor = vscode.window.activeTextEditor;
      if (typeof editor != "undefined") {
        latestEditor = editor;
        console.log("editor changed!");
      }
      if (
        editor?.document.languageId == "novel" ||
        editor?.document.languageId == "markdown" ||
        editor?.document.languageId == "plaintext"
      ) {
        publishWebsocketsDelay.presskey(s);
      }
    }
  });

  vscode.workspace.onDidChangeConfiguration(() => {
    console.log("setting changed");
    sendsettingwebsockets(s);
  });

  vscode.window.onDidChangeVisibleTextEditors((e) => {
    console.log("WindowState Changed:", e);
  });

  publishWebsocketsDelay.presskey(s);

  const serversHostname = os.hostname();
  if (WebViewPanel) {
    const panel = vscode.window.createWebviewPanel(
      "preview",
      "原稿プレビュー http://" + serversHostname + ":" + servicePort,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
      },
    );

    const colorTheme = vscode.window.activeColorTheme.kind;
    const iconfile =
      colorTheme === vscode.ColorThemeKind.Dark
        ? "preview-html-dark.svg"
        : "preview-html-light.svg";
    const iconPath = vscode.Uri.file(
      path.join(context.extensionPath, "media", iconfile),
    );
    panel.iconPath = iconPath;

    panel.webview.html = `<!DOCTYPE html>
  <html>
      <head>
          <style>
          body{
              width:100vw;
              height:100vh;
              padding:0;
              overflow-y:hidden;
          }
          </style>
      </head>
      <body>
          <iframe src="http://localhost:${servicePort}" frameBorder="0" style="margin:none;width:100%;min-width: 100%; min-height: 100%" />
      </body>
  </html>`;
  } else {
    vscode.window.showInformationMessage(
      `http://${serversHostname}:${servicePort} でサーバーを起動しました`,
    );
  }
}

function publishwebsockets(socketServer: { clients: Set<WebSocket> }) {
  for (const client of socketServer.clients) {
    client.send(editorText("active"));
  }
}

function sendsettingwebsockets(socketServer: WebSocketServer) {
  for (const client of socketServer.clients) {
    client.send(JSON.stringify(getConfig()));
  }
}

let keyPressStored = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publishWebsocketsDelay: any = {
  publish: function (socketServer: { clients: Set<WebSocket> }) {
    publishwebsockets(socketServer);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presskey: function (s: any) {
    if (previewRedrawing) {
      keyPressStored = true;
      return;
    }
    previewRedrawing = true;
    keyPressStored = false;
    this.publish(s);
  },
};

function verticalpreview(context: vscode.ExtensionContext) {
  const originEditor = vscode.window.activeTextEditor;
  WebViewPanel = true;
  if (typeof originEditor != "undefined") {
    launchserver(context, originEditor);
  }
}

function launchHeadlessServer(context: vscode.ExtensionContext) {
  const originEditor = vscode.window.activeTextEditor;
  if (typeof originEditor != "undefined") {
    launchserver(context, originEditor);
  }
}

// MARK: リセット
export function clearWorkspaceStateCommand(context: vscode.ExtensionContext) {
  context.workspaceState.update("folderStates", undefined);
  context.workspaceState.update("totacCountDeadline", undefined);
  context.workspaceState.update("totalCountDeadlineDate", undefined);
  context.workspaceState.update("deadlineFolderPath", undefined);
  context.workspaceState.update("deadlineTextCount", undefined);
  context.workspaceState.update("totalCountPrevious", undefined);
  context.workspaceState.update("totalCountPreviousDate", undefined);
  context.workspaceState.update("totalProgressBaselineV2", undefined);
  vscode.window.showInformationMessage(
    "novel-wrietrがワークスペースに保存する現行フォルダー開閉情報、各種の進捗、締切フォルダーをクリアしました",
  );
}

export function deactivate() {
  //
}
