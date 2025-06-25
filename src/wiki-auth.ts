import * as vscode from 'vscode'
import { 
    authentication, 
    AuthenticationProvider, 
    AuthenticationProviderAuthenticationSessionsChangeEvent, 
    AuthenticationSession, Disposable, EventEmitter, ExtensionContext } from 'vscode'
import { FetchResponse, SerializedArticle } from './utils'
import { loadMeta } from './files-meta'
import { md5 } from 'js-md5'
import * as err from './errors'

export const AUTH_TYPE = `ftmleditor`
export const AUTH_NAME = `FTML Editor`

export interface AuthorizedRequestInit extends RequestInit{
    json?: any
}

export interface WikiSession extends AuthenticationSession {
    cookies: string[]
    wikibase: string
}

function NetworkError(e: any) {
    if (e instanceof TypeError)
        return new err.NetworkError()
    else 
        return e
}

export class WikiAuthProvider implements AuthenticationProvider, Disposable {
    private _sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>()
    private _sessions = new Map<string, WikiSession>()
    private _disposable: Disposable
    private _wikibase: string

    private readonly contentWatermark = '[!-- Эта страница создана с помощью FTML Editor - удобного и функционального расширения для vscode --]'
    private readonly commentPostfix = '(Опубликовано из расширения FTML Editor)'
  
    constructor(private readonly context: ExtensionContext, wikibase: string) {
        this._wikibase = wikibase
        this._disposable = Disposable.from(
            authentication.registerAuthenticationProvider(AUTH_TYPE, AUTH_NAME, this, { supportsMultipleAccounts: true })
        )
        this.restoreSessions()
    }

    public async dispose() {
        this._disposable.dispose()
    }

    get onDidChangeSessions() {
        return this._sessionChangeEmitter.event
    }

    public async getSessions(scopes?: string[]): Promise<readonly AuthenticationSession[]> {
        await this.restoreSessions()
        if (!scopes?.length) {
            return [...this._sessions.values()]
        } else {
            return [this._sessions.get(scopes[0])!]
        }
    }

    private getCookie(session: WikiSession, name: string){
        let cookieValue = null

        const cookies = session.cookies.join(';').split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
        return cookieValue
    }

