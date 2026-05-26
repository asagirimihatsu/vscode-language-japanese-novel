// Original code is published by 8amjp/vsce-charactercount https://github.com/8amjp/vsce-charactercount under MIT

import * as path from "node:path";
import {
  manuscriptRoot,
  draftsObject,
  getLength,
  ifFileInDraft,
  resetCounter,
  totalLength,
} from "./compile.js";
import TreeModel from "tree-model";

import {
  type Disposable as DisposableType,
  Disposable,
  StatusBarAlignment,
  type StatusBarItem,
  type TextDocument,
  window,
  workspace,
} from "vscode";
import * as vscode from "vscode";

import { simpleGit, type SimpleGitOptions } from "simple-git";
import { distance } from "fastest-levenshtein";
import { getConfig } from "./config.js";

const projectDraftLengthObj = { lengthInNumber: 0, lengthInSheet: 0 };
let countingFolderPath = "";
let countingTarget = "";
const TOTAL_PROGRESS_BASELINE_V2_KEY = "totalProgressBaselineV2";
const LEGACY_TOTAL_COUNT_PREVIOUS_KEY = "totalCountPrevious";
const LEGACY_TOTAL_COUNT_PREVIOUS_DATE_KEY = "totalCountPreviousDate";

type LengthCount = {
  lengthInNumber: number;
  lengthInSheet: number;
};

type TotalProgressBaselineV2 = {
  version: 2;
  total: LengthCount;
  date: string;
};

export function deadLineFolderPath(): string {
  return countingFolderPath;
}

export function deadLineTextCount(): string {
  return countingTarget;
}

async function pathExists(fsPath: string): Promise<boolean> {
  if (!fsPath) return false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return true;
  } catch {
    return false;
  }
}

export class CharacterCounter {
  private _statusBarItem!: StatusBarItem;
  private _countingFolder = "";
  private _countingTarget = "";
  private _folderCount = {
    label: "",
    amountLength: { lengthInNumber: 0, lengthInSheet: 0 },
  };
  public totalCountPrevious = 0;
  public totalSheetCountPrevious = 0;
  public writingDate = new Date();
  public deadlineCountPrevious = 0;
  public totalCountPreviousDate = new Date();
  public deadlineCountPreviousDate = 0;
  public totalWritingProgress = 0;
  public totalWritingProgressSheet = 0;
  public deadlineWritingProgress = 0;
  private workspaceState: vscode.Memento | undefined;

  private _isEditorChildOfTargetFolder = false;
  timeoutID: unknown;

  constructor(private readonly context?: vscode.ExtensionContext) {
    if (context) {
      this.workspaceState = context.workspaceState;
    }
  }

  public async initialize(): Promise<void> {
    const root = await manuscriptRoot();
    if (root !== "") {
      const total = await totalLength(root);
      projectDraftLengthObj.lengthInNumber = total.lengthInNumber;
      projectDraftLengthObj.lengthInSheet = total.lengthInSheet;
      console.log("プロジェクト総文字数", projectDraftLengthObj);

      this.totalCountPrevious = total.lengthInNumber;
      this.totalSheetCountPrevious = total.lengthInSheet;
      console.log("文字数カウンター初期化", total);

      const ifTest = false;
      if (ifTest && this.context) {
        this.context.workspaceState.update(LEGACY_TOTAL_COUNT_PREVIOUS_KEY, undefined);
        this.context.workspaceState.update(
          LEGACY_TOTAL_COUNT_PREVIOUS_DATE_KEY,
          undefined,
        );
        this.context.workspaceState.update(TOTAL_PROGRESS_BASELINE_V2_KEY, undefined);
      }
      this._initializeProgressBaseline(total);
    }
  }

