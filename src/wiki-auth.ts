import * as vscode from 'vscode';
import {authentication, AuthenticationProvider, AuthenticationProviderAuthenticationSessionsChangeEvent, AuthenticationSession, Disposable, EventEmitter, ExtensionContext } from "vscode";
import { SerializedArticle } from './utils';
import { loadMeta } from './files-meta';
import { md5 } from 'js-md5';

export const AUTH_TYPE = `ruscpwiki`;
export const AUTH_NAME = `RuSCP WiKi`;

export interface WikiSession extends AuthenticationSession {
    cookies: string[]
}

export class WikiAuthProvider implements AuthenticationProvider, Disposable {
    private _sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
    private _sessions = new Map<string, WikiSession>();
    private _disposable: Disposable;

    private readonly contentWatermark = '[!-- Эта статья создана с помощью FTML Editor - удобного и функционального расширения для vscode --]';
    private readonly commentPostfix = '(Опубликовано из расширения FTML Editor)';
  
    constructor(private readonly context: ExtensionContext) {
        this._disposable = Disposable.from(
            authentication.registerAuthenticationProvider(AUTH_TYPE, AUTH_NAME, this, { supportsMultipleAccounts: false })
        )
        this.restoreSessions();
    }

    public async dispose() {
        this._disposable.dispose();
    }

    get onDidChangeSessions() {
        return this._sessionChangeEmitter.event;
    }

    public async getSessions(scopes?: string[]): Promise<readonly AuthenticationSession[]> {
        if (!scopes?.length) {
            return [...this._sessions.values()];
        } else return [this._sessions.get(scopes[0])!];
    }

    public async createSession(scope?: readonly string[]): Promise<WikiSession> {
        const authCancel = 'Авторизация отменена.';
        const authError = 'Ошибка авторизации.';
        const netError = 'Ошибка сети.';
        const csrf = await this.getCSRFMiddlewareToken();

        if (!csrf || !csrf.middlewaretoken || !csrf.cookies) throw authError;
        
        const username = await vscode.window.showInputBox({
            title: 'Введите имя пользователя scpfoundation.net',
            placeHolder: "Osobist",
            prompt: 'Почта не является именем пользователя',
            ignoreFocusOut: true
        });

        if (!username) throw authCancel;
    
        const password = await vscode.window.showInputBox({
            password: true,
            title: 'Введите пароль',
            placeHolder: "******",
            prompt: 'FTMLEditor не хранит ваши учетные данные',
            ignoreFocusOut: true
        });

        if (!password) throw authCancel;

        const cookies = await this.loginAndGetCookies(username, password, csrf.middlewaretoken, csrf.cookies);

        if (!cookies) throw netError;

        const session: WikiSession = {
            scopes: [],
            id: username,
            cookies: cookies,
            account: {
                label: username,
                id: username,
            },
            accessToken: ''
        };

        this._sessions.set(username, session);
        await this.storeSessions();
        this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

        return session;
    }

    public async removeSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);

        if (session) {
            this.logout(session.cookies);
            this._sessions.delete(session.id);
            await this.storeSessions();
            this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
        } else {
            throw 'Вход в аккаунт не выполнен.'
        }
    }

    async storeSessions(): Promise<void> {
        let sessionArray = [...this._sessions.values()];
        return await this.context.secrets.store(`${AUTH_TYPE}.auth`, JSON.stringify(sessionArray));
    }

    async restoreSessions(): Promise<void> {
        let stored = await this.context.secrets.get(`${AUTH_TYPE}.auth`) ?? '[]';
        let sessions: WikiSession[] = JSON.parse(stored);
        for (let i = 0; i < sessions.length; i++) {
            this._sessions.set(sessions[i].id, sessions[i]);
        }
    }

    public async publishArticle(session: WikiSession, pageId: string, title: string, content: string, comment?: string) {
        // if (content.indexOf(this.contentWatermark) < 0)
        // content = `${this.contentWatermark}\n\n${content}`;

        const data = {
            pageId: pageId,
            title: title,
            source: content.trim(),
            comment: comment ? `${comment}\n\n${this.commentPostfix}` : this.commentPostfix
        }

        const response = await fetch(`https://scpfoundation.net/api/articles/${pageId}`, {
            method: 'PUT',
            headers: { 
                Referer: `https://scpfoundation.net/api/articles/${pageId}`,
                Cookie: session.cookies.join(';')
            },
            body: JSON.stringify(data)
        })
        .catch(e => {
            throw 'Ошибка сети.';
        });

        switch (response.status) {
            case 200:
                return {
                    pageId: data.pageId,
                    title: data.title,
                    source: data.source
                } as SerializedArticle;
            case 403:
                throw 'Недостаточно прав.';
            case 404:
                throw 'Страницы не существует.';
            default:
                throw 'Ошибка публикации.';
        }
    }

    public async fetchArticle(session: WikiSession, pageId: string) {
        const response = await fetch(`https://scpfoundation.net/api/articles/${pageId}`, {
            method: 'GET',
        })
        .catch(e => {
            throw 'Ошибка сети.';
        });

        if (!response) throw 'Ошибка получения данных страницы.';

        switch (response.status) {
            case 200:
                let article = (await response.json()) as SerializedArticle;
                article.source = article.source.trim()
                return article;
            case 403:
                throw 'Недостаточно прав.';
            case 404:
                throw 'Страницы не существует.';
            default:
                throw 'Ошибка загрузки.';
        }
    }

    public async isGreenLight(document: vscode.TextDocument, article: SerializedArticle) {
        const meta = await loadMeta(document.uri);
        return meta.hash != md5(article.source)
    }

    private async getCSRFMiddlewareToken() {
        const response = await fetch('https://scpfoundation.net/-/login', {
            method: 'GET'
        })
        .then(result => result)
        .catch(e => {
            throw 'Ошибка сети.';
        });

        if (!response) return null;
  
        let result = (await response.text());
    
        const re = /<input type="hidden" name="csrfmiddlewaretoken" value="([^"]*)">/;
        const token = result.match(re);
        return {
            middlewaretoken: token ? token[1] : null,
            cookies: response.headers.getSetCookie()
        };
    }
  
    private async loginAndGetCookies(username: string, password: string, csrfmiddlewaretoken: string, cookies: string[]) {
        let form = new FormData(); 
        form.set('username', username);
        form.set('password', password);
        form.set('csrfmiddlewaretoken', csrfmiddlewaretoken);

        const response = await fetch('https://scpfoundation.net/-/login', {
            method: 'POST',
            redirect: 'manual',
            headers: { 
                Referer: 'https://scpfoundation.net/-/login',
                Cookie: cookies.join(";")
            },
            body: form
        })
        .then(result => result)
        .catch(e => {
            throw 'Ошибка сети..';
        });

        if (!response) return null;

        if (response.status != 302) throw 'Неверные учетные данные.'

        return response.headers.getSetCookie();
    }

    private async logout(cookies: string[]) {
        await fetch('https://scpfoundation.net/-/logout', {
            method: 'POST',
            redirect: 'manual',
            headers: { 
                Referer: 'https://scpfoundation.net/',
                Cookie: cookies.join(";")
            },
        })
        .catch(e => {
            throw 'Ошибка сети..';
        });
    }
}