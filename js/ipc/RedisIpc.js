"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const redis_1 = require("redis");
class RedisIpc {
    constructor(config) {
        this.emitter = new events_1.EventEmitter();
        this.host = config.host || '127.0.0.1';
        this.port = config.port || 6379;
        this.password = config.password || undefined;
        this.channel = config.channel;
        this.lockTtl = config.lockTtl;
        this.db = config.db || '0';
        this.publisher = redis_1.createClient({
            host: this.host,
            port: this.port,
            password: this.password,
            db: this.db
        });
        this.subscriber = this.publisher.duplicate();
        this.subscriber.on('ready', () => {
            this.subscriber.subscribe(this.channel);
        });
        this.subscriber.on('message', (channel, message) => {
            try {
                const value = JSON.parse(message);
                if (value && value.k && value.v) {
                    this.emitter.emit('message', value.k, JSON.parse(value.v));
                }
            }
            catch (e) {
                // Fail silently
            }
        });
    }
    emit(key, value) {
        this.publisher.publish(this.channel, JSON.stringify({
            k: key,
            v: JSON.stringify(value)
        }));
        return Promise.resolve();
    }
    onEvent(handler) {
        this.emitter.on('message', (k, v) => {
            handler(k, v);
        });
    }
    lock(key) {
        return new Promise((resolve, reject) => {
            this.publisher.set(`lock:${key}`, '1', 'NX', 'EX', this.lockTtl, (err, res) => {
                if (err) {
                    return reject(err);
                }
                return resolve(res !== null);
            });
        });
    }
    unlock(key) {
        return new Promise((resolve, reject) => {
            this.publisher.del(`lock:${key}`, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
}
exports.RedisIpc = RedisIpc;
//# sourceMappingURL=RedisIpc.js.map