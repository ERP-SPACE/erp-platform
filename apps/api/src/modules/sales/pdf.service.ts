import { DOCUMENT_QUEUE, type DocumentJobData, type DocumentJobResult } from "@erp/documents";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, QueueEvents } from "bullmq";
import { ENV, type Env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

const TIMEOUT_MS = 30_000;

/**
 * HTML → PDF. By default the worker's headless Chromium does it (the API stays light) and the
 * API waits for the answer; PDF_RENDERER=inline runs Chromium here instead (tests).
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private queue: Queue<DocumentJobData, DocumentJobResult> | null = null;
  private events: QueueEvents | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async render(html: string): Promise<Buffer> {
    if (this.env.PDF_RENDERER === "inline") {
      const { htmlToPdf } = await import("@erp/documents/pdf");
      return Buffer.from(await htmlToPdf(html));
    }
    this.queue ??= new Queue(DOCUMENT_QUEUE, {
      connection: { url: this.env.REDIS_URL },
      prefix: this.env.QUEUE_PREFIX,
    });
    this.events ??= new QueueEvents(DOCUMENT_QUEUE, {
      connection: { url: this.env.REDIS_URL },
      prefix: this.env.QUEUE_PREFIX,
    });
    const job = await this.queue.add(
      "document.pdf",
      { html },
      { removeOnComplete: true, removeOnFail: 50, attempts: 1 },
    );
    try {
      const result = await job.waitUntilFinished(this.events, TIMEOUT_MS);
      return Buffer.from(result.pdfBase64, "base64");
    } catch {
      throw new AppError(
        503,
        "PDF_UNAVAILABLE",
        "The PDF couldn't be made right now. Check that the worker is running, then try again.",
      );
    }
  }

  async onModuleDestroy() {
    await this.events?.close();
    await this.queue?.close();
    if (this.env.PDF_RENDERER === "inline") {
      const { closePdfBrowser } = await import("@erp/documents/pdf");
      await closePdfBrowser();
    }
  }
}
