const calendarUrl = 'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule'
const cacheTtlMs = 6 * 60 * 60 * 1_000

type HolidayRecord = { date: string; kind: 'closed' | 'early_close'; closeMinute?: number }
type CalendarCache = { fetchedAt: number; holidaysByYear: Map<number, HolidayRecord[]> }

let cache: CalendarCache | undefined

function cleanHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCloseMinute(value: string): number | undefined {
  const match = value.match(/(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/i)
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2])
  const pm = (match[3] ?? '').toLowerCase().startsWith('p')
  if (hour === 12) hour = 0
  if (pm) hour += 12
  return hour * 60 + minute
}

function parseNasdaqCalendar(html: string): Map<number, HolidayRecord[]> {
  const result = new Map<number, HolidayRecord[]>()
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cleanHtmlText(match[1] ?? ''))
    if (cells.length < 2) continue
    const dateCell = cells.find((cell) => /\b[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\b/.test(cell))
    if (!dateCell) continue
    const dateMatch = dateCell.match(/\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/)
    if (!dateMatch) continue
    const parsedDate = new Date(`${dateMatch[1]} 12:00:00 GMT`)
    if (Number.isNaN(parsedDate.getTime())) continue
    const date = `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(parsedDate.getUTCDate()).padStart(2, '0')}`
    const statusCell = cells.find((cell) => /closed|\d{1,2}:\d{2}\s*(a\.m\.|p\.m\.)/i.test(cell))
    if (!statusCell) continue
    const earlyCloseMinute = parseCloseMinute(statusCell)
    const record: HolidayRecord = /closed/i.test(statusCell)
      ? { date, kind: 'closed' }
      : { date, kind: 'early_close', ...(earlyCloseMinute === undefined ? {} : { closeMinute: earlyCloseMinute }) }
    const year = parsedDate.getUTCFullYear()
    const records = result.get(year) ?? []
    records.push(record)
    result.set(year, records)
  }
  return result
}

async function loadCalendar(): Promise<Map<number, HolidayRecord[]>> {
  if (cache && Date.now() - cache.fetchedAt < cacheTtlMs) return cache.holidaysByYear
  const response = await fetch(calendarUrl, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`Nasdaq calendar returned HTTP ${response.status}.`)
  const html = await response.text()
  const parsed = parseNasdaqCalendar(html)
  if (parsed.size === 0) throw new Error('Nasdaq calendar format did not contain parseable dated market-status rows.')
  cache = { fetchedAt: Date.now(), holidaysByYear: parsed }
  return parsed
}

function easternParts(timestampMs: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestampMs)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  const hour = Number(values.hour)
  const minute = Number(values.minute)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday ?? '')
  if (![year, month, day, hour, minute].every(Number.isFinite) || weekdayIndex < 0) {
    throw new Error('Could not determine the current Eastern Time market date and time.')
  }
  return {
    year, month, day, hour, minute, weekdayIndex,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minuteOfDay: hour * 60 + minute,
  }
}

function dateOrdinal(date: string): number {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`Invalid Nasdaq calendar date: ${date}`)
  const [, yearText, monthText, dayText] = match
  return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) / 86_400_000
}

function isThreeDayHolidayWeekend(nowDate: string, holidays: HolidayRecord[]): boolean {
  const nowOrdinal = dateOrdinal(nowDate)
  return holidays.some((holiday) => {
    if (holiday.kind !== 'closed') return false
    const holidayOrdinal = dateOrdinal(holiday.date)
    const match = holiday.date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return false
    const [, yearText, monthText, dayText] = match
    const weekday = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))).getUTCDay()
    const offset = nowOrdinal - holidayOrdinal
    // Monday holiday: Friday after close through Monday. Friday holiday:
    // Thursday after close through Sunday. Never extrapolate beyond these windows.
    return (weekday === 1 && offset >= -3 && offset <= 0)
      || (weekday === 5 && offset >= -1 && offset <= 2)
  })
}

export async function getNasdaqMarketSessionStatus(now = new Date()) {
  const eastern = easternParts(now.getTime())
  const calendars = await loadCalendar()
  const holidays = calendars.get(eastern.year)
  if (!holidays) throw new Error(`Nasdaq calendar does not publish a parsed ${eastern.year} schedule.`)
  const dateRecord = holidays.find((holiday) => holiday.date === eastern.date)
  const weekend = eastern.weekdayIndex === 0 || eastern.weekdayIndex === 6
  const closeMinute = dateRecord?.kind === 'early_close' ? dateRecord.closeMinute ?? 13 * 60 : 16 * 60
  const isMarketOpen = !weekend && dateRecord?.kind !== 'closed'
    && eastern.minuteOfDay >= 9 * 60 + 30 && eastern.minuteOfDay < closeMinute
  const status = isMarketOpen ? 'open' as const : 'closed' as const
  return {
    status,
    source: calendarUrl,
    sourceCheckedAt: new Date(cache?.fetchedAt ?? Date.now()).toISOString(),
    timezone: 'America/New_York',
    localDate: eastern.date,
    localTime: `${String(eastern.hour).padStart(2, '0')}:${String(eastern.minute).padStart(2, '0')}`,
    earlyCloseMinute: dateRecord?.kind === 'early_close' ? closeMinute : null,
    holidayName: dateRecord?.kind === 'closed' ? 'Nasdaq-published market holiday' : null,
    extendedHolidayWeekend: status === 'closed' && isThreeDayHolidayWeekend(eastern.date, holidays),
    detail: status === 'open'
      ? 'Nasdaq calendar and regular-session hours classify the current Eastern Time session as open.'
      : 'Nasdaq calendar and regular-session hours classify the current Eastern Time session as closed.',
  }
}
