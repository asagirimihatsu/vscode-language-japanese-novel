import * as vscode from "vscode";
import * as path from "node:path";
import { simpleGit, type SimpleGitOptions } from "simple-git";

//instruction: from https://github.com/steveukx/git-js#readme

export class NovelGit {
  private projectPath: string =
    vscode.workspace.workspaceFolders![0].uri.fsPath;

  public async _isGitRepo(): Promise<boolean> {
    const options: Partial<SimpleGitOptions> = {
      baseDir: this.projectPath,
      binary: "git",
      maxConcurrentProcesses: 6,
      trimmed: false,
    };
    const novelGit = simpleGit(options);
    return await novelGit.checkIsRepo();
  }

  public async _getDayBackString(filePath: string): Promise<string> {
    const relatevePath = path.relative(this.projectPath, filePath);
    const options: Partial<SimpleGitOptions> = {
      baseDir: this.projectPath,
      binary: "git",
      maxConcurrentProcesses: 6,
      trimmed: false,
    };
    const novelGit = simpleGit(options);

    const logOption = { file: relatevePath, "--before": "yesterday", n: 1 };

    try {
      const logs = await novelGit.log(logOption);
      if (logs.total === 0) {
        return "";
      }
      const latestHash = logs.latest?.hash;
      const showString = `${latestHash}:${relatevePath}`;
      const showLog = await novelGit.show(showString);
      return typeof showLog === "string" ? showLog : "";
    } catch (err) {
      console.error("failed:", err);
      throw err;
    }
  }
}
