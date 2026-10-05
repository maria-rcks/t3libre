// @effect-diagnostics nodeBuiltinImport:off - Owns Playwright resources outside the Effect runtime.
import { INCOGNITO_BROWSER_PROFILE_ID } from "@t3tools/contracts";
import { constVoid } from "effect/Function";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { Browser, BrowserContext } from "playwright-core";

import type { ServerBrowserLaunch } from "./ServerBrowserToolchain.ts";

interface Options {
  readonly profilesDir: string;
  readonly resolve: () => Promise<ServerBrowserLaunch>;
  readonly env?: NodeJS.ProcessEnv;
  readonly onContextClose?: (context: BrowserContext) => void;
}

/** Persistent human profiles keep their storage; isolated agents share a browser, never a context. */
export class ServerBrowserContexts {
  private readonly options: Options;
  private readonly contexts = new Map<string, Promise<BrowserContext>>();
  private browser: Promise<Browser> | undefined;
  private closing: Promise<void> | undefined;

  constructor(options: Options) {
    this.options = options;
  }

  private async launchOptions() {
    const resolved = await this.options.resolve();
    const env = { ...(this.options.env ?? process.env), ...resolved.env };
    return {
      executablePath: resolved.executablePath,
      env,
      args: ["--disable-gpu", "--force-device-scale-factor=2"],
      headless: true,
      // Only an explicit operator opt-out disables sandboxing. Launch errors never do.
      chromiumSandbox: env.T3CODE_SERVER_BROWSER_SANDBOX !== "0",
    };
  }

  private sharedBrowser() {
    if (!this.browser) {
      const launched = this.launchOptions().then(async (options) => {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.launch(options);
        browser.on("disconnected", () => {
          if (this.browser === launched) this.browser = undefined;
        });
        return browser;
      });
      this.browser = launched;
      void launched.catch(() => {
        if (this.browser === launched) this.browser = undefined;
      });
    }
    return this.browser;
  }

  contextFor(profileId: string, isolationKey?: string): Promise<BrowserContext> {
    if (this.closing) return Promise.reject(new Error("The preview browser is closed."));
    const key = JSON.stringify([profileId, isolationKey ?? null]);
    const cached = this.contexts.get(key);
    if (cached) return cached;
    const pending = this.createContext(profileId, isolationKey).then(async (context) => {
      context.on("close", () => {
        if (this.contexts.get(key) === pending) this.contexts.delete(key);
        this.options.onContextClose?.(context);
      });
      for (const page of context.pages()) await page.close().catch(constVoid);
      if (this.closing) {
        await context.close().catch(constVoid);
        throw new Error("The preview browser is closed.");
      }
      return context;
    });
    this.contexts.set(key, pending);
    void pending.catch(() => {
      if (this.contexts.get(key) === pending) this.contexts.delete(key);
    });
    return pending;
  }

  private async createContext(profileId: string, isolationKey?: string) {
    const contextOptions = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
    if (isolationKey !== undefined || profileId === INCOGNITO_BROWSER_PROFILE_ID) {
      const browser = await this.sharedBrowser();
      return browser.newContext(contextOptions);
    }
    const directory = this.profileDirectory(profileId);
    const options = await this.launchOptions();
    const { chromium } = await import("playwright-core");
    await NodeFSP.mkdir(directory, { recursive: true });
    return chromium.launchPersistentContext(directory, { ...options, ...contextOptions });
  }

  private profileDirectory(profileId: string) {
    const encoded = encodeURIComponent(profileId);
    return NodePath.join(
      this.options.profilesDir,
      profileId === "." || profileId === ".." ? encoded.replaceAll(".", "%2E") : encoded,
    );
  }

  /** Closes a human profile's persistent context, ending its tabs, then deletes its storage. */
  async clearProfile(profileId: string) {
    if (profileId === INCOGNITO_BROWSER_PROFILE_ID) return;
    const key = JSON.stringify([profileId, null]);
    const pending = this.contexts.get(key);
    if (pending) {
      this.contexts.delete(key);
      const context = await pending.catch(() => undefined);
      await context?.close();
    }
    await NodeFSP.rm(this.profileDirectory(profileId), { recursive: true, force: true });
  }

  close() {
    this.closing ??= this.dispose();
    return this.closing;
  }

  private async dispose() {
    await Promise.allSettled(
      [...this.contexts.values()].map(async (pending) => (await pending).close()),
    );
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close().catch(constVoid);
    this.contexts.clear();
  }
}
