import {expect} from 'chai';
import * as sinon from 'sinon';
import {SinonSandbox} from 'sinon';
import {EventEmitter} from 'events';
import {SmartCache, SmartCacheEngine} from '../lib/SmartCache';
import {MemoryCache} from '../lib/MemoryCache';

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

    private generateKey(): string {
        return 'key';
    }

    private generateKey2(input: string): string {
        return input;
    }

    private failHandler(): number {
        return 2;
    }
}

let invalidHandlerError: string = null;
try {
    class Fail {
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
    class Fail2 {
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

    it('SmartCache::setCacheEngine()', async () => {
        try {
            const getStub = sandbox.stub(cacheEngine, 'get', () => <any> null);
            const setStub = sandbox.stub(cacheEngine, 'set', () => true);
            SmartCache.setCacheEngine(cacheEngine);
            await foo.bar();
            expect(getStub.callCount).to.equal(1);
            expect(setStub.callCount).to.equal(1);
        } finally {
            SmartCache.setCacheEngine(new MemoryCache());
        }
    });

    it('SmartCache::setTtl()', async () => {
        try {
            const spy = sandbox.spy(MemoryCache.prototype, 'set');
            await foo.baz('abc', 1);
            expect(spy.callCount).to.equal(1);
            expect(spy.lastCall.args).to.deep.equal(['Foo:baz:abc', 'abc', 60]);

            SmartCache.setTtl(2);
            await foo.baz('cba', 1);
            expect(spy.callCount).to.equal(2);
            expect(spy.lastCall.args).to.deep.equal(['Foo:baz:cba', 'cba', 2]);
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
        expect(setSpy.lastCall.args).to.deep.equal(['Foo:bar:key', 'bar', 5]);

        // Test cache get
        expect(await foo.bar()).to.equal('bar');
        expect(getSpy.callCount).to.equal(2);
        expect(setSpy.callCount).to.equal(1);

        // Test cache clear
        clock.tick(6000);
        expect(await foo.bar()).to.equal('bar');
        expect(getSpy.callCount).to.equal(3);
        expect(setSpy.callCount).to.equal(2);
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
        expect(error).to.equal('Invalid cache key received from keyComputation function');
    });
});