    public async createSession(scopes?: readonly string[]): Promise<WikiSession> {
        const authCancel = new err.ActionCanceledError('Авторизация отменена')
        
        const username = await vscode.window.showInputBox({
            title: 'Введите имя пользователя scpfoundation.net',
            placeHolder: "Osobist",
            prompt: 'Почта не является именем пользователя',
            ignoreFocusOut: true
        })

        if (!username) throw authCancel
    
        const password = await vscode.window.showInputBox({
            password: true,
            title: 'Введите пароль',
            placeHolder: '******',
            prompt: 'FTMLEditor не хранит ваши учетные данные',
            ignoreFocusOut: true
        })

        if (!password) throw authCancel

        const session = await this.login(username, password)

        this._sessions.set(username, session)
        await this.storeSessions()
        this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] })

        return session
    }

    public async removeSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId)

        if (session) {
            this.logout(session)
            this._sessions.delete(session.id)
            await this.storeSessions()
            this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] })
        } else {
            throw 'Вход в аккаунт не выполнен'
        }
    }

    async storeSessions(): Promise<void> {
        let sessionArray = [...this._sessions.values()]
        return await this.context.secrets.store(`${AUTH_TYPE}.auth`, JSON.stringify(sessionArray))
    }

    async restoreSessions(): Promise<void> {
        let stored = await this.context.secrets.get(`${AUTH_TYPE}.auth`) ?? '[]';
        let sessions: WikiSession[] = JSON.parse(stored)

        for (let i = 0; i < sessions.length; i++) {
            this._sessions.set(sessions[i].id, sessions[i])
        }
    }

    public authorizedFetch(session: WikiSession, url: string, init?: AuthorizedRequestInit) {
        const csrf = this.getCookie(session, 'csrftoken')

        return fetch(new URL(url, session.wikibase), {
            ...init,
            method: init?.method || 'GET',
            headers: { 
                Referer: session.wikibase,
                Cookie: session.cookies.join(';'),
                'X-CSRFToken': csrf!
            },
            body: init?.json === undefined ? init?.body : JSON.stringify(init?.json)
        });
    }

    public async publishArticle(session: WikiSession, pageId: string, title: string, content: string, comment?: string) {
        // if (content.indexOf(this.contentWatermark) < 0)
        // content = `${this.contentWatermark}\n\n${content}`

        const data = {
            pageId: pageId,
            title: title,
            source: content.trim(),
            comment: comment ? `${comment}\n\n${this.commentPostfix}` : this.commentPostfix
        }

        try {
            const response = await this.authorizedFetch(session, `/api/articles/${pageId}`, {
                method: 'PUT',
                json: data
            })

            switch (response.status) {
                case 200:
                    return {
                        pageId: data.pageId,
                        title: data.title,
                        source: data.source
                    } as SerializedArticle
                case 403:
                    throw new err.AccessDeniedError()
                case 404:
                    throw new err.PageDoesNotExistError()
                default:
                    throw new err.PagePublishingError()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }

    public async fetchArticle(session: WikiSession, pageId: string) {
        try {
            const response = await this.authorizedFetch(session, `/api/articles/${pageId}`, {
                method: 'GET',
            })

            switch (response.status) {
                case 200:
                    let article = (await response.json()) as SerializedArticle
                    article.source = article.source.trim()
                    return article
                case 403:
                    throw new err.AccessDeniedError()
                case 404:
                    throw new err.PageDoesNotExistError()
                default:
                    throw new err.PageLoadingError()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }

    public async createNewPage(session: WikiSession, pageId: string, title: string, source: string, comment?: string) {
        let data = {
            pageId,
            title,
            source,
            comment: comment ? `${comment}\n\n${this.commentPostfix}` : `Создана новая страница ${this.commentPostfix}`
        }

        try {
            const response = await this.authorizedFetch(session, `/api/articles/new`, {
                method: 'POST',
                redirect: 'manual',
                json: data
            })

            switch (response.status) {
                case 201:
                    return {
                        pageId: data.pageId,
                        title: data.title,
                        source: data.source
                    } as SerializedArticle
                case 403:
                    throw new err.AccessDeniedError()
                case 409:
                    throw new err.PageAlreadyExistError()
                default:
                    throw new err.PageLoadingError()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }

    public async previewPage(session: WikiSession, pageId: string, source: string, title: string, pathParams?: any) {
        let data = {
            pageId,
            title,
            source
        }

        try {
            const response = await this.authorizedFetch(session, `/api/preview`, {
                method: 'POST',
                json: data
            })

            switch (response.status) {
                case 200:
                    return await response.json() as FetchResponse
                case 403:
                    throw new err.AccessDeniedError()
                case 409:
                    throw new err.PageAlreadyExistError()
                default:
                    throw new err.PageLoadingError()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }

    public async isGreenLight(document: vscode.TextDocument, article: SerializedArticle) {
        const meta = await loadMeta(document.uri);
        return meta.hash !== md5(article.source)
    }

    private async getCSRFMiddleware() {
        try {
            const response = await fetch(new URL('/-/login', this._wikibase), {
                method: 'GET'
            })
    
            const re = /<input type="hidden" name="csrfmiddlewaretoken" value="([^"]*)">/;
            const token = (await response.text()).match(re);
            return {
                token: token ? token[1] : null,
                cookies: response.headers.getSetCookie()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }
  
    private async login(username: string, password: string) {
        const middleware = await this.getCSRFMiddleware()
  
        let form = new FormData()
        form.set('username', username)
        form.set('password', password)
        form.set('csrfmiddlewaretoken', middleware.token)

        try {
            const response = await fetch(new URL('/-/login', this._wikibase), {
                method: 'POST',
                redirect: 'manual',
                headers: { 
                    Referer: this._wikibase,
                    Cookie: middleware.cookies.join(';')
                },
                body: form
            })

            switch (response.status) {
                case 302:
                    return {
                        scopes: [],
                        id: username,
                        wikibase: this._wikibase,
                        cookies: response.headers.getSetCookie(),
                        account: {
                            label: username,
                            id: username,
                        },
                        accessToken: ''
                    } as WikiSession
                default:
                    throw new err.WrongCreditialsError()
            }
        } catch (e) {
            throw NetworkError(e)
        }
    }

    private async logout(session: WikiSession) {
        try {
            await this.authorizedFetch(session, '/-/logout', {
                method: 'POST',
            })
        } catch (e) {
            throw NetworkError(e)
        }
    }
}