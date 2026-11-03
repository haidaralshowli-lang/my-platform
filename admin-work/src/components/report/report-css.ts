/// أنماط التقرير: نص CSS مستقل عن Tailwind حتى يُعرض التقرير بالشكل نفسه في الصفحة وفي ملف PDF المولَّد على الخادم
export const REPORT_CSS = `
.rpt { color: #11131a; font-size: 13px; line-height: 1.6; }
.rpt-head { border-bottom: 3px solid #3c8d86; padding-bottom: 12px; margin-bottom: 16px; }
.rpt-org { font-size: 12px; color: #5a6070; }
.rpt-title { font-size: 22px; font-weight: 700; color: #23415f; margin: 2px 0 4px; }
.rpt-desc { color: #5a6070; margin: 0; }
.rpt-meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 10px; font-size: 12px; }
.rpt-meta b { color: #23415f; }
.rpt-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 18px; }
.rpt-stat { border: 1px solid #d8dbe2; border-inline-start: 4px solid #23415f; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
.rpt-stat-label { font-size: 11.5px; color: #5a6070; }
.rpt-stat-value { font-size: 20px; font-weight: 700; direction: ltr; unicode-bidi: isolate; display: inline-block; }
.rpt-stat-hint { font-size: 11px; color: #5a6070; }
.rpt-sec { margin-bottom: 18px; }
.rpt-sec h2 { font-size: 15px; color: #23415f; margin: 0 0 6px; padding-inline-start: 8px; border-inline-start: 3px solid #3c8d86; break-after: avoid; }
.rpt-note { font-size: 11.5px; color: #5a6070; margin: 0 0 6px; }
.rpt-scroll { overflow-x: auto; }
.rpt table { width: 100%; border-collapse: collapse; font-size: 12px; }
.rpt th { background: #23415f; color: #fff; font-weight: 600; text-align: start; padding: 6px 8px; white-space: nowrap; }
.rpt td { border-bottom: 1px solid #e3e5ea; padding: 5px 8px; vertical-align: top; }
.rpt tbody tr:nth-child(even) td { background: #f6f7f9; }
.rpt tr { break-inside: avoid; }
.rpt thead { display: table-header-group; }
.rpt .num { direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
.rpt-empty { color: #5a6070; font-size: 12px; padding: 8px; border: 1px dashed #d8dbe2; border-radius: 6px; }
.rpt-foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #d8dbe2; font-size: 11px; color: #5a6070; }
`;
