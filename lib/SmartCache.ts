import {EventEmitter} from 'events';
import {MemoryCache} from './MemoryCache';
import {Ipc} from './ipc/Ipc';

export interface SmartCacheParams {
    keyHandler: string|((...args: any[]) => string);
    ttl?: number|false|((...args: any[]) => number|false);
    keyPrefix?: string;
    saveEmptyValues?: boolean;
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
    private cacheEngine: SmartCacheEngine = null;
    private ttl: number = 60;
    private saveEmptyValues: boolean = false;
    private emitter: EventEmitter = null;
    private ipc: Ipc = null;

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

    public static setIpc(ipc: Ipc): void {
        const smartcache = SmartCache.getInstance();
        ipc.onEvent((key, value) => {
            smartcache.emitter.emit(key, null, value);
        });
        smartcache.ipc = ipc;
    }

    // tslint:disable-next-line:max-func-body-length
    public static cache(params: SmartCacheParams): any {
        // tslint:disable-next-line:max-func-body-length
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
                const keyHandler = typeof(params.keyHandler) === 'string' ? target[params.keyHandler] : params.keyHandler;
                const cacheKey: string = keyHandler(...args);
                if (typeof cacheKey !== 'string' || cacheKey.trim() === '') {
                    throw new Error('Invalid cache key received from keyHandler function');
                }

                // If we reach this part, key is valid

                // Compute key prefix
                const keyPrefix = (typeof(params.keyPrefix) === 'string' && params.keyPrefix.trim() !== '')
                    ? params.keyPrefix : `${target.constructor.name}:${propertyKey}`;

                const fullCacheKey = `${keyPrefix}:${cacheKey}`;
                const cachedValue = await smartCache.cacheEngine.get(fullCacheKey);
                if (cachedValue && cachedValue.hasOwnProperty('v')) { // If value exists in cache, just return it
                    return cachedValue.v;
                }

                // If we reach this part, value doesn't exist in cache
                let externalGenerating: boolean = false;
                if (smartCache.ipc) {
                    externalGenerating = !await smartCache.ipc.lock(fullCacheKey);
                }

                if (!externalGenerating && target[generatingProcesses][propertyKey][cacheKey] !== true) {
                    target[generatingProcesses][propertyKey][cacheKey] = true;

                    // If value is not generating, generate it
                    try {
                        const generatedValue = await originalMethod.apply(this, args);

                        // Check if we need to save the generated value in cache
                        const saveEmptyValues =
                            typeof(params.saveEmptyValues) === 'boolean' ? params.saveEmptyValues : smartCache.saveEmptyValues;

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

                            await smartCache.cacheEngine.set(fullCacheKey, { v: generatedValue }, ttl);
                        }

                        // Send value to all local listeners
                        smartCache.emitter.emit(fullCacheKey, null, generatedValue);

                        // Send value to all remote listeners
                        if (smartCache.ipc) {
                            smartCache.ipc.emit(fullCacheKey, generatedValue);
                        }

                        return generatedValue;
                    } catch (err) {
                        smartCache.emitter.emit(fullCacheKey, err);
                        throw err;
                    } finally {
                        target[generatingProcesses][propertyKey][cacheKey] = false;

                        if (smartCache.ipc) {
                            smartCache.ipc.unlock(fullCacheKey);
                        }
                    }
                } else { // Else wait for value generation
                    return new Promise<any>((resolve) => {
                        smartCache.emitter.once(fullCacheKey, (err: Error, value: any) => {
                            // If there has been an error during value generation, just get it directly from initial code
                            if (err) {
                                return resolve(originalMethod.apply(this, args));
                            }
                            // Else return it
                            return resolve(value);
                        });
                    });
                }
            };
        };
    }
}
