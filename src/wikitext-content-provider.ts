import * as vscode from 'vscode';

export class WikiTextContentProvider implements vscode.TextDocumentContentProvider {
    constructor() {}
    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        return uri.authority + uri.path;
    }
  }