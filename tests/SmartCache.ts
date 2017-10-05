import { expect } from 'chai';
import * as sinon from 'sinon';
import { SinonSandbox } from 'sinon';
import { EventEmitter } from 'events';
import { SmartCache, SmartCacheEngine } from '../lib/SmartCache';
import { MemoryCache } from '../lib/engines/MemoryCache';

const cacheEngine: SmartCacheEngine = { get: <any> Function, set: <any> Function };
const cache = SmartCache.cache;
let sandbox: SinonSandbox;
let foo: Foo = null;

class Foo {
    @SmartCache.cache({keyHandler: 'generateKey', ttl: 5})
    public bar(): Promise<string> {
        return new Promise<string>(resolve => {
            return resolve('bar');
        });
    }

    @cache({keyHandler: 'generateKey2'})
    public baz(input: string, wait: number): Promise<string> {
        return new Promise<string>((resolve) => {
            setTimeout(() => {
                resolve(input);
            }, wait);
        });
    }

    @cache({ keyHandler: (input: string) => input, ttl: false, keyPrefix: 'prefix'})
    public neverExpire(input: string): Promise<string> {
        return new Promise<string>(resolve => {
            resolve(input);
        });
    }

    @cache({ keyHandler: () => 'nullValues', ttl: false, keyPrefix: 'nullValues'})
    public nullValues(input: string): Promise<string> {
        return new Promise<string>(resolve => {
            resolve(input);
        });
    }

    @cache({ keyHandler: () => 'nvas', ttl: false, keyPrefix: 'nvas', saveEmptyValues: true})
    public nullValuesAlwaysSave(input: string): Promise<string> {
        return new Promise<string>(resolve => {
            resolve(input);
        });
    }

    @cache({keyHandler: () => 'dynTtl', keyPrefix: 'dynTtl', ttl: (i: any, t: any, r: any) => {
        return typeof r.ttl === 'number' ? r.ttl + 1 : r.ttl;
    }})
    public dynamicTtl(input: string, ttl: number): Promise<any> {
        return new Promise<any>(resolve => {
            resolve({
                input,
                ttl: !isNaN(ttl) ? ttl + 1 : (ttl === undefined ? false : 'foo')
            });
        });
    }

    @cache({keyHandler: (input: string) => input})
    public error(input: string, wait: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('Foo'));
            }, wait);
        });
    }

    @SmartCache.cache({keyHandler: 'failHandler'})
    public fail(): string {
        return 'fail';
    }

    private generateKey(): string { // tslint:disable-line:no-unused-variable
        return 'key';
    }

    private generateKey2(input: string): string { // tslint:disable-line:no-unused-variable
        return input;
    }

    private failHandler(): number { // tslint:disable-line:no-unused-variable
        return 2;
    }
}

let invalidHandlerError: string = null;
try {
    class Fail { // tslint:disable-line:no-unused-variable
        @cache({keyHandler: 'null'})
        public foo(): Promise<string> {
            return Promise.resolve('bar');
        }
    }
} catch (e) {
    invalidHandlerError = e.message;
}

let invalidHandlerError2: string = null;
try {
    class Fail2 { // tslint:disable-line:no-unused-variable
        @cache({keyHandler: <any> 2})
        public foo(): Promise<string> {
            return Promise.resolve('bar');
        }
    }
} catch (e) {
    invalidHandlerError2 = e.message;
}

