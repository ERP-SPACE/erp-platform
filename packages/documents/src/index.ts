export * from "./sales-document.js";
export * from "./words.js";

/** BullMQ queue the API sends HTML to; the worker answers with the PDF (base64). */
export const DOCUMENT_QUEUE = "erp-documents";

export interface DocumentJobData {
  html: string;
}
export interface DocumentJobResult {
  pdfBase64: string;
}
