/** Map Better Auth TOTP errors to operator-friendly copy (avoid blaming the code for session/CORS issues). */
export function totpVerifyErrorMessage(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  const msg = error.message ?? "";
  const code = error.code ?? "";
  if (code === "INVALID_TWO_FACTOR_COOKIE" || /two factor cookie/i.test(msg)) {
    return "Your sign-in session expired. Sign in again and enter a new code right away.";
  }
  if (code === "INVALID_CODE" || /invalid code/i.test(msg)) {
    return "That code didn't match. If you refreshed this page or scanned an older QR, use “Reset QR” below, scan again, then try a new code.";
  }
  if (error.status === 403 || /origin/i.test(msg)) {
    return "Use the same address bar host you signed in with (http://localhost:5173, not 127.0.0.1).";
  }
  if (msg) return msg;
  return "Verification failed. Try again in a few seconds.";
}
