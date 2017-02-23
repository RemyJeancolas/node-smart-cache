"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const events_1 = require("events");
const MemoryCache_1 = require("./MemoryCache");
const generatingProcesses = Symbol('generatingProcesses');
class SmartCache {
    constructor(cacheEngine, ttl) {
        this.cacheEngine = null;
        this.ttl = null;
        this.emitter = null;
        this.cacheEngine = cacheEngine;
        this.ttl = ttl;
        this.emitter = new events_1.EventEmitter();
    }
    static getInstance() {
        if (!SmartCache.instance) {
            SmartCache.instance = new SmartCache(new MemoryCache_1.MemoryCache(), SmartCache.defaultTtl);
        }
        return SmartCache.instance;
    }
    static setCacheEngine(cacheEngine) {
        SmartCache.getInstance().cacheEngine = cacheEngine;
    }
    static setTtl(ttl) {
        SmartCache.getInstance().ttl = ttl;
    }
    static cache(params) {
        return (target, propertyKey, descriptor) => {
            const originalMethod = descriptor.value;
            const smartCache = SmartCache.getInstance();
            // Check key generation method
            if (typeof (params.keyHandler) === 'string') {
                if (!target.hasOwnProperty(params.keyHandler) || typeof (target[params.keyHandler]) !== 'function') {
                    throw new Error(`Function ${params.keyHandler} doesn't exist on class ${target.constructor.name}`);
                }
            }
            else if (typeof (params.keyHandler) !== 'function') {
                throw new Error('keyHandler param type must be string or function');
            }
            // Create global 'generating' var for current class
            if (!target.hasOwnProperty(generatingProcesses)) {
                target[generatingProcesses] = {};
            }
            // Create sub object in order to handle current method (identified by 'propertyKey' param)
            target[generatingProcesses][propertyKey] = {};
            descriptor.value = function (...args) {
                return __awaiter(this, void 0, void 0, function* () {
                    const keyHandler = typeof (params.keyHandler) === 'string' ? target[params.keyHandler] : params.keyHandler;
                    const cacheKey = keyHandler(...args);
                    if (typeof cacheKey !== 'string' || cacheKey.trim() === '') {
                        throw new Error('Invalid cache key received from keyComputation function');
                    }
                    // If we reach this part, key is valid
                    const fullCacheKey = `${target.constructor.name}:${propertyKey}:${cacheKey}`;
                    const cachedValue = yield smartCache.cacheEngine.get(fullCacheKey);
                    if (cachedValue) {
                        return cachedValue;
                    }
                    // If we reach this part, value doesn't exist in cache
                    if (target[generatingProcesses][propertyKey][cacheKey] !== true) {
                        target[generatingProcesses][propertyKey][cacheKey] = true;
                        // If value is not generating, generate it
                        try {
                            const generatedValue = yield originalMethod.apply(this, args);
                            if (params.ttl === false) {
                                yield smartCache.cacheEngine.set(fullCacheKey, generatedValue);
                            }
                            else {
                                const ttl = typeof params.ttl === 'number' ? params.ttl : smartCache.ttl;
                                yield smartCache.cacheEngine.set(fullCacheKey, generatedValue, ttl);
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
                                // If there has been an error during value generation, just get it directly from initial code
                                if (err) {
                                    return resolve(originalMethod.apply(this, args));
                                }
                                // Else return it
                                return resolve(value);
                            });
                        });
                    }
                });
            };
        };
    }
}
SmartCache.defaultTtl = 60;
SmartCache.instance = null;
exports.SmartCache = SmartCache;
//# sourceMappingURL=SmartCache.js.map