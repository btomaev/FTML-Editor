import * as vscode from 'vscode';
import { FTMLPreviewPanel, PreviewPanelsList } from "./preview-panel";
import { AUTH_TYPE, WikiAuthProvider, WikiSession } from './wiki-auth';
import { loadMeta, saveMeta, FileMeta, migrateMeta } from './files-meta';
import { md5 } from 'js-md5';
import { basename } from './utils';
import { WikiTextContentProvider } from './wikitext-contetn-provider';

async function checkPasskey(secrets: vscode.SecretStorage) {
    let passkey = await secrets.get('preview.passkey');

    if (!passkey) return false;
    if (md5(passkey) != '0d7cfa875ed93012a2263112124c0975') {
        vscode.window.showErrorMessage('Wrong passkey, access denied');
        const newPasskey = await vscode.window.showInputBox({
            title: 'Введите пароль для доступа к функции',
            placeHolder: "******",
            prompt: 'Эта функция на стадии тестирования и доступна не всем\n',
            ignoreFocusOut: true
        });
        if(newPasskey == undefined) return false;
        await secrets.store('preview.passkey', newPasskey);
        return await checkPasskey(secrets);
    }
    return true;
}

async function startPreview(context: vscode.ExtensionContext, isLive: boolean) {
    if (vscode.window.activeTextEditor == null) return;

    const document = vscode.window.activeTextEditor.document;

    const meta = await loadMeta(document.uri);
        
    const pageId = await vscode.window.showInputBox({
        title: 'ID страницы',
        placeHolder: "scp-XXXX",
        prompt: 'Оставьте пустым для новой стрваницы',
        value: meta.pageId,
        ignoreFocusOut: true
    });

    await saveMeta(document.uri, {
        pageId: pageId
    } as FileMeta);

    const pp = FTMLPreviewPanel.startPeview(document, pageId ? pageId : 'main', isLive, context);

    PreviewPanelsList.push(pp);
}

