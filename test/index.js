//@ts-check
"use strict";

const Fs = require("fs");
const Util = require("util");

const Code = require("code");
const Lab = require("lab");
const Puppeteer = require("puppeteer");

const readFile = Util.promisify(Fs.readFile);

exports.lab = Lab.script();

const { after, afterEach, before, beforeEach, describe, it } = exports.lab;
const { expect } = Code;

describe("the runtime", { timeout: 20000 }, () => {
  const runtimeCode = readFile(require.resolve("../"), "utf8");

  describe("using the ESM cdn", () => {
    testRuntimeVariety({ runtimeCode, useSystem: false });
  });

  describe("using the System.register cdn", () => {
    testRuntimeVariety({ runtimeCode, useSystem: true });
  });
});

function testRuntimeVariety({ runtimeCode, useSystem }) {
  /** @type {import('puppeteer').Browser}  */
  let browser;
  /** @type {import('puppeteer').Page}  */
  let page;

  before(async () => {
    browser = await Puppeteer.launch();
  });

  after(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();

    page.on("console", consoleMessage => {
      console.log("Console:", consoleMessage.text());
    });

    page.on("pageerror", err => {
      console.log("Error:", err.stack || err.message || err);
    });
  });

  afterEach(async () => {
    await page.close();
  });

  it("will load the runtime", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      return new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents() {}
        }
      });
    }, useSystem);

    expect(result).to.be.an.object();
  });

  it("will calculate the correct local root", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents() {}
        }
      });
      const pathname = await runtime.resolve("./package.json");

      return { pathname };
    }, useSystem);

    expect(result).to.be.an.object();
    expect(result.pathname).to.equal("about:blank/package.json");
  });

  it("will load a json array", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            if (pathname === "array.json")
              return JSON.stringify(["a", "b", "c"]);

            throw new Error("Not found");
          }
        }
      });

      const arr = await runtime.import("./array.json");

      return arr;
    }, useSystem);

    expect(result).to.be.an.array();
    expect(result).to.equal(["a", "b", "c"]);
  });

  it("will load lodash@3 and return its VERSION property", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            if (pathname === "package.json")
              return JSON.stringify({
                dependencies: {
                  lodash: "3.x"
                }
              });

            throw new Error("Not found");
          }
        }
      });

      const _ = await runtime.import("lodash");

      return _.VERSION;
    }, useSystem);

    expect(result).to.be.a.string();
    expect(result).to.match(/^3\.\d+\.\d+/);
  });

  it("will load lodash@3 and return its VERSION property using a custom bare dependency resolver", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const cdnUrl = useSystem
        ? window["PlnkrRuntime"].CDN_SYSTEM_URL
        : window["PlnkrRuntime"].CDN_ESM_URL;

      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          resolveBareDependency(key) {
            if (key === "lodash") return `${cdnUrl}/${key}@3`;
          }
        }
      });

      const _ = await runtime.import("lodash");

      return _.VERSION;
    }, useSystem);

    expect(result).to.be.a.string();
    expect(result).to.match(/^3\.\d+\.\d+/);
  });

  it("will render a react component to a string", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "package.json": JSON.stringify({
          dependencies: {
            react: "16.x",
            "react-dom": "16.x"
          }
        }),
        "Hello.js": `
                    import React, { Component } from 'react';

                    export default class Hello extends Component {
                        render() {
                            return <h1>Hello {this.props.name}</h1>;
                        }
                    }
                `,
        "index.js": `
                    import React from 'react';
                    import { renderToString } from 'react-dom/server';

                    import Hello from './Hello';

                    export const markup = renderToString(<Hello name="World"></Hello>);
                `
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getCanonicalPath(pathname) {
            switch (pathname) {
              case "Hello":
                return "Hello.js";
              case "index":
                return "index.js";
            }
            return files[pathname]
              ? pathname
              : Promise.reject(new Error("Not found"));
          },
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const { markup } = await runtime.import("./index.js");

      return markup;
    }, useSystem);

    expect(result).to.be.a.string();
    expect(result)
      .to.startWith("<h1")
      .and.to.endWith("</h1>");
    expect(result)
      .to.contain("Hello")
      .and.to.contain("World");
  });

  it("will correctly invalidate dependents", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "dependency.js": `
                    export const dependency = Date.now();
                `,
        "index.js": `
                    export { dependency } from './dependency';

                    export const index = Date.now();
                `
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getCanonicalPath(pathname) {
            switch (pathname) {
              case "dependency":
                return "dependency.js";
              case "index":
                return "index.js";
            }
            return files[pathname]
              ? pathname
              : Promise.reject(new Error("Not found"));
          },
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const initial = await runtime.import("./index");

      await runtime.invalidate("./dependency");

      const updated = await runtime.import("./index");

      return { initial, updated };
    }, useSystem);

    expect(result.updated.dependency)
      .to.be.a.number()
      .and.greaterThan(result.initial.dependency);
    expect(result.updated.index)
      .to.be.a.number()
      .and.greaterThan(result.initial.index);
  });

  it("will load css files", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "style.css": "h1 { color: red; }",
        "index.js": `
                    export { element, markup } from './style.css';
                `
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const { element, markup } = await runtime.import("./index.js");

      return {
        elementToString: element.toString(),
        markup
      };
    }, useSystem);

    expect(result).to.be.an.object();
    expect(result.markup).to.equal("h1 { color: red; }");
    expect(result.elementToString).to.equal("[object HTMLStyleElement]");
  });

  it("will load less files", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "style.less": "@color: red; h1 { color: @color; }",
        "index.js": `
                    export { element, markup } from './style.less';
                `
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const { element, markup } = await runtime.import("./index.js");

      return {
        elementToString: element.toString(),
        markup
      };
    }, useSystem);

    expect(result).to.be.an.object();
    expect(result.markup).to.equal("h1 {\n  color: red;\n}\n");
    expect(result.elementToString).to.equal("[object HTMLStyleElement]");
  });

  it("will load vue files", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "package.json": JSON.stringify({
          dependencies: {
            vue: "2"
          }
        }),
        "App.vue": `
                    <template>
                        <h1>Hello {{ name }}</h1>
                    </template>
                    <style scoped>
                        h1 {
                            color: blue;
                        }
                    </style>
                    <script>
                        export default {
                            data: function() {
                                return {
                                    name: 'Runtime',
                                };
                            },
                        }
                    </script>`,
        "index.js": `
                    import Vue from 'vue/dist/vue';

                    import App from './App.vue';

                    new Vue({
                        el: '#root',
                        template: '<App/>',
                        components: { App },
                    });`
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const host = document.createElement("div");
      host.id = "root";

      document.body.appendChild(host);

      await runtime.import("./index.js");

      return {
        markup: document.body.innerHTML,
        color: getComputedStyle(document.body.children[0]).getPropertyValue(
          "color"
        )
      };
    }, useSystem);

    expect(result).to.be.an.object();
    expect(result.markup)
      .startsWith("<h1")
      .and.contains("Hello Runtime")
      .and.endsWith("</h1>");
    expect(result.color).to.equal("rgb(0, 0, 255)");
  });

  it("will load vue files having style blocks requiring less preprocessing", async () => {
    const content = await runtimeCode;

    await page.addScriptTag({ content });

    const result = await page.evaluate(async function(useSystem) {
      window["PLNKR_RUNTIME_USE_SYSTEM"] = useSystem;

      const files = {
        "package.json": JSON.stringify({
          dependencies: {
            vue: "2"
          }
        }),
        "App.vue": `
                    <template>
                        <h1>Hello {{ name }}</h1>
                    </template>
                    <style lang="less">
                        @color: blue;
                        h1 {
                            color: @color;
                        }
                    </style>
                    <script>
                        export default {
                            data: function() {
                                return {
                                    name: 'Runtime',
                                };
                            },
                        }
                    </script>`,
        "index.js": `
                    import Vue from 'vue/dist/vue';

                    import App from './App.vue';

                    new Vue({
                        el: '#root',
                        template: '<App/>',
                        components: { App },
                    });`
      };
      const runtime = new window["PlnkrRuntime"].Runtime({
        host: {
          getFileContents(pathname) {
            return files[pathname]
              ? files[pathname]
              : Promise.reject(new Error("Not found"));
          }
        }
      });

      const host = document.createElement("div");
      host.id = "root";

      document.body.appendChild(host);

      await runtime.import("./index.js");

      return {
        markup: document.body.innerHTML,
        color: getComputedStyle(document.body.children[0]).getPropertyValue(
          "color"
        )
      };
    }, useSystem);

    expect(result).to.be.an.object();
    expect(result.markup)
      .startsWith("<h1")
      .and.contains("Hello Runtime")
      .and.endsWith("</h1>");
    expect(result.color).to.equal("rgb(0, 0, 255)");
  });
}
