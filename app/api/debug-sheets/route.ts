import { NextResponse } from "next/server";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";

export async function GET() {
  const diagnostics: Record<string, unknown> = {};

  const apiKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  diagnostics.apiKeySet = !!apiKey;
  diagnostics.apiKeyLength = apiKey?.length ?? 0;

  if (!apiKey) {
    return NextResponse.json({
      ...diagnostics,
      error: "Missing GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    });
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}?key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      const errText = await res.text();
      diagnostics.fetchStatus = res.status;
      diagnostics.fetchError = errText.substring(0, 500);
      return NextResponse.json(diagnostics);
    }

    const data = await res.json();
    const values = data.values as string[][] | undefined;
    diagnostics.totalRows = values?.length ?? 0;
    diagnostics.headers = values?.[0] ?? [];

    if (values && values.length > 1) {
      const headers = values[0];
      const rows = values.slice(1).map((row: string[]) => {
        const obj: Record<string, string> = {};
        headers.forEach((h: string, i: number) => (obj[h] = row[i] || ""));
        return obj;
      });

      // Find stage and access method columns
      const stageCol = headers.find(
        (h: string) => h.toLowerCase().includes("stage")
      );
      const accessCol = headers.find(
        (h: string) =>
          h.toLowerCase().includes("access") &&
          h.toLowerCase().includes("method")
      );

      diagnostics.stageColumnName = stageCol ?? "NOT FOUND";
      diagnostics.accessMethodColumnName = accessCol ?? "NOT FOUND";

      const uniqueStages = new Set<string>();
      const uniqueAccessMethods = new Set<string>();

      rows.forEach((row) => {
        if (stageCol && row[stageCol]) uniqueStages.add(row[stageCol]);
        if (accessCol && row[accessCol]) uniqueAccessMethods.add(row[accessCol]);
      });

      diagnostics.uniqueStages = [...uniqueStages];
      diagnostics.uniqueAccessMethods = [...uniqueAccessMethods];
      diagnostics.sampleRows = rows.slice(0, 3);
    }

    diagnostics.success = true;
  } catch (err) {
    diagnostics.success = false;
    diagnostics.error = String(err);
  }

  return NextResponse.json(diagnostics);
}
