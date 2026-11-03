import ExcelJS from "exceljs";

export type SheetColumn = { header: string; key: string; width: number };

/// ورقة عربية من اليمين إلى اليسار بعناوين منسقة وصف عناوين مثبت
export function addSheet(wb: ExcelJS.Workbook, name: string, columns: SheetColumn[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
  ws.columns = columns;
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23415F" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
  return ws;
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة العمل الإداري";
  wb.created = new Date();
  return wb;
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
