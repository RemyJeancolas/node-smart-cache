import { EventEmitter } from 'events';
import { MemoryCache } from './engines/MemoryCache';

export interface SmartCacheParams {
    keyHandler: string|((...args: any[]) => string);
    ttl?: number|false|((...args: any[]) => number|false);
    keyPrefix?: string;
    saveEmptyValues?: boolean;
    staleWhileRevalidate?: number|false;
}

export interface SmartCacheEngine {
    get: (key: string) => Promise<any>; // tslint:disable-line:no-reserved-keywords
    set: (key: string, value: any, ttl?: number) => Promise<void>; // tslint:disable-line:no-reserved-keywords
}

const generatingProcesses: any = Symbol('generatingProcesses');

interface GeneratingProcess {
    [key: string]: boolean;
}

export class SmartCache {
    private enabled: boolean = true;
    private cacheEngine: SmartCacheEngine = null;
    private ttl: number = 60;
    private saveEmptyValues: boolean = false;
    private waitForCacheSet: boolean = true;
    private staleWhileRevalidate: number = 0;
    private emitter: EventEmitter = null;

    private static instance: SmartCache = null;

    private constructor(cacheEngine: SmartCacheEngine) {
        this.cacheEngine = cacheEngine;
        this.emitter = new EventEmitter();
    }

    private static getInstance(): SmartCache {
        if (!SmartCache.instance) {
            SmartCache.instance = new SmartCache(new MemoryCache());
        }
        return SmartCache.instance;
    }

    public static enable(enable: boolean): void {
        SmartCache.getInstance().enabled = enable;
    }

    public static getCacheEngine(): SmartCacheEngine {
        return SmartCache.getInstance().cacheEngine;
    }

    public static setCacheEngine(cacheEngine: SmartCacheEngine): void {
        SmartCache.getInstance().cacheEngine = cacheEngine;
    }

    public static setTtl(ttl: number): void {
        SmartCache.getInstance().ttl = ttl;
    }

    public static setSaveEmptyValues(saveEmptyValues: boolean): void {
        SmartCache.getInstance().saveEmptyValues = saveEmptyValues;
    }

    public static setWaitForCacheSet(wait: boolean): void {
        SmartCache.getInstance().waitForCacheSet = wait;
    }

    public static setStaleWhileRevalidate(duration: number|false): void {
        SmartCache.getInstance().staleWhileRevalidate = typeof duration === 'number' && duration >= 0 ? duration : 0;
    }

    public static cache(params: SmartCacheParams): any {
        return (target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<any>): any => {
            const originalMethod = descriptor.value;
            const smartCache = SmartCache.getInstance();

            // Check key generation method
            if (typeof(params.keyHandler) === 'string') {
                if (!target.hasOwnProperty(params.keyHandler) || typeof(target[params.keyHandler]) !== 'function') {
                    throw new Error(`Function ${params.keyHandler} doesn't exist on class ${target.constructor.name}`);
                }
            } else if (typeof(params.keyHandler) !== 'function') {
                throw new Error('keyHandler param type must be string or function');
            }

            // Create global 'generating' var for current class
            if (!target.hasOwnProperty(generatingProcesses)) {
                target[generatingProcesses] = {};
            }

            // Create sub object in order to handle current method (identified by 'propertyKey' param)
            target[generatingProcesses][propertyKey] = <GeneratingProcess> {};

            descriptor.value = async function (...args: any[]): Promise<any> {
                // If cache is disabled, just call the original method
                if (smartCache.enabled !== true) {
                    return originalMethod.apply(this, args);
                }

                const keyHandler = typeof(params.keyHandler) === 'string' ? target[params.keyHandler] : params.keyHandler;
                const cacheKey: string = keyHandler(...args);
                if (typeof cacheKey !== 'string' || cacheKey.trim() === '') {
                    throw new Error('Invalid cache key received from keyHandler function');
                }

                // If we reach this part, key is valid

                // Get stale duration
                const staleTtl = typeof params.staleWhileRevalidate === 'number' && params.staleWhileRevalidate >= 0
                    ? params.staleWhileRevalidate
                    : (params.staleWhileRevalidate === false ? 0 : smartCache.staleWhileRevalidate);

                // Compute key prefix
                const keyPrefix = (typeof(params.keyPrefix) === 'string' && params.keyPrefix.trim() !== '')
                    ? params.keyPrefix : `${target.constructor.name}:${propertyKey}`;

                const fullCacheKey = `${keyPrefix}:${cacheKey}`;
                const cachedValue = await smartCache.cacheEngine.get(fullCacheKey);
                const self = this;
                if (cachedValue && cachedValue.hasOwnProperty('v')) {
                    // Check if data is stale
                    if (cachedValue.hasOwnProperty('e') && cachedValue.e < Date.now()) {
                        // Data is stale, check if we want to return stale data
                        if (staleTtl > 0) {
                            // Start regenerating new value
                            SmartCache.generateAndStoreValue(
                                self, originalMethod, args, params, smartCache, fullCacheKey, target, propertyKey, cacheKey, staleTtl
                            );

                            // Return stale value from cache
                            return cachedValue.v;
                        }
                    } else {
                        // Return value from cache
                        return cachedValue.v;
                    }
                }

                // If we reach this part, value doesn't exist in cache or is stale and we don't want it
                return SmartCache.generateAndStoreValue(
                    self, originalMethod, args, params, smartCache, fullCacheKey, target, propertyKey, cacheKey, staleTtl
                );
            };
        };
    }

