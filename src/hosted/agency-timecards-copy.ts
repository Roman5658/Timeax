const copy={
 ru:{internal:'Внутренние производства',factory:'Табели от заводов',internalHint:'Смены вводят работники. Агентство просматривает часы и сохраняет табель за период.',factoryHint:'Здесь табели, которые завод уже передал агентству. Редактировать часы или утверждать их здесь не нужно.',selectSite:'Все производства',selectWorker:'Все работники',siteRequired:'Выбери производство, чтобы сохранить табель.',matches:'Смены за выбранный период',archive:'Сохранённые табели',received:'Полученные табели',emptyReceived:'Табели от заводов пока не поступали.',emptyMatch:'По этим фильтрам ничего нет.',invalidRange:'Начальная дата должна быть не позже конечной.',exporting:'Готовим Excel…',exportError:'Не удалось скачать Excel. Попробуй ещё раз.',download:'Скачать Excel (.xlsx)',workbook:'Табель Timeax',source:'Источник',factoryLabel:'Завод',gross:'Всего минут',break:'Перерыв, мин',paid:'К оплате, мин',total:'Всего минут к оплате',site:'Производство',timeZone:'Часовой пояс'},
 pl:{internal:'Wewnętrzne zakłady',factory:'Ewidencje z fabryk',internalHint:'Pracownicy wpisują zmiany. Agencja przegląda godziny i zapisuje ewidencję za wybrany okres.',factoryHint:'To ewidencje przekazane przez fabrykę agencji. Nie trzeba tutaj edytować ani zatwierdzać godzin.',selectSite:'Wszystkie zakłady',selectWorker:'Wszyscy pracownicy',siteRequired:'Wybierz zakład, aby zapisać ewidencję.',matches:'Zmiany w wybranym okresie',archive:'Zapisane ewidencje',received:'Otrzymane ewidencje',emptyReceived:'Nie otrzymano jeszcze ewidencji z fabryk.',emptyMatch:'Brak wyników dla tych filtrów.',invalidRange:'Data rozpoczęcia nie może być późniejsza niż data zakończenia.',exporting:'Przygotowujemy Excel…',exportError:'Nie udało się pobrać pliku. Spróbuj ponownie.',download:'Pobierz Excel (.xlsx)',workbook:'Ewidencja Timeax',source:'Źródło',factoryLabel:'Fabryka',gross:'Łącznie minut',break:'Przerwa, min',paid:'Płatne minuty',total:'Łącznie płatne minuty',site:'Zakład',timeZone:'Strefa czasowa'},
 uk:{internal:'Внутрішні виробництва',factory:'Табелі від заводів',internalHint:'Працівники записують зміни. Агентство переглядає години й зберігає табель за період.',factoryHint:'Тут табелі, які завод уже передав агентству. Редагувати чи затверджувати години тут не потрібно.',selectSite:'Усі виробництва',selectWorker:'Усі працівники',siteRequired:'Обери виробництво, щоб зберегти табель.',matches:'Зміни за вибраний період',archive:'Збережені табелі',received:'Отримані табелі',emptyReceived:'Табелі від заводів ще не надходили.',emptyMatch:'За цими фільтрами нічого немає.',invalidRange:'Початкова дата не може бути пізнішою за кінцеву.',exporting:'Готуємо Excel…',exportError:'Не вдалося завантажити Excel. Спробуй ще раз.',download:'Завантажити Excel (.xlsx)',workbook:'Табель Timeax',source:'Джерело',factoryLabel:'Завод',gross:'Усього хвилин',break:'Перерва, хв',paid:'До оплати, хв',total:'Усього хвилин до оплати',site:'Виробництво',timeZone:'Часовий пояс'},
 en:{internal:'Internal worksites',factory:'Timecards from factories',internalHint:'Workers record shifts. The agency reviews the hours and saves a timecard for the period.',factoryHint:'These are the timecards already sent to the agency by a factory. Hours do not need to be edited or approved here.',selectSite:'All worksites',selectWorker:'All workers',siteRequired:'Choose a worksite to save a timecard.',matches:'Shifts in the selected period',archive:'Saved timecards',received:'Received timecards',emptyReceived:'No timecards have arrived from factories yet.',emptyMatch:'No results match these filters.',invalidRange:'The start date must be on or before the end date.',exporting:'Preparing Excel…',exportError:'Excel could not be downloaded. Try again.',download:'Download Excel (.xlsx)',workbook:'Timeax timecard',source:'Source',factoryLabel:'Factory',gross:'Total minutes',break:'Break, minutes',paid:'Paid minutes',total:'Total paid minutes',site:'Worksite',timeZone:'Time zone'}
} as const;
const filters={
 "ru": {
  "weekdays": "Дни недели",
  "allDays": "Выбрать все дни",
  "noDays": "Снять все отметки",
  "shiftCount": "Смены",
  "archiveFilters": "Чтобы сохранить весь табель производства, выбери месяц, дату или диапазон дат и убери фильтры по работникам и дням недели."
 },
 "pl": {
  "weekdays": "Dni tygodnia",
  "allDays": "Zaznacz wszystkie dni",
  "noDays": "Odznacz wszystkie dni",
  "shiftCount": "Zmiany",
  "archiveFilters": "Aby zapisać pełną ewidencję zakładu, wybierz miesiąc, dzień lub zakres dat i usuń filtry pracowników i dni tygodnia."
 },
 "uk": {
  "weekdays": "Дні тижня",
  "allDays": "Вибрати всі дні",
  "noDays": "Зняти всі позначки",
  "shiftCount": "Зміни",
  "archiveFilters": "Щоб зберегти повний табель виробництва, вибери місяць, дату або діапазон дат і прибери фільтри працівників і днів тижня."
 },
 "en": {
  "weekdays": "Days of the week",
  "allDays": "Select all days",
  "noDays": "Clear all days",
  "shiftCount": "Shifts",
  "archiveFilters": "To save the entire worksite timecard, choose a month, date or date range and clear worker and weekday filters."
 }
} as const;
export const agencyTimecardsCopy=(language:string)=>{
 const lang=language.split('-')[0] as keyof typeof copy;
 return {...(copy[lang]??copy.en),...(filters[lang]??filters.en)};
};
