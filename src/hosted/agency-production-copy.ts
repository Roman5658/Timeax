export const productionCopy={
 "ru": {
  "open": "Открыть",
  "settings": "Настройки",
  "saveName": "Сохранить название",
  "renamed": "Название сохранено.",
  "team": "Работники производства",
  "empty": "Здесь пока никто не назначен.",
  "ends": "До",
  "addAssigned": "Назначить работника",
  "openWorkers": "Открыть список работников",
  "retry": "Повторить"
 },
 "pl": {
  "open": "Otwórz",
  "settings": "Ustawienia",
  "saveName": "Zapisz nazwę",
  "renamed": "Nazwa zapisana.",
  "team": "Pracownicy zakładu",
  "empty": "Nikt nie jest jeszcze przypisany.",
  "ends": "Do",
  "addAssigned": "Przypisz pracownika",
  "openWorkers": "Otwórz listę pracowników",
  "retry": "Spróbuj ponownie"
 },
 "uk": {
  "open": "Відкрити",
  "settings": "Налаштування",
  "saveName": "Зберегти назву",
  "renamed": "Назву збережено.",
  "team": "Працівники виробництва",
  "empty": "Тут ще нікого не призначено.",
  "ends": "До",
  "addAssigned": "Призначити працівника",
  "openWorkers": "Відкрити список працівників",
  "retry": "Спробувати ще раз"
 },
 "en": {
  "open": "Open",
  "settings": "Settings",
  "saveName": "Save name",
  "renamed": "Name saved.",
  "team": "Worksite workers",
  "empty": "No workers assigned yet.",
  "ends": "Until",
  "addAssigned": "Assign worker",
  "openWorkers": "Open worker list",
  "retry": "Try again"
 }
} as const;


const settingsCopy = {
 "ru": {
  "agencyDetails": "Данные агентства",
  "agencyAddress": "Адрес агентства",
  "contactEmail": "Контактная почта",
  "contactHint": "Эти данные не меняют почту для входа, NIP или реквизиты оплаты.",
  "settingsSaved": "Настройки сохранены.",
  "settingsError": "Не удалось загрузить или сохранить настройки.",
  "internalAlias": "Название для вашего агентства",
  "connectedSettingsHint": "Изменения увидит только ваше агентство. Название и данные самого завода не изменятся.",
  "disconnectHint": "Связь с заводом будет отключена только для вашего агентства. Другие агентства останутся подключены."
 },
 "pl": {
  "agencyDetails": "Dane agencji",
  "agencyAddress": "Adres agencji",
  "contactEmail": "E-mail kontaktowy",
  "contactHint": "Te dane nie zmieniają e-maila do logowania, NIP-u ani danych rozliczeniowych.",
  "settingsSaved": "Ustawienia zapisane.",
  "settingsError": "Nie udało sie wczytać lub zapisać ustawień.",
  "internalAlias": "Nazwa dla Twojej agencji",
  "connectedSettingsHint": "Zmiany będą widoczne tylko dla Twojej agencji. Nazwa i dane samego zakładu się nie zmienią.",
  "disconnectHint": "Połączenie z zakładem zostanie odłączone tylko dla Twojej agencji. Inne agencje pozostaną połączone."
 },
 "uk": {
  "agencyDetails": "Дані агентства",
  "agencyAddress": "Адреса агентства",
  "contactEmail": "Контактна пошта",
  "contactHint": "Ці дані не змінюють пошту для входу, NIP чи платіжні реквізити.",
  "settingsSaved": "Налаштування збережено.",
  "settingsError": "Не вдалося завантажити або зберегти налаштування.",
  "internalAlias": "Назва для вашого агентства",
  "connectedSettingsHint": "Зміни побачить лише ваше агентство. Назва й дані самого заводу не зміняться.",
  "disconnectHint": "Зв’язок із заводом вимкнеться лише для вашого агентства. Інші залишаться підключеними."
 },
 "en": {
  "agencyDetails": "Agency details",
  "agencyAddress": "Agency address",
  "contactEmail": "Contact email",
  "contactHint": "These details do not change the sign-in email, NIP, or billing details.",
  "settingsSaved": "Settings saved.",
  "settingsError": "Could not load or save settings.",
  "internalAlias": "Name for your agency",
  "connectedSettingsHint": "Only your agency sees these changes. The factory's name and official details are not changed.",
  "disconnectHint": "Only your agency’s connection will be removed. Other agencies will stay connected."
 }
} as const;
export function getProductionCopy(language?:string){
 const lang=(language??'en').split('-')[0] as keyof typeof productionCopy;
 return {...(productionCopy[lang]??productionCopy.en),...(settingsCopy[lang]??settingsCopy.en)};
}


