import * as vscode from 'vscode';
import * as webIncludes from "./web-includes.json";
import { FetchResponse } from './utils';

export function asset(path: string, context: vscode.ExtensionContext) {
    return vscode.Uri.joinPath( 
        context.extensionUri, 'web-static', path
    )
}

export async function renderFtml(ftml: string, pageId: string, title: string) {
    const response = await fetch('https://scpfoundation.net/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageId: pageId,
            pathParams: {},
            source: ftml,
            title: title
        })
    })
    .then(result => result)
    .catch(e => {
       throw 'Сетевая ошибка.';
    });

    if (!response) {
        return null;
    }

	let result = ((await response.json()) as FetchResponse).content;

    result = result.replace('src="//', 'src="https://');
    result = result.replace('src="/', 'src="https://scpfoundation.net/');

    return result;
}

export async function composeDocument(webview: vscode.Webview, content: string, pageId: string, title: string, context: vscode.ExtensionContext) {
    let head: string[] = [];
    let body: string[] = [];
    let footer: string[] = [];

    type WebIncludes = {
        cssDependencies: string[],
        jsDependencies: string[]
    };

    webIncludes.styles.forEach(include => {
        console.log(asset(include, context));
        head.push(`<link rel="stylesheet" href="${webview.asWebviewUri(asset(include, context))}">`);
    });

    webIncludes.scripts.forEach(include => {
        footer.push(`<script src="${webview.asWebviewUri(asset(include, context))}"></script>`);
    });

    let data = await renderFtml(content, pageId, title);

    if (!data) return null;
    
    body.push(data);

    let html = `
    <!DOCTYPE html>
    <html>
        <head>
            ${head.join("\n")}
        </head>
        <body>
            <br>
            <div>
                ${body.join("\n")}
            </div>
            ${footer.join("\n")}
        </body>
    </html>
    `;

    return html;
}
