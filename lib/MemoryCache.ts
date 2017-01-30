export class MemoryCache {
    private data: any = {};

    public constructor() {
        setInterval(() => {
            this.gc();
        }, 60000); // Clean memory data every 60 seconds
    }

    public get(key: string): Promise<any> { // tslint:disable-line:no-reserved-keywords
        if (!this.data.hasOwnProperty(key) || this.data[key].expire < Date.now()) {
            return Promise.resolve(null);
        }
        return Promise.resolve(this.data[key].value);
    }

    public set(key: string, value: any, ttl: number): Promise<void> { // tslint:disable-line:no-reserved-keywords
        this.data[key] = {
            expire: Date.now() + (ttl * 1000),
            value: value
        };
        return Promise.resolve();
    }

    private gc(): void {
        const now = Date.now();
        Object.keys(this.data).forEach(key => {
            if (this.data[key].expire < now) {
                delete(this.data[key]);
            }
        });
    }
}
