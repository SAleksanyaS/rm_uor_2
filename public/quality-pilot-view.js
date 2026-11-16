const statusLabels = {
  achieved: 'Порог выполнен',
  exceeded: 'Длительность выше порога',
  missing: 'Нет измерения',
};

const unitLabels = { days: 'дни', hours: 'часы' };
const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 });

function number(value) {
  return value == null ? '—' : formatter.format(value);
}

function elapsed(value) {
  return value > 0 ? '+' + number(value) : number(value);
}

function renderRun(run, { escape, dateText }) {
  const { totals, source, recipe } = run;
  const unit = unitLabels[run.unit] ?? run.unit;
  const rows = run.teams;
  return '<article class="panel panel-inner stack">' +
    '<div class="headline"><h2>Итог ДИТ</h2><button type="button" class="button compact" data-action="quality-pilot-export" data-id="' +
    escape(run.id) + '">Скачать JSON</button></div>' +
    '<p class="reading-meta">' + escape(run.period) + ' · ' + escape(dateText(run.asOf)) + ' · ' + escape(run.methodId) + '</p>' +
    '<p class="excel-fact"><strong>' + (totals.percent == null ? 'Итоговая доля не рассчитана' : escape(number(totals.percent)) + '% команд выполнили порог') +
    '</strong><span>Выполнили ' + number(totals.achieved) + ' · применимо ' + number(totals.applicable) +
    ' · измерено ' + number(totals.measured) + ' · нет измерения ' + number(totals.missing) + '</span></p>' +
    (totals.missing ? '<p class="muted small">Укажите отсутствующие измерения в новом срезе, чтобы рассчитать долю от всех применимых команд.</p>' : '') +
    '<details><summary>Команды и отклонения · ' + number(totals.exceeded) + ' выше порога</summary>' +
    '<div class="table-wrap"><table><thead><tr><th scope="col">Команда</th><th scope="col">Строка</th>' +
    '<th scope="col">Порог, ' + escape(unit) + '</th><th scope="col">Факт, ' + escape(unit) + '</th>' +
    '<th scope="col">Отклонение, ' + escape(unit) + '</th><th scope="col">Результат</th></tr></thead><tbody>' +
    rows.map(team => '<tr><th scope="row">' + escape(team.team) + '</th><td>' + number(team.row) +
      '</td><td>' + number(team.threshold) + '</td><td>' + number(team.duration) + '</td><td>' +
      elapsed(team.deviation) + '</td><td>' + escape(statusLabels[team.status]) + '</td></tr>').join('') +
    '</tbody></table></div></details>' +
    '<details><summary>Исходные данные и методика</summary><p>' +
    escape(source.name || 'Книга XLSX') + ' · лист «' + escape(source.sheet) + '» · строки ' +
    number(recipe.startRow) + '–' + number(recipe.endRow) + '</p><p>Команда ' + escape(recipe.teamColumn) +
    ' · порог ' + escape(recipe.thresholdColumn) + ' · длительность ' + escape(recipe.durationColumn) +
    '</p><p>Команда выполняет порог, когда её длительность меньше порога или равна ему.</p>' +
    '<p class="reading-meta">SHA-256 книги <code>' + escape(source.sha256) + '</code></p></details></article>';
}

export function renderQualityPilot({
  sources = [], runs = [], selectedRunId, input = {}, error = '', running = false,
} = {}, { escape, option, heading, dateText }) {
  const books = sources.filter(source => source.type === 'xlsx');
  const book = books.find(source => source.id === input.sourceId) ?? books[0];
  const sheets = (book?.sheets ?? []).filter(sheet => !sheet.hidden);
  const selectedSheet = sheets.some(sheet => sheet.name === input.sheet) ? input.sheet : sheets[0]?.name;
  const chosenRun = runs.find(run => run.id === selectedRunId) ?? runs[0];
  const requestDisabled = running || !book || !sheets.length;
  const numeric = (name, label) => '<label class="field"><span>' + label + '</span><input type="number" name="' + name +
    '" min="1" max="1048576" step="1" required value="' + escape(input[name] ?? '') + '"></label>';
  const excelColumn = (name, label, example) => '<label class="field"><span>' + label + '</span><input name="' + name +
    '" required maxlength="2" pattern="[A-Za-z]{1,2}" placeholder="' + example + '" value="' + escape(input[name] ?? '') + '"></label>';
  return heading('Год качества', 'Пилот по длительности тестирования · SW26.3') +
    '<section class="panel panel-inner stack"><h2>Рассчитать по командам</h2><p class="muted">Выберите диапазон XLSX с одной строкой на ' +
    'применимую команду, её порогом и измеренной длительностью в тех же единицах.</p>' +
    (error ? '<p role="alert">' + escape(error) + '</p>' : '') +
    '<form id="quality-pilot-form" class="form-grid"><fieldset class="wide form-grid"' + (running ? ' disabled' : '') + '>' +
    '<label class="field wide"><span>Книга XLSX</span><select id="quality-pilot-source" name="sourceId" required>' +
    (books.length ? books.map(source => option(source.id, source.name, book?.id)).join('') :
      option('', 'Сначала загрузите книгу в «Источники»', '')) + '</select></label>' +
    '<label class="field"><span>Лист</span><select name="sheet" required>' +
    (sheets.length ? sheets.map(sheet => option(sheet.name, sheet.name, selectedSheet)).join('') : option('', 'Нет листа', '')) +
    '</select></label>' +
    '<label class="field"><span>Дата среза</span><input type="date" name="asOf" required value="' + escape(input.asOf ?? '') + '"></label>' +
    '<label class="field"><span>Период</span><input name="period" required maxlength="8" placeholder="Например, Y26" value="' +
    escape(input.period ?? '') + '"></label>' +
    '<label class="field"><span>Единица длительности</span><select name="unit">' +
    Object.entries(unitLabels).map(([value, label]) => option(value, label, input.unit ?? 'days')).join('') + '</select></label>' +
    numeric('startRow', 'Первая строка команд') + numeric('endRow', 'Последняя строка команд') +
    excelColumn('teamColumn', 'Столбец команды', 'A') + excelColumn('thresholdColumn', 'Столбец порога', 'B') +
    excelColumn('durationColumn', 'Столбец длительности', 'C') +
    '<div class="actions wide"><button type="submit" class="button primary"' + (requestDisabled ? ' disabled' : '') + '>' +
    (running ? 'Рассчитываем…' : 'Рассчитать срез') + '</button></div></fieldset></form></section>' +
    (chosenRun ? '<section class="stack" aria-label="Срезы пилота">' +
      '<label class="field"><span>Сохранённый срез</span><select id="quality-pilot-run">' +
      runs.map(run => option(run.id, [dateText(run.asOf), run.period, run.source.name].filter(Boolean).join(' · '), chosenRun.id)).join('') +
      '</select></label>' + renderRun(chosenRun, { escape, dateText }) + '</section>' : '');
}