  private _isLengthCount(value: unknown): value is LengthCount {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.lengthInNumber === "number" &&
      typeof candidate.lengthInSheet === "number"
    );
  }

  private _isProgressBaselineV2(value: unknown): value is TotalProgressBaselineV2 {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
      candidate.version === 2 &&
      this._isLengthCount(candidate.total) &&
      typeof candidate.date === "string"
    );
  }

  private _coerceDate(value: unknown, fallback: Date): Date {
    if (typeof value === "string" || value instanceof Date) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    return fallback;
  }

  private _saveProgressBaseline(total: LengthCount, date: Date): void {
    const baseline: TotalProgressBaselineV2 = {
      version: 2,
      total,
      date: date.toISOString(),
    };
    this.workspaceState?.update(TOTAL_PROGRESS_BASELINE_V2_KEY, baseline);

    this.workspaceState?.update(LEGACY_TOTAL_COUNT_PREVIOUS_KEY, total.lengthInNumber);
    this.workspaceState?.update(
      LEGACY_TOTAL_COUNT_PREVIOUS_DATE_KEY,
      date.toISOString(),
    );
  }

  private _initializeProgressBaseline(currentTotal: LengthCount): void {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    const storedV2 = this.workspaceState?.get(TOTAL_PROGRESS_BASELINE_V2_KEY);

    if (this._isProgressBaselineV2(storedV2)) {
      this.totalCountPrevious = storedV2.total.lengthInNumber;
      this.totalSheetCountPrevious = storedV2.total.lengthInSheet;
      this.totalCountPreviousDate = this._coerceDate(storedV2.date, yesterday);
      return;
    }

    const storedLegacyCount = this.workspaceState?.get(
      LEGACY_TOTAL_COUNT_PREVIOUS_KEY,
    );
    const storedLegacyDate = this.workspaceState?.get(
      LEGACY_TOTAL_COUNT_PREVIOUS_DATE_KEY,
    );

    if (typeof storedLegacyCount === "number") {
      this.totalCountPrevious = storedLegacyCount;
      this.totalSheetCountPrevious = storedLegacyCount / 400;
      this.totalCountPreviousDate = this._coerceDate(storedLegacyDate, yesterday);
      this._saveProgressBaseline(
        {
          lengthInNumber: this.totalCountPrevious,
          lengthInSheet: this.totalSheetCountPrevious,
        },
        this.totalCountPreviousDate,
      );
      return;
    }

    console.log("ステータス初回保存");
    this.totalCountPrevious = currentTotal.lengthInNumber;
    this.totalSheetCountPrevious = currentTotal.lengthInSheet;
    this.totalCountPreviousDate = yesterday;
    this._saveProgressBaseline(currentTotal, yesterday);
  }

  public async updateCharacterCount(): Promise<void> {
    if (!this._statusBarItem) {
      this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    }
    const editor = window.activeTextEditor;
    if (!editor) {
      this._statusBarItem.hide();
      return;
    }
    if (
      editor.document.languageId != "novel" &&
      editor.document.languageId != "markdown" &&
      editor.document.languageId != "plaintext"
    ) {
      this._statusBarItem.hide();
      return;
    }

    const doc = editor.document;
    const docLength = getLength(doc.getText());
    const docPath: string = editor.document.uri.fsPath.normalize();
    const activeCount = docLength.lengthInNumber;
    const activeheetCount = docLength.lengthInSheet;
    const countingTarget = this._countingTarget;

    let savedCount = 0;
    let savedSheetCount = 0;

    const root = await manuscriptRoot();
    const relativePath = path.relative(root, docPath);
    if (!root) {
      // プロジェクトフォルダが設定されていない場合
    } else if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      savedCount = activeCount;
      savedSheetCount = activeheetCount;
    } else {
      const lengthOfFile = await this._lengthByPath(docPath);
      savedCount = lengthOfFile.lengthInNumber;
      savedSheetCount = lengthOfFile.lengthInSheet;
    }

    const ifActiveDocInDraft = await ifFileInDraft(
      window.activeTextEditor?.document.uri.fsPath,
    );

    const totalCount = ifActiveDocInDraft
      ? projectDraftLengthObj.lengthInNumber - savedCount + activeCount
      : projectDraftLengthObj.lengthInNumber;
    const totalSheetCount = ifActiveDocInDraft
      ? projectDraftLengthObj.lengthInSheet - savedSheetCount + activeheetCount
      : projectDraftLengthObj.lengthInSheet;

    let editDistance = "";
    let writingProgressString = "";
    if (this.ifEditDistance && getConfig().displayEditDistance) {
      let progressIndex = this.writingProgress > 0 ? "+" : "";
      progressIndex = this.writingProgress == 0 ? "±" : progressIndex;

      if (getConfig().displayProgress) {
        writingProgressString =
          " 進捗" +
          progressIndex +
          Intl.NumberFormat().format(this.writingProgress) +
          "文字";
      }
      if (this.editDistance == -1) {
        editDistance = ` $(compare-changes)$(sync)文字`;
        this._updateEditDistanceDelay();
      } else if (this.keyPressFlag) {
        editDistance = ` $(compare-changes)${Intl.NumberFormat().format(
          this.editDistance,
        )}$(sync)文字`;
      } else {
        editDistance = ` $(compare-changes)${Intl.NumberFormat().format(
          this.editDistance,
        )}文字`;
      }
    }

    let totalWritingProgressString = "";
    if (getConfig().displayProgress) {
      const last = this.totalCountPreviousDate;
      const now = new Date();
      const isSameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate();

      if (!isSameDay) {
        console.log("日跨ぎ発生！", last, now);
        this._saveProgressBaseline(
          { lengthInNumber: totalCount, lengthInSheet: totalSheetCount },
          now,
        );
        this.writingDate = now;
        this.totalCountPreviousDate = now;
        this.totalCountPrevious = totalCount;
        this.totalSheetCountPrevious = totalSheetCount;
      }

      this.totalWritingProgress = totalCount - this.totalCountPrevious;
      this.totalWritingProgressSheet =
        totalSheetCount - this.totalSheetCountPrevious;

      let progressTotalIndex = this.totalWritingProgress > 0 ? "+" : "";
      progressTotalIndex =
        this.totalWritingProgress == 0 ? "±" : progressTotalIndex;

      const totalWritingProgressNumber =
        progressTotalIndex +
        Intl.NumberFormat().format(Math.abs(this.totalWritingProgress)) +
        "文字";
      const totalWritingProgressSheet = formatSignedSheetsAndLines(
        this.totalWritingProgressSheet,
      );
      const showNumber = getConfig().displayCountOfNumber;
      const showSheet = getConfig().displayCountOfSheet;
      totalWritingProgressString = showSheet
        ? " 進捗" +
          totalWritingProgressSheet +
          (showNumber ? `(${totalWritingProgressNumber})` : "")
        : " 進捗" + totalWritingProgressNumber;
    }

    const activeDocLengthInNumberStr = `${Intl.NumberFormat().format(
      getLength(doc.getText()).lengthInNumber,
    )}文字${writingProgressString}`;

    const numberOfSheetFloat = getLength(doc.getText()).lengthInSheet;
    const activeDocLengthInSheetStr = formatSheetsAndLines(numberOfSheetFloat);

    let targetNumberStr = "";

    if (this._countingFolder != "") {
      const isDeadLineInNumber = this._countingTarget.includes(".")
        ? false
        : true;
      let targetNumber = isDeadLineInNumber
        ? this._folderCount.amountLength.lengthInNumber
        : this._folderCount.amountLength.lengthInSheet;

      targetNumberStr = isDeadLineInNumber
        ? Intl.NumberFormat().format(parseInt(countingTarget)) + "文字" + "中"
        : formatSheetsAndLines(parseFloat(countingTarget)) + "中";

      if (this._isEditorChildOfTargetFolder) {
        targetNumber = targetNumber - savedCount + activeCount;
      }
      targetNumberStr += isDeadLineInNumber
        ? Intl.NumberFormat().format(targetNumber) + "文字"
        : formatSheetsAndLines(targetNumber);

      targetNumberStr = ` $(folder-opened)${this._folderCount.label} ${targetNumberStr}`;
    }

    const totalCountStr = Intl.NumberFormat().format(totalCount) + "文字";
    const totalSheetCountStr = formatSheetsAndLines(totalSheetCount);
    const activeCountStr =
      "$(novel-file-v)" + Intl.NumberFormat().format(activeCount) + "文字";
    const activeCountSheetStr = formatSheetsAndLines(activeheetCount);

    if (!root) {
      this._statusBarItem.text =
        activeDocLengthInNumberStr + activeDocLengthInSheetStr;
    }

    this._statusBarItem.text = statusBarItem(root);
    this._statusBarItem.show();

    function statusBarItem(rootPath: string): string {
      if (!rootPath) {
        return (
          "$(file-text)" +
          activeDocLengthInNumberStr +
          activeDocLengthInSheetStr
        );
      }

      let statusBarItemText = "$(folder-library)";
      const showNumber = getConfig().displayCountOfNumber;
      if (getConfig().displayCountOfSheet) {
        statusBarItemText +=
          totalSheetCountStr + (showNumber ? `(${totalCountStr})` : "");
      } else {
        statusBarItemText += totalCountStr;
      }
      statusBarItemText += totalWritingProgressString;

      statusBarItemText += targetNumberStr;

      if (getConfig().displayCountOfSheet) {
        statusBarItemText +=
          " $(file-text)" +
          activeCountSheetStr +
          (showNumber ? `(${activeCountStr})` : "");
      } else {
        statusBarItemText += " $(file-text)" + activeCountStr;
      }
      statusBarItemText += writingProgressString;

      statusBarItemText += editDistance;

      return statusBarItemText;
    }
  }

  public _getCharacterCount(doc: TextDocument): {
    lengthInNumber: number;
    lengthInSheet: number;
  } {
    return getLength(doc.getText());
  }

  public async _updateProjectCharacterCount(): Promise<void> {
    const root = await manuscriptRoot();
    if (root) {
      const total = await totalLength(root);
      projectDraftLengthObj.lengthInNumber = total.lengthInNumber;
      projectDraftLengthObj.lengthInSheet = total.lengthInSheet;
    }
    if (this._countingFolder != "") {
      const folderTotal = await totalLength(this._countingFolder);
      this._folderCount = {
        label: path.basename(this._countingFolder),
        amountLength: {
          lengthInNumber: folderTotal.lengthInNumber,
          lengthInSheet: folderTotal.lengthInSheet,
        },
      };
    }
    await this.updateCharacterCount();
  }

  public async _setCounterToFolder(
    pathToFolder: string,
    targetCharacter: string,
  ): Promise<void> {
    if (!(await pathExists(pathToFolder))) {
      this._countingFolder = "";
      this._countingTarget = "";
      countingFolderPath = "";
      await this._updateProjectCharacterCount();
      await this._setIfChildOfTarget();
      return;
    }
    countingFolderPath = pathToFolder;
    countingTarget = targetCharacter;
    this._countingFolder = pathToFolder;
    this._countingTarget = targetCharacter;
    await this._updateProjectCharacterCount();
    await this._setIfChildOfTarget();
  }

  private async _lengthByPath(dirPath: string): Promise<{
    lengthInNumber: number;
    lengthInSheet: number;
  }> {
    dirPath = dirPath.normalize("NFC");
    const root = await manuscriptRoot();
    if (root == "") {
      return { lengthInNumber: 0, lengthInSheet: 0 };
    }
    const tree = new TreeModel();
    const draftTree = tree.parse({
      dir: root,
      name: "root",
      length: { lengthInNumber: 0, lengthInSheet: 0 },
    });

    resetCounter();
    for (const element of await draftsObject(root)) {
      const draftNode = tree.parse(element);
      draftTree.addChild(draftNode);
    }
    const targetFileNode = draftTree.first(function (node) {
      return node.model.dir.normalize("NFC") === dirPath;
    });

    if (targetFileNode) {
      return targetFileNode.model.length;
    }
    return { lengthInNumber: 0, lengthInSheet: 0 };
  }

  public async _setIfChildOfTarget(): Promise<boolean> {
    const root = await manuscriptRoot();
    if (root == "") {
      return false;
    }
    const tree = new TreeModel();
    const draftTree = tree.parse({ dir: root, name: "root", length: 0 });
    const activeDocumentPath = window.activeTextEditor?.document.uri.fsPath;

    resetCounter();
    for (const element of await draftsObject(root)) {
      const draftNode = tree.parse(element);
      draftTree.addChild(draftNode);
    }
    const deadLineFolderNode = draftTree.first(
      (node) => node.model.dir === this._countingFolder,
    );

    if (deadLineFolderNode?.hasChildren) {
      const treeForTarget = new TreeModel();
      const targetTree = treeForTarget.parse(deadLineFolderNode.model);

      const ifEditorIsChild = targetTree.first(
        (node) => node.model.dir === activeDocumentPath,
      );
      if (ifEditorIsChild) {
        this._isEditorChildOfTargetFolder = true;
        return true;
      }
    }

    this._isEditorChildOfTargetFolder = false;
    return false;
  }

  public _updateCountingObject(): boolean {
    return true;
  }

  public editDistance = -1;
  public writingProgress = 0;
  public latestText: null | string = null;
  private projectPath = "";
  public ifEditDistance = false;
  public isEditDistanceInCalc = false;

  public async _setEditDistance(): Promise<void> {
    const activeDocumentPath = window.activeTextEditor?.document.uri.fsPath;
    if (
      workspace.workspaceFolders == undefined ||
      !(await ifFileInDraft(activeDocumentPath)) ||
      getConfig().displayEditDistance == false
    ) {
      return;
    }
    if (typeof activeDocumentPath != "string") return;
    this.projectPath = workspace.workspaceFolders[0].uri.fsPath;
    const relatevePath = path
      .relative(this.projectPath, activeDocumentPath)
      .replace(new RegExp("\\" + path.sep, "g"), "/");
    const options: Partial<SimpleGitOptions> = {
      baseDir: this.projectPath,
      binary: "git",
      maxConcurrentProcesses: 6,
      trimmed: false,
    };
    const git = simpleGit(options);

    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return;
      await git.revparse("--is-inside-work-tree");

      const logOption = {
        file: relatevePath,
        "--until": "today00:00:00",
        n: 1,
      };
      const logs = await git.log(logOption);

      let latestHash = "";
      let showString = "";
      if (logs.total === 0) {
        const logOptionLatest = {
          file: relatevePath,
          "--reverse": null,
          "--max-count": "10",
        };
        const logsLatest = await git.log(logOptionLatest);
        if (logsLatest?.total === 0) {
          window.showInformationMessage(
            `このファイルはまだコミットされていないようです`,
          );
          this.ifEditDistance = false;
          this.latestText = null;
          await this.updateCharacterCount();
          return;
        }
        latestHash = logsLatest.all[0].hash;
      } else {
        latestHash = logs.all[0].hash;
      }
      showString = latestHash + ":" + relatevePath;
      let showLog = await git.show(showString);
      if (typeof showLog === "string") {
        if (showLog == "") showLog = " ";
        this.latestText = showLog;
        this.ifEditDistance = true;
        await this.updateCharacterCount();
      }
    } catch (err) {
      console.error("failed:", err);
      this.ifEditDistance = false;
      this.latestText = null;
      await this.updateCharacterCount();
    }
  }

  public _setLatestUpdate(latestGitText: string): void {
    this.latestText = latestGitText;
    console.log("latest from Git:", latestGitText);
    this._updateEditDistanceDelay();
  }

  private keyPressFlag = false;

  public async _resetWritingProtgress(): Promise<void> {
    const root = await manuscriptRoot();
    const currentTotal = await totalLength(root);
    this.totalCountPrevious = currentTotal.lengthInNumber;
    this.totalSheetCountPrevious = currentTotal.lengthInSheet;
    this.totalCountPreviousDate = new Date();
    this._saveProgressBaseline(currentTotal, this.totalCountPreviousDate);
    await this.updateCharacterCount();
    vscode.window.showInformationMessage(`今日の総合進捗をリセットしました`);
  }

  public async _updateEditDistanceActual(): Promise<void> {
    const currentText = window.activeTextEditor?.document.getText();

    if (this.latestText != null && typeof currentText == "string") {
      this.editDistance = distance(this.latestText, currentText);
      this.writingProgress = currentText.length - this.latestText.length;
      this.keyPressFlag = false;
      this.isEditDistanceInCalc = false;
      await this.updateCharacterCount();
    }

    delete this.timeoutID;
  }

  public _updateEditDistanceDelay(): void {
    if (!this.keyPressFlag && window.activeTextEditor) {
      this.isEditDistanceInCalc = true;
      this.keyPressFlag = true;
      const updateCounter = Math.min(
        Math.ceil(window.activeTextEditor.document.getText().length / 100),
        500,
      );
      this.timeoutID = setTimeout(() => {
        void this._updateEditDistanceActual();
      }, updateCounter);
    }
  }

  public _timerCancel(): void {
    if (typeof this.timeoutID == "number") {
      this.clearTimeout(this.timeoutID);
      delete this.timeoutID;
    }
  }

  clearTimeout(timeoutID: number): void {
    throw new Error("Method not implemented." + timeoutID);
  }

  public dispose(): void {
    this._statusBarItem.dispose();
  }
}

