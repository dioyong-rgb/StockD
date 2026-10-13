/* 공통 레이아웃 삽입 스크립트 (사이드바·상단바·푸터·샘플 띠·토스트) */
(function () {
  var root = window.StockD = window.StockD || {}

  // 업무 메뉴 정의 (파일명 고정)
  var MENUS = [
    { id: 'dashboard', label: '대시보드', href: 'index.html' },
    { id: 'inventory', label: '통합 재고', href: 'inventory.html' },
    { id: 'orders', label: '통합 주문', href: 'orders.html' },
    { id: 'mappings', label: '상품 연결', href: 'mappings.html' },
    { id: 'alerts', label: '알림', href: 'alerts.html' },
    { id: 'settings', label: '연결·설정', href: 'settings.html' },
    { id: 'missions', label: '매일 확인', href: 'missions.html', divider: true }
  ]

  var TOAST_DURATION = 3000
  var toastTimer = null
  var toastEl = null

  // 메뉴 목록 HTML 생성
  function buildMenuItems() {
    return MENUS.map(function (menu) {
      var divider = menu.divider ? '<li class="side-nav-divider" role="presentation"></li>' : ''
      return divider + '<li><a class="side-nav-link" href="' + menu.href + '" data-page-id="' + menu.id + '">' + menu.label + '</a></li>'
    }).join('')
  }

  function buildSidebar() {
    // aside 는 complementary landmark 이므로 "주 메뉴"는 안쪽 nav 가 맡고 aside 는 "사이드바"로 구분한다
    return '<aside class="sidebar" aria-label="사이드바">' +
      '<a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>StockD</strong></a>' +
      '<p class="brand-sub">재고와 주문을 한곳에서</p>' +
      '<nav class="side-nav" aria-label="주 메뉴"><ul>' + buildMenuItems() + '</ul></nav>' +
      '<div class="sidebar-bottom">쇼핑몰 조회 전용 · 쓰기 기능 없음</div>' +
      '</aside>'
  }

  function buildTopbar() {
    return '<header class="topbar">' +
      '<div class="topbar-start">첫 번째 작업 공간 <span class="badge badge-sample">샘플</span></div>' +
      '<div class="topbar-end">' +
      '<span class="topbar-date">예시 기준 2026.10.04</span>' +
      '<span class="read-only">쇼핑몰 조회 전용</span>' +
      '<a class="topbar-link" href="help.html">도움말</a>' +
      '<details class="user-menu">' +
      '<summary>DEMO-user <span class="badge badge-auth">인증 미구현</span></summary>' +
      '<div class="user-menu-panel">' +
      '<p>가상 계정입니다. 실제 로그인은 연결되어 있지 않습니다.</p>' +
      '<a href="login.html">로그인 화면</a>' +
      '<button type="button" disabled>로그아웃 (준비 중)</button>' +
      '</div></details>' +
      '</div></header>'
  }

  function buildFooter(isBare) {
    var links = isBare ? '' :
      '<nav class="footer-links" aria-label="공통 페이지">' +
      '<a href="about.html">회사 소개</a>' +
      '<a href="help.html">도움말</a>' +
      '<a href="terms.html">이용약관</a>' +
      '<a href="privacy.html">개인정보처리방침</a>' +
      '</nav>'
    return '<footer class="app-footer"><div class="footer-inner">' +
      '<p class="footer-desc">네이버·쿠팡 재고·주문을 조회하는 읽기 전용 도구</p>' +
      links +
      '<p class="footer-copy">© 2026 [회사명 입력 필요]. All rights reserved. <span class="badge badge-sample">샘플 시안</span></p>' +
      '</div></footer>'
  }

  function buildBanner() {
    return '<div class="sample-banner" role="note"><strong>샘플 데이터 · 실제 API 미연동</strong>' +
      '<span class="sample-banner-note">화면 구성과 사용 흐름을 확인하는 시안입니다.</span></div>'
  }

  // 사용자 메뉴 닫기: 바깥 클릭/Escape, 닫힌 뒤 summary 로 초점 복귀
  function bindUserMenu(menu) {
    var summary = menu.querySelector('summary')
    document.addEventListener('click', function (event) {
      if (menu.open && !menu.contains(event.target)) {
        menu.open = false
      }
    })
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false
        if (summary) summary.focus()
      }
    })
  }

  // 활성 메뉴 지정 (공통 페이지 등 목록에 없는 id 는 모두 해제)
  function setActive(pageId) {
    var links = document.querySelectorAll('.side-nav-link')
    var current = null
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i]
      if (link.getAttribute('data-page-id') === pageId) {
        link.setAttribute('aria-current', 'page')
        current = link
      } else {
        link.removeAttribute('aria-current')
      }
    }
    // 960px 미만 가로 메뉴에서 현재 메뉴가 보이도록 스크롤
    var nav = document.querySelector('.side-nav')
    if (current && nav && window.innerWidth < 960 && nav.scrollWidth > nav.clientWidth) {
      var target = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2
      nav.scrollLeft = Math.max(0, target)
    }
  }

  // 토스트 표시 (약 3초 후 숨김)
  function toast(message) {
    if (!toastEl) return
    toastEl.textContent = message
    toastEl.hidden = false
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(function () {
      toastEl.hidden = true
    }, TOAST_DURATION)
  }

  function init() {
    var body = document.body
    var pageId = body.getAttribute('data-page') || ''
    var isBare = body.getAttribute('data-layout') === 'bare'

    // 효과 기본값은 'on' (페이지가 직접 지정했거나 설정 화면에서 바꾼 값은 유지)
    if (!body.dataset.effects) body.dataset.effects = 'on'

    var main = document.getElementById('main')
    if (!main) {
      main = document.createElement('main')
      main.id = 'main'
      main.className = 'page'
    }
    main.classList.add('app-main')
    main.setAttribute('tabindex', '-1')

    // 건너뛰기 링크 + 샘플 띠
    var head = document.createElement('div')
    head.innerHTML = '<a class="skip-link" href="#main">본문 바로가기</a>' + buildBanner()

    // 앱 셸 (main 은 기존 노드를 그대로 옮긴다)
    var shell = document.createElement('div')
    shell.className = isBare ? 'app-shell app-shell-bare' : 'app-shell'
    if (isBare) {
      shell.innerHTML = buildFooter(true)
      shell.insertBefore(main, shell.firstChild)
    } else {
      shell.innerHTML = buildSidebar() + buildTopbar() + buildFooter(false)
      shell.insertBefore(main, shell.querySelector('.app-footer'))
    }

    var first = body.firstChild
    while (head.firstChild) body.insertBefore(head.firstChild, first)
    body.insertBefore(shell, first)

    // 토스트 컨테이너 (기존 것이 있으면 재사용)
    toastEl = document.querySelector('.toast')
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'toast toast-confirm'
      toastEl.setAttribute('role', 'status')
      toastEl.setAttribute('aria-live', 'polite')
      toastEl.hidden = true
      body.appendChild(toastEl)
    } else {
      toastEl.classList.add('toast-confirm')
    }

    if (!isBare) {
      setActive(pageId)
      var userMenu = shell.querySelector('.user-menu')
      if (userMenu) bindUserMenu(userMenu)
      window.addEventListener('resize', function () {
        setActive(body.getAttribute('data-page') || '')
      })
    }
  }

  root.layout = { setActive: setActive }
  root.toast = toast

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
