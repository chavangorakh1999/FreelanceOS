import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright-core';
import { DomainError } from '../common/errors';

/**
 * HTML → PDF through headless Chromium behind a small interface, so it can move to a worker or
 * a hosted renderer later (PRD §12). Browser path: CHROMIUM_PATH, else Playwright's default.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly log = new Logger('Pdf');
  private browser?: Promise<Browser>;
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private static readonly MAX_CONCURRENT = 2;

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .catch((e) => { this.browser = undefined; throw e; });
    return this.browser;
  }

  private async acquire() {
    if (this.active >= PdfService.MAX_CONCURRENT) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
  }
  private release() { this.active--; this.waiters.shift()?.(); }

  async render(html: string): Promise<Buffer> {
    await this.acquire();
    try {
      const browser = await this.launch();
      const context = await browser.newContext({ javaScriptEnabled: false }); // documents never need scripts
      try {
        const page = await context.newPage();
        // Documents are self-contained; refuse any network fetch a hostile string might trigger.
        await page.route('**/*', (route) => (route.request().url().startsWith('data:') || route.request().url() === 'about:blank' ? route.continue() : route.abort()));
        await page.setContent(html, { waitUntil: 'load' });
        return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
      } finally {
        await context.close();
      }
    } catch (e) {
      this.log.error(e);
      throw new DomainError('PDF_UNAVAILABLE', 'PDF generation is unavailable right now. Try again shortly.', 503);
    } finally {
      this.release();
    }
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser.catch(() => undefined))?.close();
  }
}