    private static async generateAndStoreValue(
        self: any, originalMethod: any, args: any[], params: SmartCacheParams, smartCache: SmartCache, fullCacheKey: string, target: any,
        propertyKey: string, cacheKey: string, staleTtl: number
    ): Promise<any> {
        // If value is not generating, generate it
        if (target[generatingProcesses][propertyKey][cacheKey] !== true) {
            target[generatingProcesses][propertyKey][cacheKey] = true;
            try {
                const generatedValue = await originalMethod.apply(self, args);

                // Check if we need to save the generated value in cache
                const saveEmptyValues =
                    typeof params.saveEmptyValues === 'boolean' ? params.saveEmptyValues : smartCache.saveEmptyValues;

                if (generatedValue != null || saveEmptyValues) {
                    // Compute cache TTL
                    let ttl = smartCache.ttl;
                    if (typeof params.ttl === 'number') {
                        ttl = params.ttl;
                    } else if (params.ttl === false) {
                        ttl = undefined;
                    } else if (typeof params.ttl === 'function') {
                        args.push(generatedValue);
                        const dynamicTtl = params.ttl(...args);
                        if (typeof dynamicTtl !== 'number' && dynamicTtl !== false) {
                            throw new Error('Invalid ttl received from ttl function');
                        }
                        ttl = dynamicTtl === false ? undefined : dynamicTtl;
                    }

                    // Store data in cache
                    if (smartCache.waitForCacheSet) {
                        await SmartCache.storeDataInCache(smartCache.cacheEngine, fullCacheKey, generatedValue, ttl, staleTtl);
                    } else {
                        SmartCache.storeDataInCache(smartCache.cacheEngine, fullCacheKey, generatedValue, ttl, staleTtl);
                    }
                }

                // Send value to all listeners
                smartCache.emitter.emit(fullCacheKey, null, generatedValue);

                return generatedValue;
            } catch (err) {
                smartCache.emitter.emit(fullCacheKey, err);
                throw err;
            } finally {
                target[generatingProcesses][propertyKey][cacheKey] = false;
            }
        } else { // Else wait for value generation
            return new Promise<any>((resolve) => {
                smartCache.emitter.once(fullCacheKey, (err: Error, value: any) => {
                    // If there has been an error during value generation, just get it directly from initial code
                    if (err) {
                        return resolve(originalMethod.apply(self, args));
                    }
                    // Else return it
                    return resolve(value);
                });
            });
        }
    }

    private static async storeDataInCache(
        engine: SmartCacheEngine, key: string, value: any, ttl: number, staleTtl: number
    ): Promise<void> {
        if (ttl === undefined) {
            await engine.set(key, { v: value });
        } else if (ttl > 0) {
            await engine.set(key, Object.assign({ v: value }, staleTtl > 0 ? { e: Date.now() + ttl * 1000 } : {}), ttl + staleTtl);
        }
    }
}
