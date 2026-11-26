import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
export function ContextHelp({label, children}: {label: string; children: ReactNode}) {
 const [open,setOpen]=useState(false); const id=useId(); const {t}=useTranslation();
 return <div className="context-help"><button type="button" className="context-help-toggle" aria-label={t("exports.helpLabel",{section:label})} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>?</button><div id={id} className={`context-help-reveal${open ? " is-open" : ""}`} aria-hidden={!open} onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}}><div><p>{children}</p></div></div></div>;
}
