import { expect } from 'chai';
import * as sinon from 'sinon';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { FileCache } from '../lib/engines/FileCache';

let sandbox: sinon.SinonSandbox;
let tmpDir: string;
let fileCache: FileCache;

function sleep(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(() => { return resolve(); }, time);
    });
}

describe('FileCache', () => {
    before(() => {
        sandbox = sinon.sandbox.create();
        tmpDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
    });

    afterEach(() => {
        fileCache = undefined;
        sandbox.restore();
    });

    after(() => {
        fs.readdirSync(tmpDir).forEach(f => {
            fs.unlinkSync(path.resolve(tmpDir, f));
        });
        fs.rmdirSync(tmpDir);
    });

    it ('FileCache::constructor()', () => {
        const clock = sandbox.useFakeTimers();
        const gc = sandbox.stub((<any> FileCache.prototype), 'gc');
        fileCache = new FileCache(tmpDir);
        expect(gc.callCount).to.equal(0);
        clock.tick(61 * 1000);
        expect(gc.callCount).to.equal(1);

        const stub = sandbox.stub(fs, 'statSync').throws(new Error('foo'));
        let error: string = null;
        try {
            fileCache = new FileCache(tmpDir);
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal('foo');

        const enoentError = new Error();
        (<any> enoentError).code = 'ENOENT';
        stub.throws(enoentError);
        const mkdirStub = sandbox.stub(fs, 'mkdirSync');
        fileCache = new FileCache(tmpDir);
        expect(stub.callCount).to.equal(2);
        expect(mkdirStub.callCount).to.equal(1);

        mkdirStub.throws(new Error('baz'));
        try {
            fileCache = new FileCache(tmpDir);
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal(`An error occurred while trying to create directory "${tmpDir}": baz`);

        stub.returns({isDirectory: () => false});
        try {
            fileCache = new FileCache(tmpDir);
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal(`Path ${tmpDir} is not a directory`);

        stub.returns({isDirectory: () => true});
        sandbox.stub(fs, 'accessSync').throws(new Error('Foobar'));
        try {
            fileCache = new FileCache(tmpDir);
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal(`Path ${tmpDir} needs to be readable and writable`);
    });

    it('FileCache::get', async() => {
        const clock = sandbox.useFakeTimers(Date.now());
        sandbox.stub((<any> FileCache.prototype), 'gc');
        fileCache = new FileCache(tmpDir, 10);

        expect(await fileCache.get('foo')).to.equal(null, 'Result should be as expected');

        fs.writeFileSync(path.resolve(tmpDir, `foo.${Date.now()}.cache`), 'bar');
        expect(await fileCache.get('foo')).to.equal('bar');

        clock.tick(11 * 1000);
        expect(await fileCache.get('foo')).to.equal(null, 'Result should be as expected');

        fs.writeFileSync(path.resolve(tmpDir, 'bar.cache'), 'foo');
        expect(await fileCache.get('bar')).to.equal('foo');

        const readFileStub = sandbox.stub(fs, 'readFile').callsFake((name: string, callback: (err?: Error) => any) => {
            callback(new Error('Foobar'));
        });
        let error: string = null;
        try {
            await fileCache.get('bar');
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal('Foobar');

        readFileStub.restore();
        sandbox.stub(fs, 'readdir').callsFake((dir: string, callback: (err?: Error) => any) => {
            callback(new Error('Foo'));
        });
        try {
            await fileCache.get('bar');
        } catch (e) {
            error = e.message;
        }
        expect(error).to.equal('Foo');
    });

    it('FileCache::set', async() => {
        const clock = sandbox.useFakeTimers(Date.now());
        sandbox.stub((<any> FileCache.prototype), 'gc');
        fileCache = new FileCache(tmpDir, 10);

        expect(() => fs.readFileSync(path.resolve(tmpDir, 'foobar.cache'))).to.throw();

        await fileCache.set('foobar', 'foobar');
        expect(fs.readFileSync(path.resolve(tmpDir, 'foobar.cache')).toString()).to.equal('"foobar"');

        const newFile = `foobar.${Date.now() + 10000}.cache`;
        await fileCache.set('foobar', 'foobar', 10);
        expect(() => fs.readFileSync(path.resolve(tmpDir, 'foobar.cache'))).to.throw();
        expect(
            fs.readFileSync(
                path.resolve(tmpDir, newFile)).toString()
            ).to.equal('"foobar"');

        clock.tick(1000);
        await fileCache.set('foobar', 'foobar', 10);
        expect(() => fs.readFileSync(path.resolve(tmpDir, newFile))).to.throw();
        expect(
            fs.readFileSync(
                path.resolve(tmpDir, `foobar.${Date.now() + 10000}.cache`)).toString()
            ).to.equal('"foobar"');

        const writeFileStub = sandbox.stub(fs, 'writeFile').callsFake((name: string, data: any, callback: (err?: Error) => any) => {
            callback(new Error('Bar'));
        });
        let error: string = null;
        try {
            await fileCache.set('foobar', 'foobar', 10);
        } catch (e) {
            error = e.message;
        }
        expect(writeFileStub.callCount).to.equal(1);
        expect(error).to.equal('Bar');
        writeFileStub.restore();
    });

    it('FileCache::del', async() => {
        sandbox.stub((<any> FileCache.prototype), 'getFilesByCacheKey').returns(['foo', 'bar']);
        const unlinkStub = sandbox.stub(fs, 'unlink').callsFake((fileName: string, callback: (err?: Error) => any) => {
            callback();
        });
        fileCache = new FileCache(tmpDir, 10);
        await fileCache.del('foo');
        expect(unlinkStub.callCount).to.equal(2);

        unlinkStub.callsFake((fileName: string, callback: (err?: Error) => any) => {
            callback(<any> {code: 'foo'});
        });
        const notFoundError = new Error();
        (<any> notFoundError).code = 'ENOENT';
        try { await fileCache.del('foo'); } catch (e) {} // tslint:disable-line:no-empty
        expect(unlinkStub.callCount).to.equal(3);
    });

    it('FileCache::gc', async() => {
        const clock = sandbox.useFakeTimers(Date.now());
        fileCache = new FileCache(tmpDir, 1);

        await fileCache.set('barfoo', 'baz', 2);
        const newFile = `barfoo.${Date.now() + 2000}.cache`;
        expect(fs.readFileSync(path.resolve(tmpDir, newFile)).toString()).to.equal('"baz"');

        clock.tick(3000);
        sandbox.restore();
        await sleep(250);
        expect(() => fs.readFileSync(path.resolve(tmpDir, newFile))).to.throw();
    });
});