export function activate(context: vscode.ExtensionContext) {
    const AuthProvider = new WikiAuthProvider(context);

    const cmd_login = vscode.commands.registerCommand('ftml-editor.account.login', async () => {
        AuthProvider.createSession()
        .then(session => {
            vscode.window.showInformationMessage('Вход успешно выполнен.');
        })
        .catch(e => {
            vscode.window.showErrorMessage(e.toString());
        });
    });

    const cmd_logout = vscode.commands.registerCommand('ftml-editor.account.logout', async () => {
        vscode.authentication.getSession(AUTH_TYPE, [], {
            clearSessionPreference: true,
        })
        .then(session => {
            if (session) {
                AuthProvider.removeSession(session.id).then(() => {
                    vscode.window.showInformationMessage('Выход успешно выполнен.');
                })
                .catch(e => {
                    vscode.window.showErrorMessage(e.toString());
                });
            }
        });
    });

    const cmd_publish = vscode.commands.registerCommand('ftml-editor.article.publish', async () => {
        if (vscode.window.activeTextEditor == null) return;

        const document = vscode.window.activeTextEditor.document;
        const publishCancel = 'Публикация отменена.';

        vscode.authentication.getSession(AUTH_TYPE, [], {
            clearSessionPreference: true,
            createIfNone: true,
        })
        .then(async session => { try {
            if (session) {
                const meta = await loadMeta(document.uri);
                
                const pageId = await vscode.window.showInputBox({
                    title: 'ID страницы',
                    placeHolder: "scp-XXXX",
                    prompt: 'Вводите внимательно!',
                    value: meta.pageId,
                    ignoreFocusOut: true
                });
        
                if (!pageId) throw publishCancel;
            
                const title = await vscode.window.showInputBox({
                    title: 'Заголовок страницв',
                    placeHolder: "Новый заголовок",
                    prompt: 'Вводите внимательно! (может быть пустым)',
                    value: meta.title,
                    ignoreFocusOut: true
                });

                const comment = await vscode.window.showInputBox({
                    title: 'Коментарий к публикации',
                    placeHolder: "Исправлено что-то там",
                    prompt: 'Можно оставить пустым',
                    ignoreFocusOut: true
                });

                const shure = await vscode.window.showInputBox({
                    title: 'Вы уверены, что хотите опубликовать статью?',
                    placeHolder: "Опубликовать",
                    prompt: `ID страницы: ${pageId}, \nЗаголовок: ${title ? title : 'отсутствует'}, \nКомментарий: ${comment ? comment : 'отсутствует'}, \nЕсли да - напишите "опубликовать"`,
                    ignoreFocusOut: true
                    
                });

                await saveMeta(document.uri, {
                    pageId: pageId,
                    title: title
                } as FileMeta);

                if (shure?.toLocaleLowerCase() != 'опубликовать') throw publishCancel;

                const response = await AuthProvider.publishArticle(session as WikiSession, pageId, title ? title : '', document.getText(), comment);

                if (response) vscode.window.showInformationMessage('Статья успешно опубликована.');
            }
        } catch (error) {
            if (error != null)
            vscode.window.showErrorMessage(error.toString());
        }});
    });

    const cmd_fetch = vscode.commands.registerCommand('ftml-editor.article.fetch', async () => {
        if (vscode.window.activeTextEditor == null) return;

        const editor = vscode.window.activeTextEditor;
        const document = editor.document;
        const fetchCancel = 'Загрузка отменена.';
        const fetchError = 'Ошибка загрузки.';

        if (document.isUntitled) {
            if (await document.save())
            vscode.commands.executeCommand('ftml-editor.article.fetch');
            return;
        }

        const meta = await loadMeta(document.uri);

        vscode.authentication.getSession(AUTH_TYPE, [], {
            clearSessionPreference: true,
            createIfNone: true,
        })
        .then(async session => { try {
            if (session) {
                const pageId = await vscode.window.showInputBox({
                    title: 'ID страницы',
                    placeHolder: "scp-XXXX",
                    prompt: 'Вводите внимательно!',
                    value: meta.pageId,
                    ignoreFocusOut: true
                });
        
                if (!pageId) throw fetchCancel;
                
                const aritcle = await AuthProvider.fetchArticle(session as WikiSession, pageId);

                if (!aritcle) throw fetchError;

                if (document.getText()) {
                    const diffUri = vscode.Uri.from({
                        scheme: 'wikitext',
                        path: aritcle.source,
                    });

                    const diffDoc = await vscode.workspace.openTextDocument(diffUri);
                    await vscode.languages.setTextDocumentLanguage(diffDoc, 'ftml');

                    await vscode.commands.executeCommand(
                        "vscode.diff",
                        document.uri,
                        diffUri,
                        `${basename(document.fileName)} ← ${aritcle.pageId}`
                    );

                    const answer = await vscode.window.showWarningMessage(`Файл ${basename(document.fileName)} уже содержит текст, хотите его заменить?.`, "Заменить", "Отмена");

                    switch (answer) {
                        case 'Заменить':
                            await document.save()
                            .then(async s => {
                                await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(aritcle.source));
                                await vscode.languages.setTextDocumentLanguage(document, 'ftml');

                                await saveMeta(document.uri, {
                                    pageId: aritcle.pageId,
                                    title: aritcle.title
                                } as FileMeta);
                    
                                await vscode.window.showInformationMessage('Статья успешно ззагружена.');
                            })
                            break;
                        case 'Отмена':
                            throw fetchCancel;
                    }
                } else {
                    await document.save()
                    .then(async s => {
                        await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(aritcle.source));
                    
                        await saveMeta(document.uri, {
                            pageId: aritcle.pageId,
                            title: aritcle.title
                        } as FileMeta);

                        await vscode.languages.setTextDocumentLanguage(document, 'ftml');
        
                        await vscode.window.showInformationMessage('Статья успешно ззагружена.');
                    });
                }
            }
        } catch (error) {
            if (error != null)
            vscode.window.showErrorMessage(error.toString());
        }});
    });

    const cmd_refresh = vscode.commands.registerCommand('ftml-editor.preview.refresh', async () => {
        for (var i=0; i<PreviewPanelsList.length; i++) {
            const pp = PreviewPanelsList[i];
            if (pp.isDisposed) {
                PreviewPanelsList.splice(i++, 1);
                continue;
            }
            if (pp.panel.visible)
            pp.update();
        }
    });

    const cmd_preview = vscode.commands.registerCommand('ftml-editor.preview.start', async () => {
        await startPreview(context, false);
    });

    const cmd_preview_live = vscode.commands.registerCommand('ftml-editor.preview.start-live', async () => {
        if (await checkPasskey(context.secrets) != true) return;
        await startPreview(context, true);
    });

    const previewSerializer = vscode.window.registerWebviewPanelSerializer('ftml-editor.webview.preview', {
        async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
            let document = await vscode.workspace.openTextDocument(state.fileName);
            webviewPanel.webview.html = state.html;
            const pp = new FTMLPreviewPanel(webviewPanel, document, state.pageId, context, state.html=="", state.isLive);
            PreviewPanelsList.push(pp);
        }
    });

    vscode.workspace.registerTextDocumentContentProvider("wikitext", new WikiTextContentProvider());

    // vscode.workspace.onDidCloseTextDocument(e =>{
    //     if (e.uri.scheme == "wikidot-rev" && WdRevUriToSourceEditor.has(e.uri.toString())) {
    //         WdRevUriToSourceEditor.delete(e.uri.toString());
    //     }
    // })

    vscode.workspace.onWillRenameFiles(async e => {
        for(let i=0; i<e.files.length; i++){
            const file = e.files[i];
            await migrateMeta(file.oldUri, file.newUri);
        }
    });

    context.subscriptions.push(cmd_login);
    context.subscriptions.push(cmd_logout);
    context.subscriptions.push(cmd_publish);
    context.subscriptions.push(cmd_fetch);
    context.subscriptions.push(cmd_refresh);
    context.subscriptions.push(cmd_preview);
    context.subscriptions.push(cmd_preview_live);
    context.subscriptions.push(previewSerializer);
}

export function deactivate() {}

