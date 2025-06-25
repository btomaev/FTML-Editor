import * as vscode from 'vscode'
import pageTemplate from './templates/page-template.json'
import { includeElements } from './web-includes-manager'
import { basename } from './utils'
import { WikiAuthProvider, WikiSession } from './wiki-auth'
import { NetworkError } from './errors'
import { loadMeta } from './files-meta'

export class FTMLPreviewPanel {
    public static readonly viewType = 'ftml-editor.webview.preview'
    public static readonly updateDelay = 2500

    public isDisposed: boolean = false

    public readonly isLive: boolean
    public readonly panel: vscode.WebviewPanel

    private readonly _document: vscode.TextDocument
    private readonly _pageId: string
    private readonly _context: vscode.ExtensionContext
    private readonly _session: WikiSession

    private _authProvider: WikiAuthProvider
    private _statusBarItem: vscode.StatusBarItem
    private _updateTimer: NodeJS.Timeout
    private _disposables: vscode.Disposable[] = []
    private _headContent: string
    private _webStaticUri: vscode.Uri

    public static async startPeview(session: WikiSession, authProvider: WikiAuthProvider, document: vscode.TextDocument, pageId: string, isLive: boolean, context: vscode.ExtensionContext) {
        const docname = basename(document.fileName)
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
                    vscode.Uri.joinPath(context.extensionUri, 'web-static')
                ]
            }
        )
        return new FTMLPreviewPanel(panel, session, authProvider, document, pageId, context, true, isLive)
    }

    public constructor(panel: vscode.WebviewPanel, session: WikiSession, authProvider: WikiAuthProvider, document: vscode.TextDocument, pageId: string, context: vscode.ExtensionContext, reloadDocument: boolean=true, isLive: boolean=false) {
        this.panel = panel
        this._document = document
        this._authProvider = authProvider
        this._pageId = pageId
        this._context = context
        this._session = session
        this.isLive = isLive
        this._updateTimer = setTimeout(() => {})
        const webview = this.panel.webview
        this._statusBarItem = this._createStatusbarItem()
        this._headContent = ''
        this._webStaticUri = vscode.Uri.joinPath(context.extensionUri, 'web-static')

        if (!this.isLive)
            this._statusBarItem.show()

        this.panel.onDidDispose(() => this.dispose(), null, this._disposables)
        this.panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible) {
                    this._statusBarItem.show()
                } else {
                    this._statusBarItem.hide()
                }
            },
            null,
            this._disposables
        )

        webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text)
                        return
                }
            },
            null,
            this._disposables
        )

        let textChangeListener = vscode.workspace.onDidChangeTextDocument(
            e => {
                if (e.document == this._document) {
                    this._onDocumetChanged(e)
                }
            },
            null,
            this._disposables
        )

        this._context.subscriptions.push(textChangeListener)

        this._authProvider.authorizedFetch(session, '/')
        .then(async response => {
            const html = await response.text()
            const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)

            if (match)
                this._headContent = match[1]
            
            if (reloadDocument)
                this.reloadDocument()
        })
        .catch(e => {
            throw new NetworkError()
        })
    }

    private _createStatusbarItem() {
        let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
        statusBarItem.text = '$(refresh) Обновить предпросмотр'
        statusBarItem.command = 'ftml-editor.preview.refresh'
        this._context.subscriptions.push(this._statusBarItem)
        return statusBarItem
    }

    public dispose() {
        this.isDisposed = true
        this.panel.dispose()
        this._statusBarItem.dispose()

        while (this._disposables.length) {
            const x = this._disposables.pop()
            if (x) {
                x.dispose()
            }
        }
    }

    public async update() {
        const document = this._document
        try {
            const docText = document.getText()
            if (!docText) return

            const preview = await this._authProvider.previewPage(this._session, this._pageId, docText, 'preview')
            const meta = await loadMeta(document.uri)

            preview.content = preview.content
            .replaceAll('src="//', 'src="https://')
            .replaceAll('src="/', `src="${this._session.wikibase}/`)

            this.updateDocument(preview.content, meta.title)
        } catch (error) {
            if (error instanceof Error)
                vscode.window.showErrorMessage(error.toString())
        }
    }

    private _onDocumetChanged(e: vscode.TextDocumentChangeEvent) {
        if (!this.isLive) return
            clearTimeout(this._updateTimer)

        if (this._document.getText() && e.contentChanges.length)
            this._updateTimer = setTimeout(() => {this.update()}, FTMLPreviewPanel.updateDelay)
    }

    public updateDocument(html: string, title?: string) {
        const webview = this.panel.webview

        webview.postMessage({ 
            cmd: 'update-content',
            content: html 
        })

        if (title) {
            webview.postMessage({ 
                cmd: 'update-title',
                content: title 
            })
        }
    }

    public reloadDocument() {
        const webview = this.panel.webview
        let {styles, scripts} = includeElements(webview, this._context.extensionUri)
        let html = pageTemplate.value

        const initScript = `
            <script>
                const vscode = acquireVsCodeApi()

                let state = vscode.getState() || {
                    fileName: ${JSON.stringify(this._document.fileName)},
                    pageId: ${JSON.stringify(this._pageId)},
                    isLive: ${JSON.stringify(this.isLive)},
                    sessionId: ${JSON.stringify(this._session.id)},
                    baseUrl: ${JSON.stringify(webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'web-static/')).toString())},
                    html: document.documentElement.outerHTML,
                    title: '',
                }

                vscode.setState(state)

                document.addEventListener('DOMContentLoaded', (event) => {
                    const previewTitle = document.getElementById('page-title')
                    const previewContent = document.getElementById('page-content')
    
                    window.addEventListener('message', e => {
                        const content = e.data.content
                        switch (e.data.cmd) {
                            case 'update-content':
                                previewContent.innerHTML = content
                                state.html = document.documentElement.outerHTML
                                vscode.setState(state)
                                break
                            case 'update-title':
                                previewTitle.innerHTML = content
                                state.title = content
                                vscode.setState(state)
                                break
                        }
                    })
                })
            </script>
        `
        
        html = 
        html.replace('%%FIRST_HAVE_PIECE%%', `
            ${initScript}
            ${styles.join('\n')}
            ${scripts.join('\n')}
        `)

        html = html.replaceAll('src="//', 'src="https://')
        html = html.replaceAll('src="/', `src="${this._session.wikibase}/`)

        webview.html = html
        this.update()
    }

    public collectPrefetchable() {
        const webview = this.panel.webview
        const prefetchable = webview.html.matchAll(RegExp('url\(\s*[\'|\"](.*)[\'|\"]\s*\)'))
        return prefetchable
    }
}

export let PreviewPanelsList: FTMLPreviewPanel[] = []