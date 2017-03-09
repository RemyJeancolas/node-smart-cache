export class MemoryCache {
    private data: any = {};

    public constructor(gcInterval: number = 60) {
        setInterval(() => {
            this.gc();
        }, gcInterval * 1000); // Clean memory data every <gcInterval> seconds
    }

    public get(key: string): Promise<any> { // tslint:disable-line:no-reserved-keywords
        if (!this.data.hasOwnProperty(key) || (this.data[key].expire && this.data[key].expire < Date.now())) {
            return Promise.resolve(null);
        }
        return Promise.resolve(this.data[key].value);
    }

    public set(key: string, value: any, ttl?: number): Promise<void> { // tslint:disable-line:no-reserved-keywords
        this.data[key] = {
            expire: ttl ? Date.now() + (ttl * 1000) : null,
            value: value
        };
        return Promise.resolve();
    }

    public del(key: string): Promise<void> {
        delete(this.data[key]);
        return Promise.resolve();
    }

    private gc(): void {
        const now = Date.now();
        Object.keys(this.data).forEach(key => {
            if (this.data[key].expire && this.data[key].expire < now) {
                this.del(key);
            }
        });
    }
}
