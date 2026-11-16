# Контракты локального HTTP

[SDD](../SDD.md) · Реализация маршрутов в `src/server.mjs`. Ниже описан внутренний интерфейс клиента и локального сервера версии 0.1.0.

Все записи используют `POST` и заголовок `x-rmuor: 1`. При наличии `Origin` он должен совпасть с HTTP-адресом из `Host`. Тело JSON передаётся с `Content-Type: application/json` и ограничено 128 КиБ. Импорт источника принимает сырые байты и ограничен 20 МиБ. Для обновления, не требующего параметров, передаётся `{}`. Ответы с ошибкой содержат `{error, code}`. Сервер возвращает `403` при проверке адреса и происхождения, `404` для неизвестного маршрута или отсутствующего ресурса, `409` при конфликте, `413` при превышении размера, `422` при ошибке чтения реестра, `502` при ошибках Git и `500` при внутреннем сбое. Ошибки проверки полей обычно имеют код `400`. Ответы помечены `Cache-Control: no-store`.

## Чтение и импорт

| Метод и путь | Параметры | Результат |
| --- | --- | --- |
| `GET /` и статические файлы | Разрешённые пути из `staticFiles` | Оболочка и ресурсы `public/` |
| `GET /api/state` | — | Текущее состояние интерфейса |
| `GET /api/status-register` | `source` — необязательный SHA-256 | Лист, диапазон, источник, подтверждённая дата и её ревизия, периоды и строки реестра. При автоотборе возможен `null` |
| `GET /api/status-week` | `current`, `period`, необязательный `previous`, `scope=map` для проекции по назначениям карты | `period, current, previous, baseline, comparison`. `baseline` содержит число строк, выполненных, записи рисков и отсутствующих методик. `comparison` равен `null` без предыдущего среза |
| `GET /api/source/<sha>/preview` | `sheet`, целочисленный нулевой `offset` | До 100 строк XLSX с метаданными листа и объединений |
| `GET /api/source/<sha>/file` | SHA-256 в пути | Исходные байты с именем оригинала как вложение |
| `POST /api/source` | Сырые байты HTML/XLSX, имя в `x-file-name` с URL-кодированием | Обновлённое рабочее состояние |
| `GET /api/backup` | — | Поток JSON как `rm-uor-backup.json` |
| `GET /api/browser` | — | `connectors, jobs, reports, recordings, openProfiles` |
| `GET /api/curator-week` | `week` в формате `YYYY-MM-DD`, строго понедельник | `week, weeks, summary, curators`. Карточка содержит `name, url, sections` и возможный `range`. `sections: null` при пропуске |

Проекция `/api/state` содержит `appVersion, profile, shared, catalogSourceId, directory, sources, statusSnapshots, ditStatuses, ditPublished, ditDrafts, automations, visualization, goals`. У каждой цели есть каталожные поля, `published`, `local` и `automatic`. `shared` здесь содержит метаданные синхронизации и историю. `ditStatuses` содержит локальную проекцию поверх опубликованного результата. Для просмотра собственно общей версии есть `ditPublished`.

## Настройка, черновики и Git

Успешная запись возвращает проекцию `/api/state`, кроме явно отмеченных ответов. Для новой ревизируемой записи передаётся `expectedRevision: null`, если не указан другой стартовый контракт.

