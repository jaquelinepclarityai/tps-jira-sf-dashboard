import { NextResponse } from "next/server";

const SHEET_ID = "1e6CRPOHJuHDaLqiHfTqIlaf8zW_3pVWBgGadeFIN7Xw";
const SHEET_GID = "94718738";

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

export async function GET() {
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

    const res = await fetch(csvUrl, { cache: "no-store" });
    const text = await res.text();
    const rows = parseCSV(text);

    if (rows.length < 2) {
      return NextResponse.json({ error: "No data found" });
    }

    const headers = rows[0];

    // Find the Federale Assurance row
    const federaleRowIndex = rows.findIndex(row =>
      row.some(cell => cell.includes("Fédérale Assurance") || cell.includes("Federale Assurance"))
    );

    if (federaleRowIndex === -1) {
      return NextResponse.json({
        error: "Federale Assurance not found",
        headers,
        totalRows: rows.length,
        sampleRow: rows[1],
      });
    }

    const federaleRow = rows[federaleRowIndex];

    // Create a detailed breakdown
    const federaleData: any = {};
    headers.forEach((header, idx) => {
      const columnLetter = String.fromCharCode(65 + (idx % 26)); // A, B, C...
      federaleData[`${columnLetter} (${idx}): ${header}`] = federaleRow[idx] || "";
    });

    // Find all cells with 006 IDs
    const cellsWithOppId: any[] = [];
    federaleRow.forEach((cell, idx) => {
      if (cell && cell.trim().startsWith("006")) {
        const columnLetter = String.fromCharCode(65 + (idx % 26));
        cellsWithOppId.push({
          column: columnLetter,
          index: idx,
          header: headers[idx],
          value: cell,
        });
      }
    });

    return NextResponse.json({
      totalRows: rows.length,
      totalColumns: headers.length,
      federaleRowIndex,
      headers: headers.map((h, i) => `${String.fromCharCode(65 + (i % 26))}: ${h}`),
      federaleData,
      cellsWithOppId,
      rawFederaleRow: federaleRow,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) });
  }
}