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
const MemoryCache_1 = require("./MemoryCache");
const generatingProcesses = Symbol('generatingProcesses');
class SmartCache {
    constructor(cacheEngine) {
        this.cacheEngine = null;
        this.ttl = 60;
        this.saveEmptyValues = false;
        this.emitter = null;
        this.ipc = null;
        this.cacheEngine = cacheEngine;
        this.emitter = new events_1.EventEmitter();
    }
    static getInstance() {
        if (!SmartCache.instance) {
            SmartCache.instance = new SmartCache(new MemoryCache_1.MemoryCache());
        }
        return SmartCache.instance;
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
    static setIpc(ipc) {
        const smartcache = SmartCache.getInstance();
        ipc.onEvent((key, value) => {
            smartcache.emitter.emit(key, null, value);
        });
        smartcache.ipc = ipc;
    }
    // tslint:disable-next-line:max-func-body-length
    static cache(params) {
        // tslint:disable-next-line:max-func-body-length
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
                        throw new Error('Invalid cache key received from keyHandler function');
                    }
                    // If we reach this part, key is valid
                    // Compute key prefix
                    const keyPrefix = (typeof (params.keyPrefix) === 'string' && params.keyPrefix.trim() !== '')
                        ? params.keyPrefix : `${target.constructor.name}:${propertyKey}`;
                    const fullCacheKey = `${keyPrefix}:${cacheKey}`;
                    const cachedValue = yield smartCache.cacheEngine.get(fullCacheKey);
                    if (cachedValue && cachedValue.hasOwnProperty('v')) {
                        return cachedValue.v;
                    }
                    // If we reach this part, value doesn't exist in cache
                    let externalGenerating = false;
                    if (smartCache.ipc) {
                        externalGenerating = !(yield smartCache.ipc.lock(fullCacheKey));
                    }
                    if (!externalGenerating && target[generatingProcesses][propertyKey][cacheKey] !== true) {
                        target[generatingProcesses][propertyKey][cacheKey] = true;
                        // If value is not generating, generate it
                        try {
                            const generatedValue = yield originalMethod.apply(this, args);
                            // Check if we need to save the generated value in cache
                            const saveEmptyValues = typeof (params.saveEmptyValues) === 'boolean' ? params.saveEmptyValues : smartCache.saveEmptyValues;
                            if (generatedValue != null || saveEmptyValues) {
                                // Compute cache TTL
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
                                yield smartCache.cacheEngine.set(fullCacheKey, { v: generatedValue }, ttl);
                            }
                            // Send value to all local listeners
                            smartCache.emitter.emit(fullCacheKey, null, generatedValue);
                            // Send value to all remote listeners
                            if (smartCache.ipc) {
                                smartCache.ipc.emit(fullCacheKey, generatedValue);
                            }
                            return generatedValue;
                        }
                        catch (err) {
                            smartCache.emitter.emit(fullCacheKey, err);
                            throw err;
                        }
                        finally {
                            target[generatingProcesses][propertyKey][cacheKey] = false;
                            if (smartCache.ipc) {
                                smartCache.ipc.unlock(fullCacheKey);
                            }
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
SmartCache.instance = null;
exports.SmartCache = SmartCache;
//# sourceMappingURL=SmartCache.js.map