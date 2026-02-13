import { NextResponse } from "next/server";
import type { SalesforceOpportunity } from "@/lib/types";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const TAB_NAME = "SF Opps info";
const SHEET_GID = "94718738";

// ──────────────────────────────────────────────
// 15-to-18 Character Converter
// ──────────────────────────────────────────────
function to18CharId(id: string): string {
  if (!id) return "";
  id = id.trim();
  if (id.length === 18) return id;
  if (id.length !== 15) return id;

  let suffix = "";
  for (let i = 0; i < 3; i++) {
    let flags = 0;
    for (let j = 0; j < 5; j++) {
      const char = id.charAt(i * 5 + j);
      if (char >= "A" && char <= "Z") {
        flags += 1 << j;
      }
    }
    suffix += "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345".charAt(flags);
  }
  return id + suffix;
}

// ──────────────────────────────────────────────
// CSV PARSER
// ──────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  const cleanText = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if (char === "\n" && !insideQuotes) {
      currentRow.push(currentVal.trim());
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }

  return rows;
}

// ──────────────────────────────────────────────
// COLUMN MAPPING - Based on your Google Sheet structure
// ──────────────────────────────────────────────
const COLUMN_MAP = {
  // Update these based on actual column positions (A=0, B=1, C=2, etc.)
  OPPORTUNITY_NAME: 0,      // Column A - Adjust if needed
  ACCOUNT_NAME: 1,          // Column B - Adjust if needed
  STAGE: 2,                 // Column C - Adjust if needed
  CLOSE_DATE: 3,            // Column D - Adjust if needed
  AMOUNT: 4,                // Column E - Adjust if needed
  OWNER: 5,                 // Column F - Adjust if needed
  ACCESS_METHOD: 6,         // Column G - Adjust if needed
  OPPORTUNITY_ID: 16,       // Column Q (A=0, so Q=16)
};

function parseAmount(value: string): number | null {
  if (!value) return null;
  let cleaned = value.replace(/[^0-9.,-]/g, "");
  const europeanMatch = cleaned.match(/^([0-9.]*),(\d{1,2})$/);
  if (europeanMatch) {
    cleaned = europeanMatch[1].replace(/\./g, "") + "." + europeanMatch[2];
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function mapRowToOpportunity(row: string[], idx: number): SalesforceOpportunity {
  const oppId = row[COLUMN_MAP.OPPORTUNITY_ID]?.trim() || "";
  const validOppId = (oppId.startsWith("006") && (oppId.length === 15 || oppId.length === 18))
    ? to18CharId(oppId)
    : "";

  return {
    id: validOppId || `row-${idx}`,
    name: row[COLUMN_MAP.OPPORTUNITY_NAME] || "",
    accountName: row[COLUMN_MAP.ACCOUNT_NAME] || "",
    stageName: row[COLUMN_MAP.STAGE] || "",
    closeDate: row[COLUMN_MAP.CLOSE_DATE] || "",
    amount: parseAmount(row[COLUMN_MAP.AMOUNT] || ""),
    ownerName: row[COLUMN_MAP.OWNER] || "",
    accessMethod: row[COLUMN_MAP.ACCESS_METHOD] || "",
    probability: null,
    createdDate: "",
    lastModifiedDate: "",
    url: validOppId
      ? `https://clarityai.lightning.force.com/lightning/r/Opportunity/${validOppId}/view`
      : "",
  };
}

// ──────────────────────────────────────────────
// FETCH DATA
// ──────────────────────────────────────────────
async function fetchViaServiceAccount(): Promise<string[][] | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey || !rawKey.includes("BEGIN PRIVATE KEY")) return null;

  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email,
      key: rawKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${TAB_NAME}'`,
    });
    return res.data.values as string[][] || null;
  } catch (e) {
    console.error("Service Account Error:", e);
    return null;
  }
}

async function fetchViaCSV(): Promise<string[][] | null> {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
  ];

  for (const csvUrl of urls) {
    try {
      const res = await fetch(csvUrl, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        if (!text.trim().startsWith("<")) {
          const rows = parseCSV(text);
          if (rows.length > 0) return rows;
        }
      }
    } catch (e) {
      console.error("CSV fetch failed", e);
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// ROUTE HANDLER
// ──────────────────────────────────────────────
export async function GET() {
  try {
    let rawRows: string[][] | null = null;
    let source = "";

    // 1. Try Service Account
    rawRows = await fetchViaServiceAccount();
    if (rawRows) source = "service-account";

    // 2. Fallback to CSV
    if (!rawRows) {
      rawRows = await fetchViaCSV();
      if (rawRows) source = "csv";
    }

    if (!rawRows || rawRows.length < 2) {
      return NextResponse.json({
        error: "No data",
        configured: false
      }, { status: 200 });
    }

    // Skip header row
    const dataRows = rawRows.slice(1);

    // Filter and map opportunities
    const filterOpps = (stageKeyword: string): SalesforceOpportunity[] => {
      return dataRows
        .filter(row => {
          const stage = (row[COLUMN_MAP.STAGE] || "").toLowerCase();
          const matchesStage = stage.includes(stageKeyword);

          // Check if we should filter by Access Method
          const accessMethod = (row[COLUMN_MAP.ACCESS_METHOD] || "").toLowerCase();
          const hasAccessMethod = accessMethod.length > 0;

          if (!hasAccessMethod) return matchesStage;

          const isApiOrFeed =
            accessMethod.includes("api") ||
            accessMethod.includes("data feed") ||
            accessMethod.includes("datafeed");

          return matchesStage && isApiOrFeed;
        })
        .map((row, idx) => mapRowToOpportunity(row, idx));
    };

    const dueDiligence = filterOpps("due diligence");
    const standingApart = filterOpps("standing apart");

    return NextResponse.json({
      dueDiligence,
      standingApart,
      totalDueDiligence: dueDiligence.length,
      totalStandingApart: standingApart.length,
      configured: true,
      source,
    });
  } catch (error) {
    console.error("Salesforce route error:", error);
    return NextResponse.json(
      {
        error: String(error),
        configured: true,
        source: "error"
      },
      { status: 200 }
    );
  }
}