import {expect} from 'chai';
import * as sinon from 'sinon';
import {MemoryCache} from '../lib/engines/MemoryCache';
import {SinonSandbox, SinonFakeTimers} from 'sinon';

let sandbox: SinonSandbox;
let memoryCache: MemoryCache = null;
let clock: SinonFakeTimers = null;

describe('MemoryCache', () => {

    before(() => {
        clock = sinon.useFakeTimers(Date.now());
        sandbox = sinon.sandbox.create();
        memoryCache = new MemoryCache();
    });

    afterEach(() => {
        sandbox.restore();
    });

    after(() => {
        try { clock.restore(); } catch (e) {} // tslint:disable-line:no-empty
    });

    it('MemoryCache::get()', async () => {
        sandbox.stub(memoryCache, 'gc', () => true);
        let result = await memoryCache.get('foo');
        expect(result).to.equal(null, 'Result should be null');

        await memoryCache.set('foo', 'bar', 1);
        result = await memoryCache.get('foo');
        expect(result).to.equal('bar');

        clock.tick(1100);
        result = await memoryCache.get('foo');
        expect(result).to.equal(null, 'Result should be null');
    });

    it('MemoryCache::set()', async () => {
        const spy = sinon.spy(memoryCache, 'gc');
        try {
            await memoryCache.set('foo', 'bar', 65);
            let result = await memoryCache.get('foo');
            expect(result).to.equal('bar');
            expect(spy.callCount).to.equal(0);

            clock.tick(60100);
            result = await memoryCache.get('foo');
            expect(result).to.equal('bar');
            expect(spy.callCount).to.equal(1);

            clock.tick(60100);
            result = await memoryCache.get('foo');
            expect(result).to.equal(null, 'Result should be null');
            expect(spy.callCount).to.equal(2);
        } finally {
            spy.restore();
        }
    });
});
