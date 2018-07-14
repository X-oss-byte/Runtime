//@ts-check
'use strict';

const Fs = require('fs');
const Util = require('util');

const Code = require('code');
const Lab = require('lab');
const Puppeteer = require('puppeteer');

const readFile = Util.promisify(Fs.readFile);

exports.lab = Lab.script();

const { after, before, describe, it } = exports.lab;
const { expect } = Code;

describe('the runtime', { timeout: 20000 }, () => {
    const runtimeCode = readFile(require.resolve('../'), 'utf8');

    describe('using the ESM cdn', () => {
        testRuntimeVariety({ runtimeCode, useSystem: false });
    });

    describe('using the System.register cdn', () => {
        testRuntimeVariety({ runtimeCode, useSystem: true });
    });
});

function testRuntimeVariety({ runtimeCode, useSystem }) {
    /** @type {Puppeteer.Browser}  */
    let browser;

    before(async () => {
        browser = await Puppeteer.launch();
    });

    after(async () => {
        await browser.close();
    });

    it('will load the runtime', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            return new window['@plnkr/runtime'].Runtime({
                host: {
                    getFileContents() {},
                },
            });
        }, useSystem);

        expect(result).to.be.an.object();
    });

    it('will calculate the correct local root', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getFileContents() {},
                },
            });
            const pathname = await runtime.resolve('./package.json');

            return { pathname };
        }, useSystem);

        expect(result).to.be.an.object();
        expect(result.pathname).to.equal('about:blank/package.json');
    });

    it('will load lodash@3 and return its VERSION property', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getFileContents(pathname) {
                        if (pathname === 'package.json')
                            return JSON.stringify({
                                dependencies: {
                                    lodash: '3.x',
                                },
                            });
                    },
                },
            });

            const _ = await runtime.import('lodash');

            return _.VERSION;
        }, useSystem);

        expect(result).to.be.a.string();
        expect(result).to.match(/^3\.\d+\.\d+/);
    });

    it('will render a react component to a string', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const files = {
                'package.json': JSON.stringify({
                    dependencies: {
                        react: '16.x',
                        'react-dom': '16.x',
                    },
                }),
                'Hello.js': `
                    import React, { Component } from 'react';

                    export default class Hello extends Component {
                        render() {
                            return <h1>Hello {this.props.name}</h1>;
                        }
                    }
                `,
                'index.js': `
                    import React from 'react';
                    import { renderToString } from 'react-dom/server';

                    import Hello from './Hello';

                    export const markup = renderToString(<Hello name="World"></Hello>);
                `,
            };
            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getCanonicalPath(pathname) {
                        switch (pathname) {
                            case 'Hello':
                                return 'Hello.js';
                            case 'index':
                                return 'index.js';
                        }
                        return pathname;
                    },
                    getFileContents(pathname) {
                        return files[pathname];
                    },
                },
            });

            const { markup } = await runtime.import('./index.js');

            return markup;
        }, useSystem);

        expect(result).to.be.a.string();
        expect(result)
            .to.startWith('<h1')
            .and.to.endWith('</h1>');
        expect(result)
            .to.contain('Hello')
            .and.to.contain('World');
    });

    it('will correctly invalidate dependents', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const files = {
                'dependency.js': `
                    export const dependency = Date.now();
                `,
                'index.js': `
                    export { dependency } from './dependency';

                    export const index = Date.now();
                `,
            };
            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getCanonicalPath(pathname) {
                        switch (pathname) {
                            case 'dependency':
                                return 'dependency.js';
                            case 'index':
                                return 'index.js';
                        }
                        return pathname;
                    },
                    getFileContents(pathname) {
                        return files[pathname];
                    },
                },
            });

            const initial = await runtime.import('./index');

            await runtime.invalidate('./dependency');

            const updated = await runtime.import('./index');

            return { initial, updated };
        }, useSystem);

        expect(result.updated.dependency)
            .to.be.a.number()
            .and.greaterThan(result.initial.dependency);
        expect(result.updated.index)
            .to.be.a.number()
            .and.greaterThan(result.initial.index);
    });

    it('will load css files', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const files = {
                'style.css': 'h1 { color: red; }',
                'index.js': `
                    export { element, markup } from './style.css';
                `,
            };
            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getFileContents(pathname) {
                        return files[pathname];
                    },
                },
            });

            const { element, markup } = await runtime.import('./index.js');

            return {
                elementToString: element.toString(),
                markup,
            };
        }, useSystem);

        expect(result).to.be.an.object();
        expect(result.markup).to.equal('h1 { color: red; }');
        expect(result.elementToString).to.equal('[object HTMLStyleElement]');
    });

    it('will load less files', async () => {
        const content = await runtimeCode;
        const page = await browser.newPage();

        // page.on('console', e => console.log(e.text()));
        // page.on('pageerror', e => console.trace(e.originalErr || e));

        await page.addScriptTag({ content });

        const result = await page.evaluate(async function(useSystem) {
            window['PLNKR_RUNTIME_USE_SYSTEM'] = useSystem;

            const files = {
                'style.less': '@color: red; h1 { color: @color; }',
                'index.js': `
                    export { element, markup } from './style.less';
                `,
            };
            const runtime = new window['@plnkr/runtime'].Runtime({
                host: {
                    getFileContents(pathname) {
                        return files[pathname];
                    },
                },
            });

            const { element, markup } = await runtime.import('./index.js');

            return {
                elementToString: element.toString(),
                markup,
            };
        }, useSystem);

        expect(result).to.be.an.object();
        expect(result.markup).to.equal('h1 {\n  color: red;\n}\n');
        expect(result.elementToString).to.equal('[object HTMLStyleElement]');
    });
}
