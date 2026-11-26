import { ContextHelp } from "./ContextHelp";
import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, action }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow page-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <ContextHelp label={typeof title === "string" ? title : "Timeax"}>{description}</ContextHelp>}
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </div>
  );
}
