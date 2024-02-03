export class PageDoesNotExistError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Страницы не существует');
        this.name = "PageDoesNotExistError";
    }
}

export class PageLoadingError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Ошибка загрузки страницы');
        this.name = "PageLoadingError";
    }
}

export class PageCreationError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Ошибка создания страницы');
        this.name = "PageCreationError";
    }
}

export class PagePublishingError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Ошибка публикации');
        this.name = "PagePublishingError";
    }
}

export class AccessDeniedError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Недостаточно прав');
        this.name = "AccessDeniedError";
    }
}

export class NetworkError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Ошибка сети');
        this.name = "NetworkError";
    }
}

export class WrongCreditialsError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Неверные учетные данные');
        this.name = "WrongCreditialsError";
    }
}

export class AuthorizationError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Ошибка авторизации');
        this.name = "AuthorizationError";
    }
}

export class ActionCanceledError extends Error {
    constructor(message?: string) {
        super(message ? message : 'Действие отменено');
        this.name = "ActionCanceledError";
    }
}