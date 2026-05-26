import * as vscode from "vscode";
import * as path from "node:path";
import { getConfig } from "./config.js";
import { deadLineFolderPath } from "./extension.js";
import TreeModel from "tree-model";

const filenameCollator = new Intl.Collator(undefined, { numeric: true });
const neutralCompare = (a: string | undefined, b: string | undefined): number =>
  filenameCollator.compare(a ?? "", b ?? "");

export default async function compileDocs(): Promise<void> {
  const projectName =
    deadLineFolderPath() == ""
      ? vscode.workspace.workspaceFolders?.[0].name
      : vscode.workspace.workspaceFolders?.[0].name +
        "-" +
        path.basename(deadLineFolderPath());
  const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!projectPath) return;
  const config = getConfig();
  const separatorString = config.enableSeparator
    ? "\n\n　　　" + config.separator + "\n\n"
    : "";
  const draftRootPath =
    deadLineFolderPath() == "" ? await manuscriptRoot() : deadLineFolderPath();

  console.log("ProjectName: ", projectName);
  console.log("締め切りフォルダー", deadLineFolderPath());

  // publishフォルダがなければ作る
  const publishUri = vscode.Uri.file(path.join(projectPath, "publish"));
  try {
    await vscode.workspace.fs.stat(publishUri);
  } catch {
    await vscode.workspace.fs.createDirectory(publishUri);
  }

  // 出力ファイル
  const fileExtension = config.draftFileType;
  const compiledTextFileUri = vscode.Uri.file(
    path.join(projectPath, "publish", projectName + fileExtension),
  );

  // テキストを書き込む
  const filelist = (await fileList(draftRootPath)).files;
  const chunks: string[] = [];
  let isFirst = true;
  for (const listItem of filelist) {
    if (isFirst) {
      isFirst = false;
    } else {
      chunks.push(separatorString);
    }

    if (listItem.dir) {
      const fileUri = vscode.Uri.file(listItem.dir);
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const fileContent = Buffer.from(fileData).toString("utf8");

      chunks.push(fileContent);
    }
  }

  try {
    await vscode.workspace.fs.writeFile(
      compiledTextFileUri,
      Buffer.from(chunks.join(""), "utf8"),
    );
  } catch (err) {
    console.log("ファイル書き込み時のエラー", err);
  }
}

export async function manuscriptRoot(): Promise<string> {
  if (
    vscode.workspace.name == undefined ||
    vscode.workspace.workspaceFolders == undefined
  ) {
    return "";
  }
  const projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

  if (await isDirectory(path.join(projectPath, "manuscript"))) {
    return path.join(projectPath, "manuscript");
  }
  if (await isDirectory(path.join(projectPath, "draft"))) {
    return path.join(projectPath, "draft");
  }
  return projectPath;
}

async function isDirectory(fsPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return (stat.type & vscode.FileType.Directory) === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

type DirentLike = {
  name: string;
  type: vscode.FileType;
};

type File = {
  dir?: string;
  name?: string;
  length?: number;
  directoryName?: string;
  directoryLength?: number;
  depthIndicator?: number;
};

type FileList = {
  label: string;
  files: File[];
  length: number;
};

export async function fileList(dirPath: string): Promise<FileList> {
  let characterCount = 0;
  const filesInFolder = (await getFiles(dirPath)).sort((a, b) =>
    neutralCompare(a.name, b.name),
  );

  const labelOfList = path.basename(dirPath);
  const files: File[] = [];

  for (const dirent of filesInFolder) {
    const isDir = (dirent.type & vscode.FileType.Directory) !== 0;
    const isFile = (dirent.type & vscode.FileType.File) !== 0;
    if (isDir && dirent.name == "publish") {
      // skip
    } else if (dirent.name.match(/^\..*/)) {
      // skip hidden
    } else if (isDir) {
      const fp = path.join(dirPath, dirent.name);
      const containerFiles = await fileList(fp);

      files.push({
        directoryName: dirent.name,
        directoryLength: containerFiles.length,
      });

      characterCount += containerFiles.length;
      files.push(...containerFiles.files);
    } else if (
      isFile &&
      [getConfig().draftFileType].includes(path.extname(dirent.name))
    ) {
      const fileUri = vscode.Uri.file(path.join(dirPath, dirent.name));
      const data = await vscode.workspace.fs.readFile(fileUri);
      let readingFile = Buffer.from(data).toString("utf8");
      readingFile = readingFile
        .replace(/\s/g, "")
        .replace(/《(.+?)》/g, "")
        .replace(/[|｜]/g, "")
        .replace(/<!--(.+?)-->\n*/, "");
      files.push({
        dir: path.join(dirPath, dirent.name).normalize("NFC"),
        name: dirent.name,
        length: readingFile.length,
      });
      characterCount += readingFile.length;
    }
  }
  return {
    label: labelOfList,
    files,
    length: characterCount,
  };
}

async function getFiles(dirPath: string): Promise<DirentLike[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(dirPath),
    );
    return entries.map(([name, type]) => ({ name, type }));
  } catch {
    console.log(`${dirPath}が見つかりませんでした`);
    return [];
  }
}

type FileNode = {
  id: string;
  dir: string;
  name: string;
  length: {
    lengthInNumber: number;
    lengthInSheet: number;
  };
  children?: FileNode[];
  isClosed?: boolean;
};

let globalCounter = 0;

export function resetCounter() {
  globalCounter = 0;
}

