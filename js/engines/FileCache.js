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
const fs = require("fs");
const path = require("path");
class FileCache {
    constructor(filePath, gcInterval = 60) {
        let stats = null;
        try {
            stats = fs.statSync(filePath);
        }
        catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }
        if (stats) {
            if (!stats.isDirectory()) {
                throw new Error(`Path ${filePath} is not a directory`);
            }
            try {
                fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
            }
            catch (e) {
                throw new Error(`Path ${filePath} needs to be readable and writable`);
            }
        }
        else {
            try {
                fs.mkdirSync(filePath);
            }
            catch (e) {
                throw new Error(`An error occurred while trying to create directory "${filePath}": ${e.message}`);
            }
        }
        this.filePath = filePath;
        if (gcInterval > 0) {
            const timer = setInterval(() => {
                this.gc();
            }, gcInterval * 1000);
            timer.unref();
        }
    }
    get(key) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = yield this.getFilesByCacheKey(key);
            if (files.length > 0) {
                const expire = files[0].split('.');
                const time = expire[expire.length - 2];
                if (!isNaN(time) && +time < Date.now()) {
                    return null;
                }
                const data = yield this.readFile(path.resolve(this.filePath, files[0]));
                let result;
                try {
                    result = JSON.parse(data);
                }
                catch (e) {
                    result = data;
                }
                return result;
            }
            return null;
        });
    }
    set(key, value, ttl) {
        return __awaiter(this, void 0, void 0, function* () {
            const fullFileName = path.resolve(this.filePath, `${key}${ttl ? `.${Date.now() + (ttl * 1000)}` : ''}.cache`);
            if (ttl) {
                const files = yield this.getFilesByCacheKey(key);
                for (const file of files) {
                    yield this.deleteFile(path.resolve(this.filePath, file));
                }
            }
            return this.writeFile(fullFileName, JSON.stringify(value));
        });
    }
    del(key) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = yield this.getFilesByCacheKey(key);
            for (const file of files) {
                yield this.deleteFile(path.resolve(this.filePath, file));
            }
        });
    }
    getFilesByCacheKey(key) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = yield this.readDir(this.filePath);
            const regex = new RegExp(`^${key}(\\.\\d{13})?\\.cache$`);
            return files.filter(f => regex.exec(f));
        });
    }
    gc() {
        return __awaiter(this, void 0, void 0, function* () {
            const now = Date.now();
            const files = yield this.readDir(this.filePath);
            const results = files.filter(f => /^(.{1,})\.\d{13}\.cache$/.exec(f));
            for (const r of results) {
                if (+r.substr(-19, 13) < now) {
                    yield this.deleteFile(path.resolve(this.filePath, r));
                }
            }
        });
    }
    readDir(dir) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                fs.readdir(dir, (err, files) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve(files);
                });
            });
        });
    }
    readFile(fileName) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                fs.readFile(fileName, (err, data) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve(data.toString());
                });
            });
        });
    }
    writeFile(fileName, data) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                fs.writeFile(fileName, data, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            });
        });
    }
    deleteFile(fileName) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                fs.unlink(fileName, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        return reject(err);
                    }
                    return resolve();
                });
            });
        });
    }
}
exports.FileCache = FileCache;
//# sourceMappingURL=FileCache.js.map