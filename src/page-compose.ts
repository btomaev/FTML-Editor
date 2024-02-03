import * as vscode from 'vscode';
import { FetchResponse } from './utils';
import { NetworkError } from './errors';

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
       throw new NetworkError();
    });

    if (!response) {
        return null;
    }

	let result = ((await response.json()) as FetchResponse).content;

    result = result.replaceAll('src="//', 'src="https://');
    result = result.replaceAll('src="/', 'src="https://scpfoundation.net/');

    return result;
}
