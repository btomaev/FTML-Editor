import * as vscode from 'vscode';
import * as webIncludes from "./web-includes.json";

function asset(path: string, baseUri: vscode.Uri) {
    return vscode.Uri.joinPath( 
        baseUri, 'web-static', path
    )
}

export function includeElements(webview: vscode.Webview, extensionUri: vscode.Uri) {
    let styles: string[] = [];
    let scripts: string[] = [];

    webIncludes.styles.forEach(include => {
        styles.push(`<link rel="stylesheet" href="${webview.asWebviewUri(asset(include, extensionUri))}">`);
    });

    webIncludes.scripts.forEach(include => {
        scripts.push(`<script src="${webview.asWebviewUri(asset(include, extensionUri))}"></script>`);
    });

    return {styles, scripts};
}