export function formatSheetsAndLines(sheetFloat: number): string {
  if (sheetFloat <= 0) {
    return "0枚0行";
  }
  const totalLines = Math.ceil(sheetFloat * 20);
  const sheetInt = Math.floor(totalLines / 20);
  const modLines = totalLines % 20;

  const sheetsStr = `${Intl.NumberFormat().format(sheetInt)}枚`;
  const linesStr = `${Intl.NumberFormat().format(modLines)}行`;

  return `${sheetsStr}${linesStr}`;
}

export function formatSignedSheetsAndLines(sheetFloat: number): string {
  const sign = sheetFloat > 0 ? "+" : sheetFloat < 0 ? "-" : "±";
  return `${sign}${formatSheetsAndLines(Math.abs(sheetFloat))}`;
}

// MARK: コントローラー
export class CharacterCounterController {
  private _characterCounter: CharacterCounter;
  private _disposable: DisposableType;

  constructor(characterCounter: CharacterCounter) {
    this._characterCounter = characterCounter;
    void this._characterCounter._setEditDistance();
    void this._characterCounter.updateCharacterCount();

    const subscriptions: DisposableType[] = [];
    window.onDidChangeTextEditorSelection(this._onEvent, this, subscriptions);
    workspace.onDidSaveTextDocument(this._onSave, this, subscriptions);
    window.onDidChangeActiveTextEditor(
      this._onFocusChanged,
      this,
      subscriptions,
    );

    this._disposable = Disposable.from(...subscriptions);
  }

  private _onEvent() {
    void this._characterCounter.updateCharacterCount();
    if (
      this._characterCounter.ifEditDistance &&
      !this._characterCounter.isEditDistanceInCalc
    ) {
      this._characterCounter._updateEditDistanceDelay();
    }
  }

  private _onFocusChanged() {
    void this._characterCounter._setIfChildOfTarget();
    this._characterCounter.ifEditDistance = false;
    this._characterCounter.latestText = "\n";
    this._characterCounter.editDistance = -1;
    void this._characterCounter._setEditDistance();
    this._characterCounter._updateCountingObject();
  }

  private _onSave() {
    this._characterCounter._updateCountingObject();
    void this._characterCounter._updateProjectCharacterCount();
  }

  public dispose(): void {
    this._disposable.dispose();
  }
}