export async function draftsObject(
  dirPath: string,
  context: vscode.ExtensionContext | null = null,
  isRootCall: boolean = true,
): Promise<FileNode[]> {
  const results: FileNode[] = [];
  if (isRootCall) {
    resetCounter();
  }

  const folderStates = context
    ? context.workspaceState.get<{ [key: string]: boolean }>("folderStates", {})
    : {};

  const filesInFolder = (await getFiles(dirPath)).sort((a, b) =>
    neutralCompare(a.name, b.name),
  );

  for (const dirent of filesInFolder) {
    const isDir = (dirent.type & vscode.FileType.Directory) !== 0;
    const isFile = (dirent.type & vscode.FileType.File) !== 0;
    if (isDir && (dirent.name === "publish" || dirent.name === "dict")) {
      // skip
    } else if (dirent.name.match(/^\..*/)) {
      // skip hidden
    } else if (isDir) {
      const directoryPath = path.join(dirPath, dirent.name);
      const containerFiles = await draftsObject(directoryPath, context, false);

      let containerLength = 0;
      let containerLengthInSheet = 0;
      for (const element of containerFiles) {
        containerLength += element.length.lengthInNumber;
        containerLengthInSheet += element.length.lengthInSheet;
      }

      const nodeId = `node_${globalCounter++}`;
      const directory: FileNode = {
        id: nodeId,
        dir: directoryPath,
        name: dirent.name,
        length: {
          lengthInNumber: containerLength,
          lengthInSheet: containerLengthInSheet,
        },
        children: containerFiles,
        isClosed: folderStates[nodeId] ?? true,
      };

      results.push(directory);
    } else if (
      isFile &&
      [getConfig().draftFileType].includes(path.extname(dirent.name))
    ) {
      const fileUri = vscode.Uri.file(path.join(dirPath, dirent.name));
      const data = await vscode.workspace.fs.readFile(fileUri);
      const readingFile = Buffer.from(data).toString("utf8");

      const fileNode: FileNode = {
        id: `node_${globalCounter++}`,
        dir: path.join(dirPath, dirent.name),
        name: dirent.name,
        length: getLength(readingFile),
      };

      results.push(fileNode);
    }
  }

  return results;
}

export function writeFolderStates(
  context: vscode.ExtensionContext,
  folders: FileNode[],
) {
  const folderStates: CachedFolderState = context.workspaceState.get(
    "folderStates",
    {},
  );

  for (const folder of folders) {
    folderStates[folder.id] = folder.isClosed ?? false;
    if (folder.children) {
      writeFolderStates(context, folder.children);
    }
  }

  context.workspaceState.update("folderStates", folderStates);
}

export async function totalLength(dirPath: string): Promise<{
  lengthInNumber: number;
  lengthInSheet: number;
}> {
  const result = { lengthInNumber: 0, lengthInSheet: 0 };
  const drafts = await draftsObject(dirPath);
  for (const element of drafts) {
    result.lengthInNumber += element.length.lengthInNumber;
    result.lengthInSheet += element.length.lengthInSheet;
  }
  return result;
}

export async function ifFileInDraft(
  DocumentPath: string | undefined,
): Promise<boolean> {
  const root = await manuscriptRoot();
  if (root == "") {
    return false;
  }
  const tree = new TreeModel();
  const draftTree = tree.parse({ dir: root, name: "root", length: 0 });
  for (const element of await draftsObject(root)) {
    const draftNode = tree.parse(element);
    draftTree.addChild(draftNode);
  }
  const activeDocumentObject = draftTree.first(
    (node) => node.model.dir === DocumentPath,
  );
  return activeDocumentObject ? true : false;
}

// MARK: 長さの計算
export function getLength(textDocument: string): {
  lengthInNumber: number;
  lengthInSheet: number;
} {
  let docContent = textDocument;
  docContent = docContent
    .replace(/[ \t\r\f\v]/g, "")
    .replace(/《(.+?)》/g, "")
    .replace(/[|｜]/g, "")
    .replace(/<!--[\s\S]*?-->\n*/g, "");
  let characterCount = 0;
  let sheetCount = 0;
  if (docContent !== "") {
    characterCount = docContent.replace(/\s/g, "").length;
    const paragraphs = docContent.split(/\r\n|\r|\n/);

    let lineCount = 0;
    const lineLength = 20;
    for (const [index, paragraph] of paragraphs.entries()) {
      const paragraphLength = paragraph.length;
      if (paragraphLength === 0 && index < paragraphs.length - 1) {
        lineCount += 1;
      } else {
        lineCount += Math.ceil(paragraphLength / lineLength);
      }
    }
    sheetCount = lineCount / 20;
  }
  return { lengthInNumber: characterCount, lengthInSheet: sheetCount };
}

type CachedFolderState = { [key: string]: boolean };

export function updateFolderCache(
  context: vscode.ExtensionContext,
  nodeId: string,
  isClosed: boolean,
) {
  const folderStates: CachedFolderState = context.workspaceState.get(
    "folderStates",
    {},
  );
  folderStates[nodeId] = isClosed;
  context.workspaceState.update("folderStates", folderStates);
  cleanUpFolderStates(nodeId, context);
  console.log("folderStates", folderStates);
}

export function getCachedFolderStates(
  context: vscode.ExtensionContext,
): CachedFolderState {
  return context.workspaceState.get("folderStates", {});
}

export function cleanUpFolderStates(
  currentFolderIds: string,
  context: vscode.ExtensionContext,
) {
  const folderStates: CachedFolderState = context.workspaceState.get(
    "folderStates",
    {},
  );

  for (const id in folderStates) {
    if (!currentFolderIds.includes(id)) {
      delete folderStates[id];
    }
  }

  context.workspaceState.update("folderStates", folderStates);
}