| POST | Ключи тела | Условие и результат |
| --- | --- | --- |
| `/api/profile` | `name, remote, branch, refreshMinutes, theme, gitExecutable, gitAuth` | Профиль объединяется с сохранённым. Интервал 1–1440 минут, `gitAuth` — `system` или `prompt` |
| `/api/theme` | `theme` | `system / indigo / slate / sand / forest / dark` |
| `/api/snapshot` | `sourceId, asOf, expectedRevision` | Подтверждение даты `YYYY-MM-DD` для распознанной книги |
| `/api/statuslink` | `sourceId, entryId, goalId, scopeId, expectedRevision` | Связь однозначной строки. `goalId: null` фиксирует отсутствие связи. `scopeId` необязателен, при выборе нужен назначенный лидер |
| `/api/status` | `goalId, scopeId, period, value, status, plan, comment, risk, asOf, expectedRevision` | Черновик результата. `value` допускает `null` или число от 0 до 1 000 000. Ревизия относится к общей версии. Нужны ФИО, существующая цель и участник |
| `/api/dit-status` | `period, changes: [{goalId, status, expectedRevision, measurement?}]` | До 200 уникальных действующих целей. Поддерживаются квартал и год. Пустой `status` снимает переопределение статуса. Проверяются ревизии каждой строки. При отсутствии `measurement` сохраняется ранее введённое измерение. При `null` оно очищается |
| `/api/goal` | `goalId, title, target, description, method, curators` | До 30 кураторов. Правка карточки существующей цели поверх HTML |
| `/api/directory` | `id, name, type, leaderId, aliases` | С `id` обновляется участник, без него создаётся участник. До 20 алиасов. В интерфейсе предусмотрены ДИТ, кластер, команда, продукт и агент |
| `/api/automation` | `goalId, sourceId, sheet, scopeColumn, valueColumn, headerRow, endRow, period, asOf, scale` | Столбцы различаются, `headerRow` предшествует данным, `endRow` включительно или пусто. `scale=fraction` переводит долю в проценты |
| `/api/calculate` | `goalId` | Считает по сохранённому правилу и сохраняет отдельный результат расчёта |
| `/api/accept` | `goalId, expectedRevision` | Переносит расчёт, соответствующий текущему правилу, в локальные черновики |
| `/api/visualization` | `cards, expectedRevision` | До 8 карточек с уникальными `id`. Поля `id, title, kind, group, period, status, leader`. Виды `bar / stacked / table`, группы `status / leader / objective` |
| `/api/gitcheck` | `gitExecutable` | Возвращает `{version}` для выбранного Git или Git из `PATH` |
| `/api/refresh` | `credentials, credentialRemote` в режиме входа, иначе пустой объект | Обновляет доступную общую версию. Подключение привязано к профилю |
| `/api/publishpreview` | `goalIds`, необязательный `ditPeriod`, при входе `credentials, credentialRemote` | Возвращает `author, remote, branch, revision, goals, token` и данные `ditPeriod, ditChanges` при их наличии |
| `/api/publish` | Тот же выбор и параметры входа, `token` из предпросмотра | Повторно проверяет подключение, версии и точный состав правок перед коммитом |

При ручном входе `credentials` содержит `username, password`. `credentialRemote` должен совпасть с настроенным HTTPS-адресом. При публикации `goalIds` может быть пустым, если задан `ditPeriod`. `ditPeriod` выбирает все действующие черновики ДИТ этого периода. Предпросмотр возвращает пары старого и нового значения. `token` связывает выбор, черновики и состояние подключения.

Для измерения в `/api/dit-status` передают `method, asOf, plan?` и поля выбранного метода. Для `manual-v1` нужны `fact, unit, reference`. Для `xlsx-cell-v1` нужны `sourceId, sheet, factCell, unit`, возможны `planCell, scale`. Для `xlsx-ratio-v1` нужны `sourceId, sheet, numerator, denominator`, возможны `planCell, scale`. Адреса ячеек имеют вид `G136`. Если указан `planCell`, он имеет приоритет над числовым `plan`. ФИО автора устанавливает сервер из профиля. Ошибка формата или значения оставляет прежнее состояние. Точный формат сохранённой записи указан в [контракте среза](data.md#измерение-дит-и-выгрузка-среза).

## Браузерные записи

Успешный ответ, кроме обмена сценариями, содержит состояние браузерного рабочего пространства.

| POST | Тело | Поведение |
| --- | --- | --- |
| `/api/browser/save` | `id, expectedRevision, name, curator, url, allowedOrigins, actions, downloadSelector, readySelector, reportSelector, executablePath` | `200`. При создании `id` отсутствует, начальная ревизия `0`. Изменение требует текущую ревизию |
| `/api/browser/login`, `/api/browser/close`, `/api/browser/collect`, `/api/browser/read` | `{id}` | `202`. Запускает операцию, итог читается из `GET /api/browser` |
| `/api/browser/record`, `/api/browser/record-stop` | `{id}` | `200`. Старт и завершение записи в открытом личном окне |
| `/api/browser/scenario` | `{text}` при импорте или `{draft}` при выгрузке | `200`. Разобранный сценарий либо `{text}` с каноническим JSON. Применение требует отдельного сохранения подключения |

Подробности в [форматах данных](data.md) и [руководстве по браузерным подключениям](../browser-connectors.md).
