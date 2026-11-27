import {useTranslation} from 'react-i18next';
import type {Inbox} from './inbox';
const texts={
 en:{archive:'Archive',archived:'Archive',active:'Active',restore:'Restore',delete:'Delete for me',confirm:'Remove this item from your inbox? Other people keep their copy.',previous:'Previous',next:'Next',page:'Page',failed:'Could not update the inbox. Try again.'},
 ru:{archive:'В архив',archived:'Архив',active:'Активные',restore:'Восстановить',delete:'Удалить у себя',confirm:'Удалить эту запись из вашего списка? У других участников она сохранится.',previous:'Назад',next:'Далее',page:'Страница',failed:'Не удалось обновить список. Попробуйте ещё раз.'},
 pl:{archive:'Archiwizuj',archived:'Archiwum',active:'Aktywne',restore:'Przywróć',delete:'Usuń u mnie',confirm:'Usunąć ten wpis z Twojej skrzynki? U innych pozostanie bez zmian.',previous:'Wstecz',next:'Dalej',page:'Strona',failed:'Nie udało się zaktualizować skrzynki. Spróbuj ponownie.'},
 uk:{archive:'До архіву',archived:'Архів',active:'Активні',restore:'Відновити',delete:'Видалити в себе',confirm:'Видалити цей запис із вашого списку? В інших учасників він залишиться.',previous:'Назад',next:'Далі',page:'Сторінка',failed:'Не вдалося оновити список. Спробуйте ще раз.'}
};
export function useInboxCopy(){
 const {i18n}=useTranslation();
 return texts[(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof texts]??texts.en;
}
export function InboxActions({inbox,anchor}:{inbox?:Inbox;anchor:string}){
 const c=useInboxCopy();
 if(!inbox?.data)return null;
 const archived=inbox.state(anchor)==='archived';
 return <div className="form-actions inbox-actions">
  <button className="button button--outline button--small" type="button" disabled={inbox.busy} onClick={()=>void inbox.set(anchor,archived?'active':'archived')}>{archived?c.restore:c.archive}</button>
  <button className="button button--outline button--small" type="button" disabled={inbox.busy} onClick={()=>{if(window.confirm(c.confirm))void inbox.set(anchor,'deleted')}}>{c.delete}</button>
 </div>;
}
export function InboxPagination({page,pages,onPage}:{page:number;pages:number;onPage:(n:number)=>void}){
 const c=useInboxCopy();
 if(pages<=1)return null;
 return <div className="form-actions inbox-pagination" role="group" aria-label={c.page}>
  <button className="button button--outline button--small" type="button" disabled={page===0} onClick={()=>onPage(page-1)}>{c.previous}</button>
  <span aria-live="polite">{c.page} {page+1} / {pages}</span>
  <button className="button button--outline button--small" type="button" disabled={page+1===pages} onClick={()=>onPage(page+1)}>{c.next}</button>
 </div>;
}
