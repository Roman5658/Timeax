import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildExportWorkbook, type ExportWorkbookInput } from "../domain/workbook";
import { workbookPreview } from "../domain/preview";
export default function WorkbookPreview({input}: {input:ExportWorkbookInput}) {
 const {t}=useTranslation(); const [selected,setSelected]=useState("");
 const signature=JSON.stringify(input);
 const sheets=useMemo(()=>input.columns.length ? workbookPreview(buildExportWorkbook(input),input.language) : [],[signature]);
 const sheet=sheets.find(s=>s.name===selected) ?? sheets[0];
 return <section className="workbook-preview" aria-label={t("exports.workbookPreview")}><h2>{t("exports.workbookPreview")}</h2>
 <p className="export-scope-summary"><strong>{input.organizationName}</strong> · {input.dates[0]} — {input.dates.at(-1)}</p>
 <details><summary>{t("exports.selectedFactories")} ({input.factories.length}) · {t("exports.selectedWorkers")} ({input.workers.length})</summary><p>{input.factories.map(f=>f.name).join("; ")}</p><p>{input.workers.map(w=>w.name).join("; ")}</p></details>
 <label className="field-label"><span>{t("exports.sheet")} ({sheets.length})</span><select value={sheet?.name ?? ""} onChange={e=>setSelected(e.target.value)}>{sheets.map(s=><option key={s.name}>{s.name}</option>)}</select></label>
 {sheet ? <><p role="status">{t("exports.rowsShown",{shown:Math.min(sheet.rows.length,100),total:sheet.rows.length})}</p><div className="table-scroll" tabIndex={0} role="region" aria-label={sheet.name}><table className="export-preview-table"><tbody>{sheet.rows.slice(0,100).map((row,index)=><tr key={index}>{row.map((cell,col)=><td key={col} colSpan={cell.span} style={{fontWeight:cell.bold ? 700:undefined}}>{cell.text}</td>)}</tr>)}</tbody></table></div></> : <p>{t("exports.previewEmpty")}</p>}
 </section>;
}
