export interface SmartCacheParams {
    keyHandler: string|((...args: any[]) => string);
    ttl?: number|false|((...args: any[]) => number|false);
    keyPrefix?: string;
    saveEmptyValues?: boolean;
}

export interface SmartCacheEngine {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any, ttl?: number) => Promise<void>;
}

export class SmartCache {
    public static enable(enable: boolean): void;
    public static getCacheEngine(): SmartCacheEngine;
    public static setCacheEngine(cacheEngine: SmartCacheEngine): void;
    public static setTtl(ttl: number): void;
    public static setSaveEmptyValues(saveEmptyValues: boolean): void;
    public static setWaitForCacheSet(wait: boolean): void;
    public static cache(params: SmartCacheParams): any;
}

export class MemoryCache implements SmartCacheEngine {
    constructor(gcInterval?: number);
    public get(key: string): Promise<any>;
    public set(key: string, value: any, ttl?: number): Promise<void>;
    public del(key: string): Promise<void>;
}

export class FileCache implements SmartCacheEngine {
    constructor(filePath: string, gcInterval?: number);
    public get(key: string): Promise<any>;
    public set(key: string, value: any, ttl?: number): Promise<void>;
    public del(key: string): Promise<void>;
}
