import * as vscode from 'vscode';

export type FileMeta = {
    pageId: string,
    title: string,
    hash: string,
}

export async function getMetaUri(documentUri: vscode.Uri) {
    const metaUri = vscode.Uri.parse(documentUri.toString() + '.meta');
    return metaUri;
}

export async function hasMeta(documentUri: vscode.Uri) {
    const metaUri = await getMetaUri(documentUri);

    try {
        await vscode.workspace.fs.readFile(metaUri);
        return true;
    } catch {
        return false;
    }
}

export async function migrateMeta(oldUri: vscode.Uri, newUri: vscode.Uri) {
    if (oldUri.scheme == 'untitled') return false;

    if (!(await hasMeta(oldUri))) return false;
    
    const oldMetaUri = await getMetaUri(oldUri);
    const newMetaUri = await getMetaUri(newUri);

    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldMetaUri, newMetaUri);
    await vscode.workspace.applyEdit(edit);
    return true;
}

export async function saveMeta(documentUri: vscode.Uri, value: FileMeta) {
    const metaUri = await getMetaUri(documentUri);

    let metaData: FileMeta = {} as FileMeta;

    if (await hasMeta(documentUri)) {
        const document = await vscode.workspace.openTextDocument(metaUri);
        const text = document.getText();
    
        if (text)
            metaData = JSON.parse(text) as FileMeta;
    }
    
    metaData = Object.assign({}, metaData, value);
    
    if (metaUri.scheme == 'untitled') {
        // TODO: implement meta files support for untitled files
    } else {
        await vscode.workspace.fs.writeFile(metaUri, new TextEncoder().encode(JSON.stringify(metaData)));
    }
}

export async function loadMeta(documentUri: vscode.Uri) {
    const metaUri = await getMetaUri(documentUri);

    let metaData: FileMeta = {} as FileMeta;
    
    if (await hasMeta(documentUri)) {
        const document = await vscode.workspace.openTextDocument(metaUri);
    
        metaData = JSON.parse(document.getText()) as FileMeta;
    }

    return metaData;
}