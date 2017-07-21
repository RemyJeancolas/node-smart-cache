import * as fs from 'fs';
import * as path from 'path';
import {SmartCacheEngine} from '../SmartCache';

export class FileCache implements SmartCacheEngine {
    private filePath: string;

    constructor(filePath: string, gcInterval: number = 60) {
        // Get filePath info
        let stats: fs.Stats = null;
        try {
            stats = fs.statSync(filePath);
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }

        // If path exists, check that it's a directory and it's writable
        if (stats) {
            if (!stats.isDirectory()) {
                throw new Error(`Path ${filePath} is not a directory`);
            }

            try {
                fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK); // tslint:disable-line:no-bitwise
            } catch (e) {
                throw new Error(`Path ${filePath} needs to be readable and writable`);
            }
        } else { // If path doesn't exist, try to create it
            try {
                fs.mkdirSync(filePath);
            } catch (e) {
                throw new Error(`An error occurred while trying to create directory "${filePath}": ${e.message}`);
            }
        }

        this.filePath = filePath;

        setInterval(() => {
            this.gc();
        }, gcInterval * 1000);
    }

    // tslint:disable-next-line:no-reserved-keywords
    public async get(key: string): Promise<any> {
        const files = await this.getFilesByCacheKey(key);

        if (files.length > 0) {
            const expire = files[0].split('.');
            const time = expire[expire.length - 2];
            if (!isNaN(<any> time) && +time < Date.now()) {
                return null;
            }

            const data = await this.readFile(path.resolve(this.filePath, files[0]));
            let result: any;
            try {
                result = JSON.parse(data);
            } catch (e) {
                result = data;
            }
            return result;
        }

        return null;
    }

    // tslint:disable-next-line:no-reserved-keywords
    public async set(key: string, value: any, ttl?: number): Promise<void> {
        const fullFileName = path.resolve(
            this.filePath,
            `${key}${ttl ? `.${Date.now() + (ttl * 1000)}` : ''}.cache`
        );

        if (ttl) {
            // If files with same key exist, remove them
            const files = await this.getFilesByCacheKey(key);
            for (const file of files) {
                await this.deleteFile(path.resolve(this.filePath, file));
            }
        }

        return this.writeFile(fullFileName, JSON.stringify(value));
    }

    public async del(key: string): Promise<void> {
        const files = await this.getFilesByCacheKey(key);
        for (const file of files) {
            await this.deleteFile(path.resolve(this.filePath, file));
        }
    }

    private async getFilesByCacheKey(key: string): Promise<string[]> {
        const files = await this.readDir(this.filePath);
        const regex = new RegExp(`^${key}(\\.\\d{13})?\\.cache$`);
        return files.filter(f => regex.exec(f));
    }

    private async gc(): Promise<void> {
        const now = Date.now();
        const files = await this.readDir(this.filePath);
        const results = files.filter(f => /^(.{1,})\.\d{13}\.cache$/.exec(f));

        for (const r of results) {
            if (+r.substr(-19, 13) < now) {
                await this.deleteFile(path.resolve(this.filePath, r));
            }
        }
    }

    private async readDir(path: string): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            fs.readdir(path, (err, files) => {
                if (err) {
                    return reject(err);
                }
                return resolve(files);
            });
        });
    }

    private async readFile(fileName: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            fs.readFile(fileName, (err, data) => {
                if (err) {
                    return reject(err);
                }
                return resolve(data.toString());
            });
        });
    }

    private async writeFile(fileName: string, data: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs.writeFile(fileName, data, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    private async deleteFile(fileName: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs.unlink(fileName, (err) => {
                if (err && err.code !== 'ENOENT') {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
}
