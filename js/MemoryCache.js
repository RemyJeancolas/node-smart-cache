"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MemoryCache {
    constructor(gcInterval = 60) {
        this.data = {};
        setInterval(() => {
            this.gc();
        }, gcInterval * 1000); // Clean memory data every <gcInterval> seconds
    }
    get(key) {
        if (!this.data.hasOwnProperty(key) || (this.data[key].expire && this.data[key].expire < Date.now())) {
            return Promise.resolve(null);
        }
        return Promise.resolve(this.data[key].value);
    }
    set(key, value, ttl) {
        this.data[key] = {
            expire: ttl ? Date.now() + (ttl * 1000) : null,
            value: value
        };
        return Promise.resolve();
    }
    del(key) {
        delete (this.data[key]);
        return Promise.resolve();
    }
    gc() {
        const now = Date.now();
        Object.keys(this.data).forEach(key => {
            if (this.data[key].expire && this.data[key].expire < now) {
                this.del(key);
            }
        });
    }
}
exports.MemoryCache = MemoryCache;
//# sourceMappingURL=MemoryCache.js.map