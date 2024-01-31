import * as vscode from 'vscode';
import pageTemplate from './templates/page-template.json';
import { renderFtml, asset } from './page-compose';
import { includeElements } from './web-includes-manager';
import { basename } from './utils';

export class FTMLPreviewPanel {
    public static readonly viewType = 'ftml-editor.webview.preview';
    public static readonly updateDelay = 1000;

    public isDisposed: boolean = false;

    public readonly isLive: boolean;
    public readonly panel: vscode.WebviewPanel;

    private readonly _document: vscode.TextDocument;
    private readonly _pageId: string;
    private readonly _context: vscode.ExtensionContext;
    private _statusBarItem: vscode.StatusBarItem;
    
    private _updateTimer: NodeJS.Timeout;

    private _disposables: vscode.Disposable[] = [];

    public static startPeview(document: vscode.TextDocument, pageId: string, isLive: boolean, context: vscode.ExtensionContext) {
        const docname = basename(document.fileName);

        const panel = vscode.window.createWebviewPanel(
            FTMLPreviewPanel.viewType,
            isLive ? `${docname} [live preview]` : `${docname} [preview]`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                enableForms: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, "web-static")
                ]
            }
        );

        return new FTMLPreviewPanel(panel, document, pageId, context, true, isLive);

    }

    public constructor(panel: vscode.WebviewPanel, document: vscode.TextDocument, pageId: string, context: vscode.ExtensionContext, reloadDocument: boolean=true, isLive: boolean=false) {
        this.panel = panel;
        this._document = document; 
        this._pageId = pageId;
        this._context = context;
        this.isLive = isLive;
        this._updateTimer = setTimeout(() => {});

        const webview = this.panel.webview;

        this._statusBarItem = this._createStatusbarItem();

        if (!this.isLive)
        this._statusBarItem.show();

        this.panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this.panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible) {
                    this._statusBarItem.show();
                } else {
                    this._statusBarItem.hide();
                }
            },
            null,
            this._disposables
        );

        webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );

        let textChangeListener = vscode.workspace.onDidChangeTextDocument(
            e => {
                if (e.document == this._document) {
                    this._onDocumetChanged(e);
                }
            },
            null,
            this._disposables
        );

        this._context.subscriptions.push(textChangeListener);
        
        if (reloadDocument)
        this.reloadDocument();
    }

    private _createStatusbarItem() {
        let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.text = '$(refresh) Обновить предпросмотр';
        statusBarItem.command = 'ftml-editor.preview.refresh';
        this._context.subscriptions.push(this._statusBarItem);
        // console.log(statusBarItem);
        return statusBarItem;
    }

    public dispose() {
        this.isDisposed = true;
        this.panel.dispose();
        this._statusBarItem.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public async update() {
        const document = this._document;
        try {
            const docText = document.getText();
            if (!docText) return
            let html = await renderFtml(docText, this._pageId, 'preview');
            this.updateDocument(html!);
        } catch (error) {
            if (error instanceof Error)
            vscode.window.showErrorMessage(error.toString());
        }
    }

    private _onDocumetChanged(e: vscode.TextDocumentChangeEvent) {
        if (!this.isLive) return;
        clearTimeout(this._updateTimer);

        if (this._document.getText() && e.contentChanges.length) {
            this._updateTimer = setTimeout(() => {this.update()}, FTMLPreviewPanel.updateDelay);
        } else {
            clearTimeout(this._updateTimer);
        }
    }

    public updateDocument(html: string, styles: string='') {
        const webview = this.panel.webview;

        const type = 'update-content';

        webview.postMessage({ 
            cmd: type, 
            content: html 
        });

        // console.log(html);
    }

    public reloadDocument() {
        const webview = this.panel.webview;
        let {styles, scripts} = includeElements(webview, this._context.extensionUri);

        let html = pageTemplate.value;
        
        html = 
        html.replace('%%FIRST_HAVE_PIECE%%', `
            ${styles.join("\n")}
            ${scripts.join("\n")}
        `);

        html = 
        html.replace('%%LAST_HAVE_PIECE%%', `
            <script>
                const vscode = acquireVsCodeApi();

                let state = vscode.getState() || {
                    fileName: ${JSON.stringify(this._document.fileName)},
                    pageId: ${JSON.stringify(this._pageId)},
                    isLive: ${JSON.stringify(this.isLive)},
                    html: document.documentElement.outerHTML,
                    styles: "",
                };

                vscode.setState(state);

                const previewStyles = document.getElementById('preview-styles');
                const previewContent = document.getElementById('page-content');

                window.addEventListener('message', e => {
                    const content = e.data.content;
                    switch (e.data.cmd) {
                        case "update-content":
                            previewContent.innerHTML = content;
                            state.html = document.documentElement.outerHTML;
                            vscode.setState(state);
                            setTimeout(attachObserver, 100);
                        case "update-styles":
                            previewStyles.innerHTML = content.map(v=>\`<style>\\n\${v.replace(/\\</g, '&lt;')}\\n</style>\`).join("\\n\\n");
                            state.styles = previewStyles.innerHTML;
                            vscode.setState(state);
                    }
                });
            </script>
        `);

        // html = 
        // html.replace('\'/-/', `${webview.asWebviewUri(asset('/css/test.png', this._context))}`);

        webview.html = html;

        this.update();
    }

    public collectPrefetchable() {
        const webview = this.panel.webview;

        const prefetchable = webview.html.matchAll(RegExp("url\(\s*[\'|\"](.*)[\'|\"]\s*\)"));

        return prefetchable;
    }
}

export let PreviewPanelsList: FTMLPreviewPanel[] = [];