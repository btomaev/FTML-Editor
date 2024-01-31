export type FetchResponse = {
    title: string,
    content: string,
};

export type SerializedArticle = {
    pageId: string,
    title: string,
    source: string,
    tags: string[],
    parent: string,
    locked: boolean,
}

export function basename(docpath: string) {
    docpath = docpath.replaceAll("\\", "/");
    const match = docpath.match(/\/?([^\/]*)$/);
    const docname = match![1];

    return docname;
}