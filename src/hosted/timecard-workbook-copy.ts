import type {TFunction} from 'i18next';
import type {WorkbookCopy} from './timecard-xlsx';
import {agencyTimecardsCopy} from './agency-timecards-copy';

export function timecardWorkbookCopy(t:TFunction,locale:string,sent=false):WorkbookCopy{
 const tt=(k:string)=>t('timecards.'+k),m=(k:string)=>t('monthlyTimesheets.'+k),c=agencyTimecardsCopy(locale);
 return {
  source:c.source,site:c.site,factory:c.factoryLabel,worker:tt('workerRef'),date:tt('date'),start:tt('start'),end:tt('end'),
  gross:m('gross'),break:m('breaks'),paid:m('paid'),comment:tt('comment'),total:m('productionTotal'),
  worksheet:m('title'),missingName:t('memberNames.historicalMissing'),reference:t('memberNames.reference'),
  internal:c.internal,factorySource:c.factory,timeZone:c.timeZone,locale,scope:c.exportScope,workerExtract:c.workerExtract,
  breakState:t('workflow.breakReport.inputLabel'),breakUnreported:t('workflow.breakReport.notReported'),breakNotTaken:t('breaks.notTaken'),
  breakPaid:t('workflow.breakReport.paidChoice'),breakUnpaid:t('workflow.breakReport.unpaidChoice'),weekday:t('exports.colWeekday'),
  agency:t('workflow.role.agency'),shifts:m('shifts'),status:m('recordStatus.title'),archived:tt('archived'),received:t(sent?'factoryHours.sent':'factoryHours.received'),
  absences:m('absences'),notInSnapshot:c.notInSnapshot,shiftLabel:m('shift'),
  preview:{status:c.preview,source:c.liveSource,notice:c.liveNotice,total:c.previewTotal,recorded:tt('recorded'),absences:c.reportedAbsences,absenceNote:c.onlyReports,absenceUnavailable:c.absenceUnavailable}
 };
}
