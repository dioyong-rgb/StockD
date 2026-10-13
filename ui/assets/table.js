/*
 * StockD 표 공용 동작 (외부 요청 없음, file:// 호환)
 * - StockD.table.createFilterableTable(options)
 * - StockD.table.openDetail(dialogEl, html, triggerEl)
 * - StockD.table.applyStateParam(container, pageName)
 * - StockD.table.escapeHtml(str)
 * - StockD.table.buildDialogHtml({ title, subtitle, bodyHtml })
 */
(function () {
  window.StockD = window.StockD || {}
  var StockD = window.StockD

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  var uid = 0
  function nextId(prefix) {
    uid += 1
    return prefix + '-' + uid
  }

  // ───────── UI 상태 카드 ─────────
  var STATES = ['loading', 'empty', 'error', 'stale', 'partial', 'unauthorized']
  // 대체형: 본문 대신 카드만 표시 / 덧붙임형: 본문 위에 카드 + 본문 유지
  var REPLACING = { loading: true, empty: true, error: true, unauthorized: true }
  var NOUNS = { inventory: '재고', orders: '주문', mappings: '연결 후보', alerts: '알림' }

  function stateCopy(state, noun) {
    var copy = {
      loading: { label: '불러오는 중', title: '불러오는 중입니다', text: noun + ' 샘플을 준비하고 있습니다. 잠시 후 목록이 표시되는 상태의 예시입니다.' },
      empty: { label: '데이터 없음', title: '표시할 ' + noun + ' 샘플이 없습니다', text: '조회는 정상이지만 항목이 하나도 없는 상태의 예시입니다. 필터 결과 없음과는 다릅니다.' },
      error: { label: '조회 실패', title: noun + ' 정보를 불러오지 못했습니다', text: '조회 오류 상태의 예시입니다. 오류는 수량 0으로 바꾸지 않고, 확인 전 값은 비워서 표시합니다.' },
      stale: { label: '확인 지연', title: '최신 상태를 확인하지 못했습니다', text: '최근 조회가 실패해 마지막 성공값을 보여주는 상태의 예시입니다. 아래 값은 현재 값이 아닐 수 있습니다.' },
      partial: { label: '일부만 표시', title: '일부 ' + noun + ' 정보만 표시됩니다', text: '일부 채널의 조회가 끝나지 않은 상태의 예시입니다. 표시되지 않은 항목이 없다는 뜻이 아닙니다.' },
      unauthorized: { label: '권한 없음', title: '이 화면을 볼 권한이 없습니다', text: '조회 권한이 없는 상태의 예시입니다. 인증은 이 시안에 구현되어 있지 않습니다.' }
    }
    return copy[state]
  }

  function readStateParam() {
    try {
      var value = new URLSearchParams(window.location.search).get('state')
      return STATES.indexOf(value) >= 0 ? value : null
    } catch (error) {
      return null
    }
  }

  function currentFileName() {
    var parts = window.location.pathname.split('/')
    return parts[parts.length - 1] || 'index.html'
  }

  function buildStateCard(state, noun) {
    var copy = stateCopy(state, noun)
    var role = state === 'error' || state === 'unauthorized' ? 'alert' : 'status'
    var extra = ''
    if (state === 'loading') {
      extra = '<div class="skeleton" aria-hidden="true"><span class="skeleton-line"></span><span class="skeleton-line"></span><span class="skeleton-line"></span></div>'
    }
    var actions = '<div class="state-card-actions"><a class="button" href="' + escapeHtml(currentFileName()) + '">정상 샘플 화면 보기</a></div>'
    var html = '<section class="state-card state-card-' + state + '" role="' + role + '" data-state-card="' + state + '">' +
      '<p class="state-card-label">' + escapeHtml(copy.label) + '</p>' +
      '<h2>' + escapeHtml(copy.title) + '</h2>' +
      '<p>' + escapeHtml(copy.text) + '</p>' +
      extra + actions + '</section>'
    return html
  }

  // URL ?state= 를 읽어 상태 카드로 대체/표시. 반환: { state, replaced } 또는 null(정상 표시)
  function applyStateParam(container, pageName) {
    var state = readStateParam()
    if (!state || !container) return null
    var noun = NOUNS[pageName] || '데이터'
    var html = buildStateCard(state, noun)
    container.setAttribute('data-state', state)
    if (REPLACING[state]) {
      container.innerHTML = html
      return { state: state, replaced: true }
    }
    container.insertAdjacentHTML('afterbegin', html)
    return { state: state, replaced: false }
  }

  // ───────── 상세 다이얼로그 ─────────
  var triggers = new WeakMap()
  var bound = new WeakSet()

  function bindDialog(dialogEl) {
    if (bound.has(dialogEl)) return
    bound.add(dialogEl)
    // 닫기 버튼(상세 닫기) 위임
    dialogEl.addEventListener('click', function (event) {
      var target = event.target
      if (target === dialogEl) {
        // 배경(backdrop) 클릭
        dialogEl.close()
        return
      }
      if (target.closest && target.closest('[data-dialog-close], .icon-button[aria-label="상세 닫기"]')) {
        dialogEl.close()
      }
    })
    // Escape 포함 모든 닫힘 → 초점 복귀
    dialogEl.addEventListener('close', function () {
      var trigger = triggers.get(dialogEl)
      triggers.delete(dialogEl)
      if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') {
        trigger.focus()
      }
    })
  }

  function openDetail(dialogEl, html, triggerEl) {
    if (!dialogEl) return
    bindDialog(dialogEl)
    dialogEl.innerHTML = html
    var heading = dialogEl.querySelector('h2')
    if (heading) {
      if (!heading.id) heading.id = nextId('dialog-title')
      dialogEl.setAttribute('aria-labelledby', heading.id)
    }
    triggers.set(dialogEl, triggerEl || document.activeElement)
    if (typeof dialogEl.showModal === 'function') {
      if (!dialogEl.open) dialogEl.showModal()
    } else {
      dialogEl.setAttribute('open', '')
    }
    var body = dialogEl.querySelector('.dialog-body')
    if (body) body.scrollTop = 0
  }

  // 표준 다이얼로그 마크업 (제목·부제는 이스케이프, bodyHtml 은 호출자가 이스케이프한 HTML)
  function buildDialogHtml(parts) {
    return '<div class="dialog-header"><div><h2>' + escapeHtml(parts.title) + '</h2>' +
      (parts.subtitle ? '<p>' + escapeHtml(parts.subtitle) + '</p>' : '') +
      '</div><button type="button" class="icon-button" data-dialog-close aria-label="상세 닫기"><span aria-hidden="true">✕</span></button></div>' +
      '<div class="dialog-body">' + (parts.bodyHtml || '') + '</div>'
  }

  // ───────── 필터 가능한 표 ─────────
  /*
   * options = {
   *   container: Element,
   *   rows: Array | function() => Array,
   *   columns: [{ key, label, sublabel, render(row) => html, className, align:'right', detail, hideMobile, title }],
   *   rowId: function(row) => string (기본 row.id),
   *   search: { id, label, placeholder, text(row) => string },
   *   filters: [{ id, label, type:'select'|'date', options:[{value,label}], allLabel, defaultValue, match(row, value) }],
   *   validate: function(values) => { title, text } | null   (예: 날짜 범위 오류)
   *   emptyMessage: { title, text },
   *   onRowClick: function(row, triggerEl),   // 있으면 '상세' 버튼과 행 클릭 제공
   *   actionLabel: '상세', actionAriaLabel: function(row) => string,
   *   summaryLabel: function(count, total) => string, summaryHint: string,
   *   tableLabel: string, minWidth: '1040px', footnote: string (HTML 아님, 텍스트),
   *   pageName: 'inventory' | 'orders' (주어지면 ?state= 처리),
   *   readQuery: true (필터 id 와 같은 쿼리 파라미터로 초기값 설정)
   * }
   */
  function createFilterableTable(options) {
    var container = options.container
    var noop = {
      container: container,
      refresh: function () {},
      reset: function () {},
      setRows: function () {},
      setFilter: function () {},
      getFiltered: function () { return [] },
      stateApplied: null
    }
    if (!container) return noop

    var prefix = nextId(options.idPrefix || 'tbl')
    var stateInfo = options.pageName ? applyStateParam(container, options.pageName) : null
    if (stateInfo && stateInfo.replaced) {
      noop.stateApplied = stateInfo
      return noop
    }

    var filters = options.filters || []
    var search = options.search || null
    var columns = options.columns || []
    var values = {}

    function getRows() {
      return typeof options.rows === 'function' ? options.rows() : (options.rows || [])
    }
    function rowId(row) {
      return options.rowId ? options.rowId(row) : row.id
    }

    function defaultValues() {
      var result = {}
      if (search) result[search.id] = ''
      filters.forEach(function (filter) {
        result[filter.id] = filter.defaultValue !== undefined ? filter.defaultValue : ''
      })
      return result
    }

    // 쿼리 파라미터로 초기 필터 지정 (예: inventory.html?status=attention)
    function applyQuery(initial) {
      if (options.readQuery === false) return
      var params
      try { params = new URLSearchParams(window.location.search) } catch (error) { return }
      filters.forEach(function (filter) {
        var queryValue = params.get(filter.param || filter.id)
        if (queryValue === null) return
        if (filter.type === 'date' || (filter.options || []).some(function (option) { return option.value === queryValue })) {
          initial[filter.id] = queryValue
        }
      })
    }

    values = defaultValues()
    applyQuery(values)

    // 골격: 상태 슬롯 / 필터 / 결과
    var slot = container.querySelector('[data-table-state-slot]')
    container.innerHTML = '<div data-table-state-slot></div><form class="filter-bar" role="search" aria-label="' + escapeHtml(options.filterLabel || '표 필터') + '"></form>' +
      // 건수 줄은 한 번만 만들고 글자만 갱신한다 (새로 생긴 live region 은 낭독되지 않을 수 있음)
      '<div class="result-summary" role="status" data-table-summary><strong></strong>' +
      (options.summaryHint ? '<span class="secondary-hint">' + escapeHtml(options.summaryHint) + '</span>' : '') + '</div>' +
      '<div data-table-results></div>'
    slot = container.querySelector('[data-table-state-slot]')
    var form = container.querySelector('form')
    var results = container.querySelector('[data-table-results]')
    if (stateInfo) slot.innerHTML = buildStateCard(stateInfo.state, NOUNS[options.pageName] || '데이터')

    // 필터 바 (한 번만 그림: 입력 중 초점 유지)
    var formHtml = ''
    if (search) {
      var searchId = prefix + '-' + search.id
      formHtml += '<div class="field filter-search"><label for="' + searchId + '">' + escapeHtml(search.label || '검색') + '</label>' +
        '<input id="' + searchId + '" type="search" data-filter="' + escapeHtml(search.id) + '" placeholder="' + escapeHtml(search.placeholder || '') + '" autocomplete="off"></div>'
    }
    filters.forEach(function (filter) {
      var fieldId = prefix + '-' + filter.id
      formHtml += '<div class="field"><label for="' + fieldId + '">' + escapeHtml(filter.label) + '</label>'
      if (filter.type === 'date') {
        formHtml += '<input id="' + fieldId + '" type="date" data-filter="' + escapeHtml(filter.id) + '">'
      } else {
        formHtml += '<select id="' + fieldId + '" data-filter="' + escapeHtml(filter.id) + '">'
        formHtml += '<option value="">' + escapeHtml(filter.allLabel || '전체') + '</option>'
        ;(filter.options || []).forEach(function (option) {
          formHtml += '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>'
        })
        formHtml += '</select>'
      }
      formHtml += '</div>'
    })
    formHtml += '<div class="filter-actions"><button type="button" class="button" data-filter-reset>필터 초기화</button></div>'
    form.innerHTML = formHtml

    function syncControls() {
      Array.prototype.forEach.call(form.querySelectorAll('[data-filter]'), function (control) {
        control.value = values[control.getAttribute('data-filter')] || ''
      })
    }

    function matches(row) {
      if (search && values[search.id]) {
        var haystack = String(search.text(row) || '').toLowerCase()
        if (haystack.indexOf(String(values[search.id]).trim().toLowerCase()) < 0) return false
      }
      return filters.every(function (filter) {
        var value = values[filter.id]
        if (value === '' || value === null || value === undefined) return true
        return filter.match ? !!filter.match(row, value) : true
      })
    }

    function getFiltered() {
      return getRows().filter(matches)
    }

    function emptyHtml(title, text, withReset) {
      return '<div class="empty-state" role="status"><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(text) + '</p>' +
        (withReset ? '<button type="button" class="button button-small" data-filter-reset>필터 초기화</button>' : '') + '</div>'
    }

    function renderHead() {
      return '<thead><tr>' + columns.map(function (column) {
        var classes = []
        if (column.detail) classes.push('col-detail')
        if (column.hideMobile) classes.push('col-hide-mobile')
        if (column.align === 'right') classes.push('align-right')
        var attr = classes.length ? ' class="' + classes.join(' ') + '"' : ''
        return '<th scope="col"' + attr + '>' + escapeHtml(column.label) +
          (column.sublabel ? ' <span class="secondary">' + escapeHtml(column.sublabel) + '</span>' : '') + '</th>'
      }).join('') + (options.onRowClick ? '<th scope="col"><span class="sr-only">상세</span></th>' : '') + '</tr></thead>'
    }

    function renderRow(row) {
      var id = rowId(row)
      var cells = columns.map(function (column) {
        var classes = []
        if (column.title) classes.push('cell-title')
        if (column.detail) classes.push('col-detail')
        if (column.hideMobile) classes.push('col-hide-mobile')
        if (column.align === 'right') classes.push('align-right')
        if (column.className) classes.push(column.className)
        var content = column.render ? column.render(row) : escapeHtml(row[column.key])
        return '<td' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + ' data-label="' + escapeHtml(column.label) + '"><div class="cell-value">' + content + '</div></td>'
      }).join('')
      var action = ''
      if (options.onRowClick) {
        var ariaLabel = options.actionAriaLabel ? options.actionAriaLabel(row) : (options.actionLabel || '상세') + ' 보기'
        action = '<td class="cell-actions" data-label=""><button type="button" class="button button-small" data-row-action="' + escapeHtml(id) + '" aria-label="' + escapeHtml(ariaLabel) + '">' + escapeHtml(options.actionLabel || '상세') + '</button></td>'
      }
      return '<tr' + (options.onRowClick ? ' class="row-clickable"' : '') + ' data-row-id="' + escapeHtml(id) + '">' + cells + action + '</tr>'
    }

    // 건수 줄 갱신: 요소는 그대로 두고 글자만 바꾼다
    var summaryLabelEl = container.querySelector('[data-table-summary] strong')
    function updateSummary(count, total) {
      var label = options.summaryLabel ? options.summaryLabel(count, total) : '샘플 ' + count + '개 / 전체 ' + total + '개'
      summaryLabelEl.textContent = label
    }

    function refresh() {
      var all = getRows()
      var invalid = options.validate ? options.validate(values) : null
      var filtered = invalid ? [] : all.filter(matches)
      updateSummary(filtered.length, all.length)
      var html = ''
      if (invalid) {
        html += emptyHtml(invalid.title, invalid.text, false)
      } else if (filtered.length === 0) {
        var empty = options.emptyMessage || {}
        html += emptyHtml(
          empty.title || '조건에 맞는 샘플이 없습니다',
          empty.text || '검색어나 필터를 바꿔 보세요. 이 결과는 API 조회 실패가 아닙니다.',
          true
        )
      } else {
        var label = options.tableLabel || '표'
        html += '<p class="scroll-hint">표를 좌우로 움직여 확인하세요.</p>' +
          '<div class="table-scroll" tabindex="0" role="region" aria-label="' + escapeHtml(label + '. 좁은 화면에서는 가로로 스크롤하세요.') + '"' +
          (options.minWidth ? ' style="--table-min:' + escapeHtml(options.minWidth) + '"' : '') + '>' +
          '<table class="table responsive-table">' + renderHead() +
          '<tbody>' + filtered.map(renderRow).join('') + '</tbody></table></div>'
      }
      if (options.footnote) html += '<p class="table-footnote">' + escapeHtml(options.footnote) + '</p>'
      results.innerHTML = html
    }

    function reset() {
      values = defaultValues()
      syncControls()
      refresh()
    }

    // 이벤트
    form.addEventListener('submit', function (event) { event.preventDefault() })
    form.addEventListener('input', function (event) {
      var key = event.target.getAttribute && event.target.getAttribute('data-filter')
      if (!key) return
      values[key] = event.target.value
      refresh()
    })
    form.addEventListener('change', function (event) {
      var key = event.target.getAttribute && event.target.getAttribute('data-filter')
      if (!key) return
      values[key] = event.target.value
      refresh()
    })
    container.addEventListener('click', function (event) {
      var target = event.target
      if (!target.closest) return
      var resetButton = target.closest('[data-filter-reset]')
      if (resetButton && container.contains(resetButton)) {
        reset()
        // 초기화 후 초점을 첫 입력으로
        var first = form.querySelector('[data-filter]')
        if (first) first.focus()
        return
      }
      if (!options.onRowClick) return
      var actionButton = target.closest('[data-row-action]')
      var rowEl = target.closest('tr[data-row-id]')
      if (!rowEl || !results.contains(rowEl)) return
      // 행의 다른 버튼/링크 클릭은 행 클릭으로 취급하지 않음
      var interactive = target.closest('button, a, input, select, textarea')
      if (interactive && interactive !== actionButton) return
      var id = rowEl.getAttribute('data-row-id')
      var row = getRows().filter(function (item) { return String(rowId(item)) === id })[0]
      if (!row) return
      options.onRowClick(row, actionButton || rowEl.querySelector('[data-row-action]') || rowEl)
    })

    syncControls()
    refresh()

    return {
      container: container,
      refresh: refresh,
      reset: reset,
      stateApplied: stateInfo,
      getFiltered: getFiltered,
      setRows: function (rows) {
        options.rows = rows
        refresh()
      },
      setFilter: function (id, value) {
        values[id] = value
        syncControls()
        refresh()
      }
    }
  }

  StockD.table = {
    createFilterableTable: createFilterableTable,
    openDetail: openDetail,
    applyStateParam: applyStateParam,
    escapeHtml: escapeHtml,
    buildDialogHtml: buildDialogHtml
  }
})()
