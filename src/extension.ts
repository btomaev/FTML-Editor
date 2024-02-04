import * as vscode from 'vscode';
import { FTMLPreviewPanel, PreviewPanelsList } from './preview-panel';
import { AUTH_TYPE, WikiAuthProvider, WikiSession } from './wiki-auth';
import { loadMeta, saveMeta, FileMeta, migrateMeta } from './files-meta';
import { md5 } from 'js-md5';
import { basename, capitalize } from './utils';
import { WikiTextContentProvider } from './wikitext-contetn-provider';
import { ActionCanceledError, PageDoesNotExistError } from './errors';

async function checkPasskey(secrets: vscode.SecretStorage) {
    let passkey = await secrets.get('preview.passkey');

    if (!passkey) return false;
    if (md5(passkey) != '0d7cfa875ed93012a2263112124c0975') {
        vscode.window.showErrorMessage('Wrong passkey, access denied');
        const newPasskey = await vscode.window.showInputBox({
            title: 'Введите пароль для доступа к функции',
            placeHolder: '******',
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
        
    try {
        const pageId = await vscode.window.showInputBox({
            title: 'ID страницы',
            placeHolder: 'scp-XXXX',
            prompt: 'main - если не знаете что вписать',
            value: meta.pageId ? meta.pageId : 'main',
            ignoreFocusOut: true
        });

        if (!pageId) throw new ActionCanceledError('Предпросмотр отменен');

        await saveMeta(document.uri, {
            pageId: pageId
        } as FileMeta);

        const pp = FTMLPreviewPanel.startPeview(document, pageId ? pageId : 'main', isLive, context);

        PreviewPanelsList.push(pp);
    } catch (e) {
        vscode.window.showErrorMessage((e as Error).message);
    }
}

export function activate(context: vscode.ExtensionContext) {
    const AuthProvider = new WikiAuthProvider(context);

    const cmd_login = vscode.commands.registerCommand('ftml-editor.account.login', async () => {
        AuthProvider.createSession()
        .then(session => {
            vscode.window.showInformationMessage('Вход успешно выполнен');
        })
        .catch(e => {
            vscode.window.showErrorMessage(e.message);
        });
    });

    const cmd_logout = vscode.commands.registerCommand('ftml-editor.account.logout', async () => {
        vscode.authentication.getSession(AUTH_TYPE, [], {
            clearSessionPreference: true,
        })
        .then(session => {
            if (session) {
                AuthProvider.removeSession(session.id).then(() => {
                    vscode.window.showInformationMessage('Выход успешно выполнен');
                })
                .catch(e => {
                    vscode.window.showErrorMessage(e.message);
                });
            }
        });
    });

    const cmd_publish = vscode.commands.registerCommand('ftml-editor.article.publish', async () => {
        if (vscode.window.activeTextEditor == null) return;

        const document = vscode.window.activeTextEditor.document;

        if (document.languageId != 'ftml') return;

        const publishCancel = new ActionCanceledError('Публикация отменена');

        try {
            const session = await vscode.authentication.getSession(AUTH_TYPE, [], {
                clearSessionPreference: true,
                createIfNone: true,
            })

            const meta = await loadMeta(document.uri);
            
            const pageId = await vscode.window.showInputBox({
                title: 'ID страницы',
                placeHolder: 'scp-XXXX',
                prompt: 'Вводите внимательно!',
                value: meta.pageId,
                ignoreFocusOut: true
            });
    
            if (!pageId) throw publishCancel;

            let article;
            let newPage = false;

            try {
                article = await AuthProvider.fetchArticle(session as WikiSession, pageId);
            } catch (e) {
                if (!(e instanceof PageDoesNotExistError)) throw e;

                const answer = await vscode.window.showWarningMessage(`Страницы ${pageId} не существует, хотите создать её?`, { modal: true }, 'Создать');
                
                switch (answer) {
                    case 'Создать':
                        newPage = true;
                        break;
                    default:
                        throw publishCancel;
                }
            }
        
            const title = await vscode.window.showInputBox({
                title: 'Заголовок страницв',
                placeHolder: 'Новый заголовок',
                prompt: 'Вводите внимательно! (может быть пустым)',
                value: meta.title ? meta.title : article?.title,
                ignoreFocusOut: true
            });

            let comment: string | undefined;

            if (!newPage)
            comment = await vscode.window.showInputBox({
                title: 'Коментарий к публикации',
                placeHolder: 'Исправлено что-то там',
                prompt: 'Можно оставить пустым',
                ignoreFocusOut: true
            });

            const verb = newPage ? 'создать': 'опубликовать';

            const shure = await vscode.window.showInputBox({
                title: `Вы уверены, что хотите ${verb} статью?`,
                placeHolder: `${capitalize(verb)}`,
                prompt: `ID страницы: ${pageId}, \nЗаголовок: ${title ? title : 'отсутствует'}, \nКомментарий: ${comment ? comment : 'отсутствует'}, \nЕсли да - напишите "${verb}"`,
                ignoreFocusOut: true 
            });

            await saveMeta(document.uri, {
                pageId: pageId,
                title: title
            } as FileMeta);

            if (shure?.toLocaleLowerCase() != verb) throw publishCancel;

            const apply = async () => {
                let publishedArticle;

                if (newPage) {
                    publishedArticle = await AuthProvider.createNewPage(session as WikiSession, pageId, title ? title : '', document.getText(), comment);
                } else {
                    publishedArticle = await AuthProvider.publishArticle(session as WikiSession, pageId, title ? title : '', document.getText(), comment);
                }

                await saveMeta(document.uri, {
                    hash: md5(publishedArticle.source)
                } as FileMeta);

                vscode.window.showInformationMessage('Статья успешно опубликована');
            }

            if (!newPage && await AuthProvider.isGreenLight(document, article!)) {
                const diffUri = vscode.Uri.from({
                    scheme: 'wikitext',
                    path: article?.source,
                });

                const diffDoc = await vscode.workspace.openTextDocument(diffUri);
                await vscode.languages.setTextDocumentLanguage(diffDoc, 'ftml');

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    document.uri,
                    diffUri,
                    `${basename(document.fileName)} → ${article?.pageId}`
                );

                const answer = await vscode.window.showWarningMessage(`Текст страницы ${pageId} был изменен на сервере, хотите продолжить публикацию?`, 'Опубликовать', 'Отмена');

                switch (answer) {
                    case 'Опубликовать':
                        await document.save().then(apply);
                        break;
                    case 'Отмена':
                    default:
                        throw publishCancel;
                }
            } else {
                await document.save().then(apply);
            }
        } catch (e) {
            if (e != null)
            vscode.window.showErrorMessage((e as Error).message);
        }
    });

    const cmd_fetch = vscode.commands.registerCommand('ftml-editor.article.fetch', async () => {
        if (vscode.window.activeTextEditor == null) return;
        
        const fetchCancel = new ActionCanceledError('Загрузка отменена');

        const editor = vscode.window.activeTextEditor;
        const document = editor.document;
        const text = document.getText();

        const meta = await loadMeta(document.uri);

        try {
            const session = await vscode.authentication.getSession(AUTH_TYPE, [], {
                clearSessionPreference: true,
                createIfNone: true,
            })

            const pageId = await vscode.window.showInputBox({
                title: 'ID страницы',
                placeHolder: 'scp-XXXX',
                prompt: 'Вводите внимательно!',
                value: meta.pageId,
                ignoreFocusOut: true
            });
    
            if (!pageId) throw fetchCancel;
            
            const article = await AuthProvider.fetchArticle(session as WikiSession, pageId);

            const apply = async () => {
                await editor.edit(editBuilder => {
                    editBuilder.replace(new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(text.length - 1)
                    ), article.source)
                });
                
                await vscode.languages.setTextDocumentLanguage(document, 'ftml');
                
                await saveMeta(document.uri, {
                    pageId: article.pageId,
                    title: article.title,
                    hash: md5(article.source)
                } as FileMeta);

                await vscode.window.showInformationMessage('Статья успешно ззагружена');
            };

            if (text) {
                const diffUri = vscode.Uri.from({
                    scheme: 'wikitext',
                    path: article.source,
                });

                const diffDoc = await vscode.workspace.openTextDocument(diffUri);
                await vscode.languages.setTextDocumentLanguage(diffDoc, 'ftml');

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    document.uri,
                    diffUri,
                    `${basename(document.fileName)} ← ${article.pageId}`
                );

                const answer = await vscode.window.showWarningMessage(`Файл ${basename(document.fileName)} уже содержит текст, хотите его заменить?`, 'Заменить', 'Отмена');

                switch (answer) {
                    case 'Заменить':
                        await apply();
                        break;
                    case 'Отмена':
                        throw fetchCancel;
                }
            } else {
                await apply();
            }
        } catch (e) {
            if (e != null)
            vscode.window.showErrorMessage((e as Error).message);
        }
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
            const pp = new FTMLPreviewPanel(webviewPanel, document, state.pageId, context, state.html=='', state.isLive);
            PreviewPanelsList.push(pp);
        }
    });

    const wikitext_content_provider = vscode.workspace.registerTextDocumentContentProvider('wikitext', new WikiTextContentProvider());

    const files_rename_event = vscode.workspace.onDidRenameFiles(async e => {
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

    context.subscriptions.push(wikitext_content_provider);
    context.subscriptions.push(files_rename_event);
}

export function deactivate() {}