export const plannedModes = ['nfc_terminal','nfc_stationary','leader','manual'] as const;
export type PlannedTimeMode = typeof plannedModes[number];
const timePlanCopy = {
 "ru": {
  "title": "Способ учёта времени",
  "lead": "Это план, не переключатель. Сохранение не меняет текущий учёт и доступ работников.",
  "tenant": "План агентства касается только его работников на этом производстве.",
  "nfc_terminal": "Личные NFC-карты и телефон-терминал",
  "nfc_terminal_hint": "Агентство выдаёт карты работникам; один телефон на площадке работает как терминал.",
  "nfc_stationary": "Стационарная NFC-метка и телефон работника",
  "nfc_stationary_hint": "Работник отмечает начало и конец смены со своего телефона возле метки.",
  "leader": "Учёт ведёт бригадир",
  "leader_hint": "Бригадир записывает время своей бригады; работник не вводит его вручную.",
  "manual": "Работник записывает время вручную",
  "manual_hint": "Работник вводит только свои часы в пределах своего назначения.",
  "none": "План не выбран",
  "save": "Сохранить план",
  "clear": "Снять выбор",
  "saved": "План сохранён. Текущий учёт не изменился."
 },
 "pl": {
  "title": "Sposób ewidencji czasu",
  "lead": "To plan, nie przełącznik. Zapis nie zmienia aktualnej ewidencji ani dostępu pracowników.",
  "tenant": "Plan agencji dotyczy wyłącznie jej pracowników w tym zakładzie.",
  "nfc_terminal": "Osobiste karty NFC i telefon jako terminal",
  "nfc_terminal_hint": "Agencja wydaje karty pracownikom; jeden telefon na miejscu działa jako terminal.",
  "nfc_stationary": "Stacjonarny znacznik NFC i telefon pracownika",
  "nfc_stationary_hint": "Pracownik rejestruje początek i koniec zmiany własnym telefonem przy znaczniku.",
  "leader": "Czas wpisuje brygadzista",
  "leader_hint": "Brygadzista wpisuje czas swojej brygady; pracownik nie wpisuje go ręcznie.",
  "manual": "Pracownik wpisuje czas ręcznie",
  "manual_hint": "Pracownik wpisuje wyłącznie własne godziny w ramach swojego przydziału.",
  "none": "Nie wybrano planu",
  "save": "Zapisz plan",
  "clear": "Wyczyść wybór",
  "saved": "Zapisano plan. Obecna ewidencja nie uległa zmianie."
 },
 "uk": {
  "title": "Спосіб обліку часу",
  "lead": "Це план, а не перемикач. Збереження не змінює поточний облік і доступ працівників.",
  "tenant": "План агентства стосується лише його працівників на цьому виробництві.",
  "nfc_terminal": "Особисті NFC-картки й телефон-термінал",
  "nfc_terminal_hint": "Агентство видає картки працівникам; один телефон на місці працює як термінал.",
  "nfc_stationary": "Стаціонарна NFC-мітка й телефон працівника",
  "nfc_stationary_hint": "Працівник відмічає початок і кінець зміни зі свого телефона біля мітки.",
  "leader": "Облік веде бригадир",
  "leader_hint": "Бригадир записує час своєї бригади; працівник не вводить його вручну.",
  "manual": "Працівник записує час вручну",
  "manual_hint": "Працівник вводить лише власні години в межах свого призначення.",
  "none": "План не вибрано",
  "save": "Зберегти план",
  "clear": "Скинути вибір",
  "saved": "План збережено. Поточний облік не змінився."
 },
 "en": {
  "title": "Time tracking method",
  "lead": "This is a plan, not a switch. Saving does not change current time tracking or worker access.",
  "tenant": "The agency plan only applies to its own workers at this site.",
  "nfc_terminal": "Personal NFC cards and a terminal phone",
  "nfc_terminal_hint": "The agency issues cards to workers and uses a dedicated phone on-site as the terminal.",
  "nfc_stationary": "Stationary NFC tag and worker's phone",
  "nfc_stationary_hint": "Workers record the start and end of a shift using their own phone at the tag.",
  "leader": "Team leader records time",
  "leader_hint": "The team leader records time for their crew. Workers cannot enter it manually.",
  "manual": "Worker records time manually",
  "manual_hint": "Workers enter only their own hours within their assignment.",
  "none": "No plan selected",
  "save": "Save plan",
  "clear": "Clear selection",
  "saved": "Plan saved. Current time tracking is unchanged."
 }
} as const;
export function getTimePlanCopy(language?:string){
 const lang=(language??'en').split('-')[0] as keyof typeof timePlanCopy;
 return timePlanCopy[lang]??timePlanCopy.en;
}
