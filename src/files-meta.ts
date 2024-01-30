import * as vscode from 'vscode';

export type FileMeta = {
    pageId: string,
    title: string
}

export async function migrateMeta(oldUri: vscode.Uri, newUri: vscode.Uri) {
    if (oldUri.scheme == 'untitled') return false;
    
    try {
        const oldMetaUri = vscode.Uri.parse(oldUri.toString() + '.meta');
        const newMetaUri = vscode.Uri.parse(newUri.toString() + '.meta');
        vscode.workspace.fs.rename(oldMetaUri, newMetaUri);
        return true;
    } catch {
        return false;
    }
}

export async function saveMeta(documentUri: vscode.Uri, value: FileMeta) {
    if (documentUri.scheme == 'untitled') return;
    const metaUri = vscode.Uri.parse(documentUri.toString() + '.meta');

    let metaData: FileMeta = {} as FileMeta;

    try {
        const document = await vscode.workspace.openTextDocument(metaUri);
    
        metaData = JSON.parse(document.getText()) as FileMeta;
    } catch {}

    metaData = Object.assign({}, metaData, value);
    
    await vscode.workspace.fs.writeFile(metaUri, new TextEncoder().encode(JSON.stringify(metaData)));
}

export async function loadMeta(documentUri: vscode.Uri) {
    const metaUri = vscode.Uri.parse(documentUri.toString() + '.meta');

    let metaData: FileMeta = {} as FileMeta;
    
    try {
        if (documentUri.scheme != 'untitled') {
            const document = await vscode.workspace.openTextDocument(metaUri);
        
            metaData = JSON.parse(document.getText()) as FileMeta;
        }
    } catch {}

    return metaData;
}