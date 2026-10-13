/*
 * 매일 확인 미션 + 연재 이야기 진행 (모든 업무 페이지가 로드)
 * - 화면 방문 기록일 뿐이며 실제 재고 점검이나 API 정상 여부를 뜻하지 않습니다.
 * - 날짜는 Asia/Seoul 기준 'YYYY-MM-DD'.
 * - 저장: localStorage 'stockd.daily-checks.v1' {version:1, days}, 'stockd.story-progress.v1' {version:1, unlockedDates, lastViewed}
 * - 모든 저장소 접근은 try/catch. 차단되면 메모리로 대체하고 StockD.missions.storageBlocked 가 true 가 됩니다.
 * - 이 페이지에 해당 DOM 이 없어도 오류 없이 동작합니다.
 * - 변화가 생기면 document 에 'stockd:missions-changed' 이벤트를 보냅니다(화면 갱신용).
 */
(function () {
  var root = window.StockD = window.StockD || {}

  var DAILY_KEY = 'stockd.daily-checks.v1'
  var STORY_KEY = 'stockd.story-progress.v1'
  var PROBE_KEY = 'stockd.storage-probe'
  var TASKS = ['opened', 'inventory', 'orders']
  var TASK_LABELS = {
    opened: '오늘 StockD 열기',
    inventory: '재고 화면 열기',
    orders: '주문 화면 열기'
  }
  // 이 페이지를 열면 기록되는 단계 (그 외 페이지는 아무 것도 기록하지 않음)
  var PAGE_TASK = { dashboard: 'opened', inventory: 'inventory', orders: 'orders' }
  // 데이터를 보지 못한 화면(?state=)에서는 방문으로 기록하지 않는다. empty·stale·partial 은 데이터 화면이므로 기록한다
  var UNRECORDED_STATES = ['loading', 'error', 'unauthorized']
  var STATE_PAGES = ['inventory', 'orders']
  var RETENTION_DAYS = 90
  var STORY_TOTAL = 15
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

  var storageBlocked = false
  var memDays = {}
  var memStory = { unlockedDates: [], lastViewed: 0 }
  var pendingVisitPage = null
  var lastDate = ''

  var formatter = null
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (error) {
    formatter = null
  }

  // ── 날짜 ────────────────────────────────
  function today() {
    var now = new Date()
    if (formatter) {
      try {
        var parts = formatter.formatToParts(now)
        var map = {}
        parts.forEach(function (part) { map[part.type] = part.value })
        if (map.year && map.month && map.day) return map.year + '-' + map.month + '-' + map.day
      } catch (error) {
        // 아래 대체 계산 사용
      }
    }
    return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  }

  function offsetDate(date, offset) {
    var d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }

  function isRealDate(date) {
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return false
    var d = new Date(date + 'T00:00:00Z')
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
  }

  // ── 저장소 (모두 try/catch) ─────────────
  function getStorage() {
    try {
      return window.localStorage || null
    } catch (error) {
      storageBlocked = true
      return null
    }
  }

  function readRaw(key) {
    var storage = getStorage()
    if (!storage) {
      storageBlocked = true
      return null
    }
    try {
      return storage.getItem(key)
    } catch (error) {
      storageBlocked = true
      return null
    }
  }

  function writeRaw(key, value) {
    var storage = getStorage()
    if (!storage) {
      storageBlocked = true
      return false
    }
    try {
      storage.setItem(key, value)
      return true
    } catch (error) {
      storageBlocked = true
      return false
    }
  }

  function removeRaw(key) {
    var storage = getStorage()
    if (!storage) return false
    try {
      storage.removeItem(key)
      return true
    } catch (error) {
      storageBlocked = true
      return false
    }
  }

  // 로드 시 한 번 쓰기 가능 여부를 확인한다
  function probeStorage() {
    var storage = getStorage()
    if (!storage) {
      storageBlocked = true
      return
    }
    try {
      storage.setItem(PROBE_KEY, '1')
      storage.removeItem(PROBE_KEY)
    } catch (error) {
      storageBlocked = true
    }
  }

  function parseJson(raw) {
    if (typeof raw !== 'string' || raw === '') return null
    try {
      return JSON.parse(raw)
    } catch (error) {
      return null
    }
  }

  // ── 일일 기록 ───────────────────────────
  // 읽을 때마다 검증·정리: 형식 오류, 존재하지 않는 날짜, 미래, 90일 이전 제거
  function cleanDays(value) {
    var result = {}
    if (!value || value.version !== 1 || !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) return result
    var now = today()
    var earliest = offsetDate(now, -(RETENTION_DAYS - 1))
    Object.keys(value.days).sort().forEach(function (date) {
      if (!isRealDate(date) || date < earliest || date > now) return
      var record = value.days[date]
      if (!record || typeof record !== 'object' || Array.isArray(record)) return
      var inventory = record.inventory === true
      var orders = record.orders === true
      if (record.opened === true || inventory || orders) {
        result[date] = { opened: true, inventory: inventory, orders: orders }
      }
    })
    return result
  }

  // 날짜 합집합, 각 단계는 OR 병합
  function mergeDays(a, b) {
    var days = {}
    var sources = [a, b]
    sources.forEach(function (source) {
      Object.keys(source || {}).forEach(function (date) {
        var prev = days[date] || { opened: false, inventory: false, orders: false }
        var next = source[date] || {}
        days[date] = {
          opened: prev.opened || next.opened === true,
          inventory: prev.inventory || next.inventory === true,
          orders: prev.orders || next.orders === true
        }
      })
    })
    return cleanDays({ version: 1, days: days })
  }

  function loadDays() {
    var stored = cleanDays(parseJson(readRaw(DAILY_KEY)))
    memDays = mergeDays(memDays, stored)
    return memDays
  }

  function saveDays() {
    return writeRaw(DAILY_KEY, JSON.stringify({ version: 1, days: memDays }))
  }

  function progressOf(days, date) {
    var record = days[date]
    if (!record) return 0
    return TASKS.filter(function (task) { return record[task] === true }).length
  }

  // ── 이야기 진행 ─────────────────────────
  function cleanStory(value) {
    var empty = { unlockedDates: [], lastViewed: 0 }
    if (!value || value.version !== 1 || !Array.isArray(value.unlockedDates)) return empty
    var now = today()
    var seen = {}
    var dates = []
    value.unlockedDates.forEach(function (date) {
      if (!isRealDate(date) || date > now || seen[date]) return
      seen[date] = true
      dates.push(date)
    })
    dates.sort()
    dates = dates.slice(0, STORY_TOTAL)
    var viewed = value.lastViewed
    if (typeof viewed !== 'number' || viewed % 1 !== 0 || viewed < 0 || viewed > dates.length) viewed = 0
    return { unlockedDates: dates, lastViewed: viewed }
  }

  function loadStory() {
    var stored = cleanStory(parseJson(readRaw(STORY_KEY)))
    var merged = cleanStory({ version: 1, unlockedDates: memStory.unlockedDates.concat(stored.unlockedDates), lastViewed: 0 })
    var viewed = memStory.lastViewed || stored.lastViewed
    if (viewed > merged.unlockedDates.length) viewed = 0
    memStory = { unlockedDates: merged.unlockedDates, lastViewed: viewed }
    return memStory
  }

  function saveStory() {
    return writeRaw(STORY_KEY, JSON.stringify({ version: 1, unlockedDates: memStory.unlockedDates, lastViewed: memStory.lastViewed }))
  }

  // 3/3 인 날짜를 이야기 해금 날짜에 반영(같은 날짜는 한 번만). 컷이 늘었으면 true
  function syncStory() {
    var days = loadDays()
    var before = loadStory().unlockedDates.length
    var completed = Object.keys(days).filter(function (date) { return progressOf(days, date) === TASKS.length })
    var merged = cleanStory({ version: 1, unlockedDates: memStory.unlockedDates.concat(completed), lastViewed: 0 })
    memStory = { unlockedDates: merged.unlockedDates, lastViewed: memStory.lastViewed > merged.unlockedDates.length ? 0 : memStory.lastViewed }
    var changed = memStory.unlockedDates.length > before
    saveStory()
    return changed
  }

  // ── 변화 알림 ───────────────────────────
  function emit() {
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('stockd:missions-changed'))
      }
    } catch (error) {
      // 알림 실패는 무시
    }
  }

  function whenReady(callback) {
    if (typeof document === 'undefined') return
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback)
    } else {
      callback()
    }
  }

  function announce(message) {
    whenReady(function () {
      try {
        if (typeof root.toast === 'function') root.toast(message)
      } catch (error) {
        // 토스트 실패는 무시
      }
    })
  }

  // ── 공개 기능 ───────────────────────────
  function recordTask(task) {
    var date = today()
    var days = loadDays()
    var prev = days[date] || { opened: false, inventory: false, orders: false }
    if (prev[task] && prev.opened) return { changed: false, progress: progressOf(days, date), storyUnlocked: false }
    days[date] = { opened: true, inventory: prev.inventory, orders: prev.orders }
    days[date][task] = true
    memDays = days
    saveDays()
    var storyUnlocked = syncStory()
    emit()
    return { changed: true, progress: progressOf(memDays, date), storyUnlocked: storyUnlocked }
  }

  function isHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  // 방문 기록: dashboard=열기, inventory=재고, orders=주문. 그 외 페이지는 아무 것도 기록하지 않음
  function taskOfPage(pageId) {
    return Object.prototype.hasOwnProperty.call(PAGE_TASK, pageId) ? PAGE_TASK[pageId] : null
  }

  // 주소의 ?state= 가 불러오는 중·오류·권한 없음이면 true (재고·주문 화면만 해당)
  function isUnrecordedView(pageId) {
    if (STATE_PAGES.indexOf(pageId) < 0) return false
    try {
      var search = (window.location && window.location.search) || ''
      var match = /[?&]state=([^&#]*)/.exec(search)
      return !!match && UNRECORDED_STATES.indexOf(decodeURIComponent(match[1])) >= 0
    } catch (error) {
      return false
    }
  }

  function recordVisit(pageId) {
    var task = taskOfPage(pageId)
    if (!task) return null
    if (isUnrecordedView(pageId)) return getTodaySummary()
    if (isHidden()) {
      pendingVisitPage = pageId
      return null
    }
    pendingVisitPage = null
    var result = recordTask(task)
    if (result.changed) {
      if (result.progress === TASKS.length) {
        announce('오늘의 화면 방문 3개를 모두 기록했습니다(실제 점검 완료가 아닙니다). ' + (result.storyUnlocked ? '상자 친구의 다음 이야기가 열렸어요. 매일 확인에서 읽어 보세요.' : '완료 도장을 찍었어요.'))
      } else if (task !== 'opened') {
        announce((task === 'inventory' ? '재고' : '주문') + ' 화면 방문을 오늘 기록에 남겼습니다(' + (task === 'inventory' ? '재고' : '주문') + ' 점검 완료가 아닙니다). ' + result.progress + '/3')
      }
    }
    return getTodaySummary()
  }

  function getTodaySummary() {
    var date = today()
    var days = loadDays()
    var record = days[date] || {}
    var steps = TASKS.map(function (task) {
      return { id: task, label: TASK_LABELS[task], done: record[task] === true }
    })
    var done = steps.filter(function (step) { return step.done }).length
    return { date: date, done: done, total: TASKS.length, steps: steps, storageBlocked: storageBlocked }
  }

  // 최근 7일(오래된 날짜 → 오늘). done=0~3, stamped=3/3 인 날
  function getWeek() {
    var now = today()
    var days = loadDays()
    var list = []
    for (var offset = -6; offset <= 0; offset += 1) {
      var date = offsetDate(now, offset)
      var count = progressOf(days, date)
      list.push({ date: date, done: count, stamped: count === TASKS.length, today: date === now })
    }
    return list
  }

  // 일일 기록 삭제: 오늘 페이지 열기만 남김(1/3). 이야기 진행은 유지
  function clearDaily() {
    var now = today()
    memDays = {}
    memDays[now] = { opened: true, inventory: false, orders: false }
    removeRaw(DAILY_KEY)
    saveDays()
    emit()
    return getTodaySummary()
  }

  function getStoryProgress() {
    syncStory()
    var story = loadStory()
    return {
      unlocked: story.unlockedDates.length,
      total: STORY_TOTAL,
      lastViewed: story.lastViewed,
      unlockedDates: story.unlockedDates.slice()
    }
  }

  // 읽은 컷 번호 기억(열린 컷 범위만). 저장 성공 여부와 무관하게 메모리에는 반영
  function markStoryViewed(n) {
    var story = loadStory()
    var index = Number(n)
    if (index % 1 !== 0 || index < 1 || index > story.unlockedDates.length) return false
    memStory.lastViewed = index
    saveStory()
    return true
  }

  // ── 날짜 변경·다른 탭 동기화 ────────────
  function currentPageId() {
    try {
      return (document.body && document.body.getAttribute('data-page')) || ''
    } catch (error) {
      return ''
    }
  }

  function checkDateChange() {
    var now = today()
    if (now === lastDate) return
    lastDate = now
    var page = currentPageId()
    if (taskOfPage(page)) recordVisit(page)
    emit()
  }

  function onVisible() {
    if (isHidden()) return
    if (pendingVisitPage) {
      recordVisit(pendingVisitPage)
    }
    checkDateChange()
  }

  function onStorage(event) {
    if (event && event.key && event.key !== DAILY_KEY && event.key !== STORY_KEY) return
    if (event && event.key === DAILY_KEY && event.newValue === null) {
      // 다른 탭에서 일일 기록을 삭제함: 오늘 열기만 남김
      memDays = {}
      memDays[today()] = { opened: true, inventory: false, orders: false }
    }
    syncStory()
    emit()
  }

  var api = {
    recordVisit: recordVisit,
    getTodaySummary: getTodaySummary,
    getWeek: getWeek,
    clearDaily: clearDaily,
    getStoryProgress: getStoryProgress,
    markStoryViewed: markStoryViewed,
    getToday: today
  }
  Object.defineProperty(api, 'storageBlocked', {
    enumerable: true,
    get: function () { return storageBlocked }
  })
  root.missions = api

  // 초기화: 저장소 확인 → 기록 정리 → 이야기 소급 → 방문 기록
  probeStorage()
  lastDate = today()
  try {
    syncStory()
  } catch (error) {
    // 손상된 저장 데이터가 있어도 화면은 계속 동작
  }
  recordVisit(currentPageId())

  if (typeof document !== 'undefined') {
    try {
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
      window.addEventListener('storage', onStorage)
      window.setInterval(function () {
        if (!isHidden()) checkDateChange()
      }, 30000)
    } catch (error) {
      // 이벤트 등록 실패는 무시
    }
  }
})()
