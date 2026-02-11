import { NextResponse } from "next/server";
import { google } from "googleapis";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";

export async function GET() {
  const diagnostics: Record<string, unknown> = {};

  // 1. Check env vars
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  diagnostics.emailSet = !!email;
  diagnostics.emailValue = email ? email.substring(0, 20) + "..." : "NOT SET";
  diagnostics.keySet = !!rawKey;
  diagnostics.keyLength = rawKey?.length ?? 0;
  diagnostics.keyStartsWith = rawKey ? rawKey.substring(0, 30) : "NOT SET";

  if (!email || !rawKey) {
    return NextResponse.json({
      ...diagnostics,
      error: "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    });
  }

  // 2. Try authenticating
  const privateKey = rawKey.replace(/\\n/g, "\n");
  diagnostics.processedKeyStartsWith = privateKey.substring(0, 40);
  diagnostics.processedKeyLength = privateKey.length;
  diagnostics.keyContainsBeginMarker = privateKey.includes("-----BEGIN");

  try {
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    diagnostics.authCreated = true;

    // 3. Try fetching data
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${TAB_NAME}'`,
    });

    diagnostics.apiStatus = res.status;
    diagnostics.totalRows = res.data.values?.length ?? 0;

    if (res.data.values && res.data.values.length > 0) {
      diagnostics.headers = res.data.values[0];
      diagnostics.sampleRow = res.data.values.length > 1 ? res.data.values[1] : "no data rows";
    } else {
      diagnostics.dataNote = "API returned no values";
    }

    diagnostics.success = true;
  } catch (err: unknown) {
    diagnostics.success = false;
    diagnostics.error = String(err);
    if (err && typeof err === "object" && "response" in err) {
      const gErr = err as { response?: { status?: number; data?: unknown } };
      diagnostics.errorStatus = gErr.response?.status;
      diagnostics.errorData = gErr.response?.data;
    }
  }

  return NextResponse.json(diagnostics);
}
