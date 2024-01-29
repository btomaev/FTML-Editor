import * as yaml from "js-yaml";

type Block = {
    begin: string;
    end: string;
    children: Block[];
}

type BlockData = {
    start: RegExp;
    end: RegExp;
    body: string;
    isMap: boolean;
    tag: number;
    args: number | null;
}

export class BlocksInterpretter {
    private readonly _blockslist: BlockData[];
    private readonly _document: string;
    private _pointer: number;

    public constructor(blockslist: any, document: string, pointer: number=0) {
        this._blockslist = blockslist;
        this._document = document;
        this._pointer = pointer;
    }

    public buildBlockTree(pointer: number) {
        let document = this._document.substring(pointer)

        let targetBlock: BlockData;


        this._blockslist.forEach(element => {
            let rex = document.matchAll(element.start);

            console.log(rex);
        });
        
    }
}