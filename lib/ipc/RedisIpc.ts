import {EventEmitter} from 'events';
import {RedisClient, createClient} from 'redis';
import {Ipc} from './Ipc';

export interface RedisIpcConfig {
    channel: string;
    lockTtl: number;
    db?: string;
    host?: string;
    port?: number;
    password?: string;
}

export class RedisIpc implements Ipc {
    private emitter: EventEmitter;

    private channel: string;
    private lockTtl: number;
    private db: string;
    private host: string;
    private port: number;
    private password: string;

    private publisher: RedisClient;
    private subscriber: RedisClient;

    public constructor(config: RedisIpcConfig) {
        this.emitter = new EventEmitter();

        this.host = config.host || '127.0.0.1';
        this.port = config.port || 6379;
        this.password = config.password || undefined;
        this.channel = config.channel;
        this.lockTtl = config.lockTtl;
        this.db = config.db || '0';

        this.publisher = createClient({
            host: this.host,
            port: this.port,
            password: this.password,
            db: this.db
        });

        this.subscriber = this.publisher.duplicate();
        this.subscriber.on('ready', () => {
            this.subscriber.subscribe(this.channel);
        });
        this.subscriber.on('message', (channel: string, message: string) => {
            try {
                const value = JSON.parse(message);
                if (value && value.k && value.v) {
                    this.emitter.emit('message', value.k, JSON.parse(value.v));
                }
            } catch (e) {
                // Fail silently
            }
        });
    }

    public emit(key: string, value: any): Promise<void> {
        this.publisher.publish(this.channel, JSON.stringify({
            k: key,
            v: JSON.stringify(value)
        }));
        return Promise.resolve();
    }

    public onEvent(handler: (key: string, value: any) => any): void {
        this.emitter.on('message', (k: string, v: any) => {
            handler(k, v);
        });
    }

    public lock(key: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.publisher.set(
                `lock:${key}`, '1', 'NX', 'EX', this.lockTtl, (err: Error, res: any) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve(res !== null);
            });
        });
    }

    public unlock(key: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.publisher.del(`lock:${key}`, (err: Error) => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }
}
