import {EventEmitter} from 'events';
import {MemoryCache} from './MemoryCache';

export interface SmartCacheParams {
    ttl?: number|false;
    keyHandler: string|((...args: any[]) => string);
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
    private ttl: number = null;
    private emitter: EventEmitter = null;

    private static defaultTtl: number = 60;
    private static instance: SmartCache = null;

    private constructor(cacheEngine: SmartCacheEngine, ttl: number) {
        this.cacheEngine = cacheEngine;
        this.ttl = ttl;
        this.emitter = new EventEmitter();
    }

    private static getInstance(): SmartCache {
        if (!SmartCache.instance) {
            SmartCache.instance = new SmartCache(new MemoryCache(), SmartCache.defaultTtl);
        }
        return SmartCache.instance;
    }

    public static setCacheEngine(cacheEngine: SmartCacheEngine): void {
        SmartCache.getInstance().cacheEngine = cacheEngine;
    }

    public static setTtl(ttl: number): void {
        SmartCache.getInstance().ttl = ttl;
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
                const keyHandler = typeof(params.keyHandler) === 'string' ? target[params.keyHandler] : params.keyHandler;
                const cacheKey: string = keyHandler(...args);
                if (typeof cacheKey !== 'string' || cacheKey.trim() === '') {
                    throw new Error('Invalid cache key received from keyComputation function');
                }

                // If we reach this part, key is valid
                const fullCacheKey = `${target.constructor.name}:${propertyKey}:${cacheKey}`;
                const cachedValue = await smartCache.cacheEngine.get(fullCacheKey);
                if (cachedValue) { // If value exists in cache, just return it
                    return cachedValue;
                }

                // If we reach this part, value doesn't exist in cache
                if (target[generatingProcesses][propertyKey][cacheKey] !== true) {
                    target[generatingProcesses][propertyKey][cacheKey] = true;

                    // If value is not generating, generate it
                    try {
                        const generatedValue = await originalMethod.apply(this, args);
                        if (params.ttl === false) {
                            await smartCache.cacheEngine.set(fullCacheKey, generatedValue);
                        } else {
                            const ttl = typeof params.ttl === 'number' ? params.ttl : smartCache.ttl;
                            await smartCache.cacheEngine.set(fullCacheKey, generatedValue, ttl);
                        }
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
