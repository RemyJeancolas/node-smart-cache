"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const MemoryCache_1 = require("./engines/MemoryCache");
const generatingProcesses = Symbol('generatingProcesses');
class SmartCache {
    constructor(cacheEngine) {
        this.enabled = true;
        this.cacheEngine = null;
        this.ttl = 60;
        this.saveEmptyValues = false;
        this.waitForCacheSet = true;
        this.staleWhileRevalidate = 0;
        this.emitter = null;
        this.cacheEngine = cacheEngine;
        this.emitter = new events_1.EventEmitter();
    }
    static getInstance() {
        if (!SmartCache.instance) {
            SmartCache.instance = new SmartCache(new MemoryCache_1.MemoryCache());
        }
        return SmartCache.instance;
    }
    static enable(enable) {
        SmartCache.getInstance().enabled = enable;
    }
    static getCacheEngine() {
        return SmartCache.getInstance().cacheEngine;
    }
    static setCacheEngine(cacheEngine) {
        SmartCache.getInstance().cacheEngine = cacheEngine;
    }
    static setTtl(ttl) {
        SmartCache.getInstance().ttl = ttl;
    }
    static setSaveEmptyValues(saveEmptyValues) {
        SmartCache.getInstance().saveEmptyValues = saveEmptyValues;
    }
    static setWaitForCacheSet(wait) {
        SmartCache.getInstance().waitForCacheSet = wait;
    }
    static setStaleWhileRevalidate(duration) {
        SmartCache.getInstance().staleWhileRevalidate = typeof duration === 'number' && duration >= 0 ? duration : 0;
    }
    static cache(params) {
        return (target, propertyKey, descriptor) => {
            const originalMethod = descriptor.value;
            const smartCache = SmartCache.getInstance();
            if (typeof (params.keyHandler) === 'string') {
                if (!target.hasOwnProperty(params.keyHandler) || typeof (target[params.keyHandler]) !== 'function') {
                    throw new Error(`Function ${params.keyHandler} doesn't exist on class ${target.constructor.name}`);
                }
            }
            else if (typeof (params.keyHandler) !== 'function') {
                throw new Error('keyHandler param type must be string or function');
            }
            if (!target.hasOwnProperty(generatingProcesses)) {
                target[generatingProcesses] = {};
            }
            target[generatingProcesses][propertyKey] = {};
            descriptor.value = function (...args) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (smartCache.enabled !== true) {
                        return originalMethod.apply(this, args);
                    }
                    const keyHandler = typeof (params.keyHandler) === 'string' ? target[params.keyHandler] : params.keyHandler;
                    const cacheKey = keyHandler(...args);
                    if (typeof cacheKey !== 'string' || cacheKey.trim() === '') {
                        throw new Error('Invalid cache key received from keyHandler function');
                    }
                    const tmpStaleTtl = typeof params.staleWhileRevalidate === 'function'
                        ? params.staleWhileRevalidate(...args) : params.staleWhileRevalidate;
                    const staleTtl = typeof tmpStaleTtl === 'number' && tmpStaleTtl >= 0
                        ? tmpStaleTtl
                        : (tmpStaleTtl === false ? 0 : smartCache.staleWhileRevalidate);
                    const keyPrefix = (typeof (params.keyPrefix) === 'string' && params.keyPrefix.trim() !== '')
                        ? params.keyPrefix : `${target.constructor.name}:${propertyKey}`;
                    const fullCacheKey = `${keyPrefix}:${cacheKey}`;
                    const cachedValue = yield smartCache.cacheEngine.get(fullCacheKey);
                    const self = this;
                    if (cachedValue && cachedValue.hasOwnProperty('v')) {
                        if (cachedValue.hasOwnProperty('e') && cachedValue.e < Date.now()) {
                            if (staleTtl > 0) {
                                SmartCache.generateAndStoreValue(self, originalMethod, args, params, smartCache, fullCacheKey, target, propertyKey, cacheKey, staleTtl);
                                return cachedValue.v;
                            }
                        }
                        else {
                            return cachedValue.v;
                        }
                    }
                    return SmartCache.generateAndStoreValue(self, originalMethod, args, params, smartCache, fullCacheKey, target, propertyKey, cacheKey, staleTtl);
                });
            };
        };
    }
    static generateAndStoreValue(self, originalMethod, args, params, smartCache, fullCacheKey, target, propertyKey, cacheKey, staleTtl) {
        return __awaiter(this, void 0, void 0, function* () {
            if (target[generatingProcesses][propertyKey][cacheKey] !== true) {
                target[generatingProcesses][propertyKey][cacheKey] = true;
                try {
                    const generatedValue = yield originalMethod.apply(self, args);
                    const saveEmptyValues = typeof params.saveEmptyValues === 'boolean' ? params.saveEmptyValues : smartCache.saveEmptyValues;
                    if (generatedValue != null || saveEmptyValues) {
                        let ttl = smartCache.ttl;
                        if (typeof params.ttl === 'number') {
                            ttl = params.ttl;
                        }
                        else if (params.ttl === false) {
                            ttl = undefined;
                        }
                        else if (typeof params.ttl === 'function') {
                            args.push(generatedValue);
                            const dynamicTtl = params.ttl(...args);
                            if (typeof dynamicTtl !== 'number' && dynamicTtl !== false) {
                                throw new Error('Invalid ttl received from ttl function');
                            }
                            ttl = dynamicTtl === false ? undefined : dynamicTtl;
                        }
                        if (smartCache.waitForCacheSet) {
                            yield SmartCache.storeDataInCache(smartCache.cacheEngine, fullCacheKey, generatedValue, ttl, staleTtl);
                        }
                        else {
                            SmartCache.storeDataInCache(smartCache.cacheEngine, fullCacheKey, generatedValue, ttl, staleTtl);
                        }
                    }
                    smartCache.emitter.emit(fullCacheKey, null, generatedValue);
                    return generatedValue;
                }
                catch (err) {
                    smartCache.emitter.emit(fullCacheKey, err);
                    throw err;
                }
                finally {
                    target[generatingProcesses][propertyKey][cacheKey] = false;
                }
            }
            else {
                return new Promise((resolve) => {
                    smartCache.emitter.once(fullCacheKey, (err, value) => {
                        if (err) {
                            return resolve(originalMethod.apply(self, args));
                        }
                        return resolve(value);
                    });
                });
            }
        });
    }
    static storeDataInCache(engine, key, value, ttl, staleTtl) {
        return __awaiter(this, void 0, void 0, function* () {
            if (ttl === undefined) {
                yield engine.set(key, { v: value });
            }
            else if (ttl > 0) {
                yield engine.set(key, Object.assign({ v: value }, staleTtl > 0 ? { e: Date.now() + ttl * 1000 } : {}), ttl + staleTtl);
            }
        });
    }
}
SmartCache.instance = null;
exports.SmartCache = SmartCache;
//# sourceMappingURL=SmartCache.js.map