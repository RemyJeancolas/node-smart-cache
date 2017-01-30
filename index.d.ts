export interface SmartCacheParams {
    ttl?: number;
    keyHandler: string;
}

export interface SmartCacheEngine {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any, ttl: number) => Promise<void>;
}

export class SmartCache {
    public static setCacheEngine(cacheEngine: SmartCacheEngine): void;
    public static setTtl(ttl: number): void;
    public static cache(params: SmartCacheParams): any;
}

export class MemoryCache {
    public get(key: string): Promise<any>;
    public set(key: string, value: any, ttl: number): Promise<void>;
}