describe('SmartCache', () => {
    before(() => {
        sandbox = sinon.sandbox.create();
        foo = new Foo();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('SmartCache::enable()', async () => {
        try {
            const getStub = sandbox.stub(SmartCache.getCacheEngine(), 'get').returns(null);
            const setStub = sandbox.stub(SmartCache.getCacheEngine(), 'set').returns(true);
            await foo.bar();
            expect(getStub.callCount).to.equal(1);
            expect(setStub.callCount).to.equal(1);

            SmartCache.enable(false);
            await foo.bar();
            expect(getStub.callCount).to.equal(1);
            expect(setStub.callCount).to.equal(1);

            let error: string = null;
            try {
                await foo.error('bar', 0);
            } catch (e) {
                error = e.message;
            }
            expect(error).to.equal('Foo');
            expect(getStub.callCount).to.equal(1);
            expect(setStub.callCount).to.equal(1);
        } finally {
            SmartCache.enable(true);
        }
    });

    it('SmartCache::getCacheEngine()', () => {
        expect(SmartCache.getCacheEngine()).to.be.instanceof(MemoryCache);
    });

    it('SmartCache::setCacheEngine()', async () => {
        try {
            const getStub = sandbox.stub(cacheEngine, 'get').returns(null);
            const setStub = sandbox.stub(cacheEngine, 'set').returns(true);
            SmartCache.setCacheEngine(cacheEngine);
            await foo.bar();
            expect(getStub.callCount).to.equal(1);
            expect(setStub.callCount).to.equal(1);
        } finally {
            SmartCache.setCacheEngine(new MemoryCache());
        }
    });

    it('SmartCache::setSaveEmptyValues', async () => {
        try {
            const setStub = sandbox.stub(SmartCache.getCacheEngine(), 'set').returns(true);
            await foo.nullValues(null);
            expect(setStub.callCount).to.equal(0);

            SmartCache.setSaveEmptyValues(true);
            await foo.nullValues(null);
            expect(setStub.callCount).to.equal(1);
        } finally {
            SmartCache.setSaveEmptyValues(false);
        }
    });

    it('SmartCache::setWaitForCacheSet', async () => {
        try {
            const setStub = sandbox.stub(SmartCache.getCacheEngine(), 'set').returns(true);
            await foo.bar();
            expect(setStub.callCount).to.equal(1);

            SmartCache.setWaitForCacheSet(false);
            await foo.bar();
            expect(setStub.callCount).to.equal(2);
        } finally {
            SmartCache.setWaitForCacheSet(true);
        }
    });

    it('SmartCache::setStaleWhileRevalidate', async () => {
        SmartCache.setStaleWhileRevalidate(-1);
        expect((<any> SmartCache).getInstance().staleWhileRevalidate).to.equal(0);
        SmartCache.setStaleWhileRevalidate(false);
        expect((<any> SmartCache).getInstance().staleWhileRevalidate).to.equal(0);
        SmartCache.setStaleWhileRevalidate(11);
        expect((<any> SmartCache).getInstance().staleWhileRevalidate).to.equal(11);
        SmartCache.setStaleWhileRevalidate(false);
    });

    it('SmartCache::setTtl()', async () => {
        try {
            const spy = sandbox.spy(MemoryCache.prototype, 'set');
            await foo.baz('abc', 1);
            expect(spy.callCount).to.equal(1);
            expect(spy.lastCall.args).to.deep.equal(['Foo:baz:abc', { v: 'abc' }, 60]);

            SmartCache.setTtl(2);
            await foo.baz('cba', 1);
            expect(spy.callCount).to.equal(2);
            expect(spy.lastCall.args).to.deep.equal(['Foo:baz:cba', { v: 'cba' }, 2]);
        } finally {
            SmartCache.setTtl(60);
        }
    });

    it('SmartCache::cache() - Basic operations', async () => {
        const clock = sandbox.useFakeTimers(Date.now());
        const getSpy = sandbox.spy(MemoryCache.prototype, 'get');
        const setSpy = sandbox.spy(MemoryCache.prototype, 'set');

        // Test cache set
        expect(await foo.bar()).to.equal('bar');
        expect(getSpy.callCount).to.equal(1);
        expect(getSpy.lastCall.args).to.deep.equal(['Foo:bar:key']);
        expect(setSpy.callCount).to.equal(1);
        expect(setSpy.lastCall.args).to.deep.equal(['Foo:bar:key', { v: 'bar' }, 5]);

        // Test cache get
        expect(await foo.bar()).to.equal('bar');
        expect(getSpy.callCount).to.equal(2);
        expect(setSpy.callCount).to.equal(1);

        // Test cache clear
        clock.tick(6000);
        expect(await foo.bar()).to.equal('bar');
        expect(getSpy.callCount).to.equal(3);
        expect(setSpy.callCount).to.equal(2);

        // Test cache with no TTL
        expect(await foo.neverExpire('hello')).to.equal('hello');
        expect(getSpy.callCount).to.equal(4);
        expect(setSpy.callCount).to.equal(3);
        clock.tick(3600000);
        expect(await foo.neverExpire('hello')).to.equal('hello');
        expect(getSpy.callCount).to.equal(5);
        expect(setSpy.callCount).to.equal(3);

        // Test cache clean
        await (<MemoryCache> SmartCache.getCacheEngine()).del('prefix:hello');
        expect(await foo.neverExpire('hello')).to.equal('hello');
        expect(getSpy.callCount).to.equal(6);
        expect(setSpy.callCount).to.equal(4);

        // Test null values save with 'saveEmptyValues' param to true
        SmartCache.setSaveEmptyValues(false);
        (expect(await foo.nullValuesAlwaysSave(null))).to.equal(null, 'Result should be null');
        expect(getSpy.callCount).to.equal(7);
        expect(setSpy.callCount).to.equal(5);
        expect(setSpy.lastCall.args).to.deep.equal(['nvas:nvas', { v: null}], 'Result should be as expected');
        await (<MemoryCache> SmartCache.getCacheEngine()).del('nvas:nvas');

        // Test dynamic TTL
        await foo.dynamicTtl('input', 1);
        expect(getSpy.callCount).to.equal(8);
        expect(setSpy.callCount).to.equal(6);
        expect(setSpy.lastCall.args).to.deep.equal(
            ['dynTtl:dynTtl', { v: {input: 'input', ttl: 2} }, 3],
            'Result should be as expected'
        );

        await (<MemoryCache> SmartCache.getCacheEngine()).del('dynTtl:dynTtl');
        await foo.dynamicTtl('input', undefined);
        expect(getSpy.callCount).to.equal(9);
        expect(setSpy.callCount).to.equal(7);
        expect(setSpy.lastCall.args).to.deep.equal(
            ['dynTtl:dynTtl', { v: {input: 'input', ttl: false} }],
            'Result should be as expected'
        );

        await (<MemoryCache> SmartCache.getCacheEngine()).del('dynTtl:dynTtl');
        let error: string = null;
        try {
            await foo.dynamicTtl('input', <any> '');
        } catch (e) {
            error = e.message;
        }
        expect(getSpy.callCount).to.equal(10);
        expect(setSpy.callCount).to.equal(7);
        expect(error).to.equal('Invalid ttl received from ttl function');

        await (<MemoryCache> SmartCache.getCacheEngine()).del('dynTtl:dynTtl');
        await foo.dynamicTtl('input', -5);
        expect(getSpy.callCount).to.equal(11);
        expect(setSpy.callCount).to.equal(7);
    });

    it('SmartCache::cache() - Handle concurrency', async () => {
        const getSpy = sandbox.spy(MemoryCache.prototype, 'get');
        const setSpy = sandbox.spy(MemoryCache.prototype, 'set');
        const emitSpy = sandbox.spy(EventEmitter.prototype, 'emit');
        const onceSpy = sandbox.spy(EventEmitter.prototype, 'once');

        await Promise.all([
            foo.baz('aaa', 10),
            foo.baz('aaa', 1),
            foo.baz('aaa', 100)
        ]);

        expect(getSpy.callCount).to.equal(3);
        expect(setSpy.callCount).to.equal(1);
        expect(emitSpy.callCount).to.equal(1);
        expect(onceSpy.callCount).to.equal(2);

        // Test when function returns error
        // sandbox.stub(foo, 'baz').throws(new Error('Foo'));
        let error: string = null;
        try {
            await Promise.all([
                foo.error('aaa', 20),
                foo.error('aaa', 1),
                foo.error('aaa', 100)
            ]);
        } catch (e) {
            error = e.message;
        }

        expect(error).to.equal('Foo');
        expect(getSpy.callCount).to.equal(6);
        expect(setSpy.callCount).to.equal(1);
        expect(emitSpy.callCount).to.equal(2);
        expect(onceSpy.callCount).to.equal(4);
        expect(emitSpy.lastCall.args[1].message).to.equal('Foo');
    });

    it('SmartCache::cache() - Invalid key handler response', async () => {
        expect(invalidHandlerError).to.equal('Function null doesn\'t exist on class Fail', 'Error should be as expected');
        expect(invalidHandlerError2).to.equal('keyHandler param type must be string or function');

        let error: string = null;
        try {
            await foo.fail();
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal('Invalid cache key received from keyHandler function');
    });
});
