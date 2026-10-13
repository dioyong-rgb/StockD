/*
 * 연재 이야기 "상자 친구의 여행" 데이터 (3편 15컷)
 * - 허구 이야기이며 실제 재고·주문·연결 상태와 무관합니다.
 * - 장식용 SVG 는 문자열로 조립합니다(외부 이미지·요청 없음).
 * - StockD.story = { title, total, episodes: [{ number, title, from, to }], cuts: [{ index, episode, episodeTitle, title, text, art }] }
 */
(function () {
  var root = window.StockD = window.StockD || {}

  // 3편 제목 (컷 1~5, 6~10, 11~15)
  var episodes = [
    { number: 1, title: '바람 우체국으로', from: 1, to: 5 },
    { number: 2, title: '등대의 작은 불빛', from: 6, to: 10 },
    { number: 3, title: '다음 길의 약속', from: 11, to: 15 }
  ]

  // 컷 제목과 본문(2문장)
  var scenes = [
    ['지도 발견', '상자 친구는 낡은 지도에서 바람 우체국을 찾았습니다. 작은 편지를 품고 첫걸음을 뗐습니다.'],
    ['작은 다리', '개울 위 다리가 바람에 살짝 흔들렸습니다. 상자 친구는 편지를 꼭 안고 천천히 건넜습니다.'],
    ['갈림길', '숲 끝에서 두 갈래 길을 만났습니다. 지도 속 깃털 표시를 따라 밝은 길로 향했습니다.'],
    ['바람 우체통', '언덕 위에서 작은 우체통이 기다리고 있었습니다. 상자 친구는 편지를 넣고 덮개를 조용히 닫았습니다.'],
    ['편지 도착', '멀리서 편지를 받은 친구의 종소리가 들렸습니다. 상자 친구는 지도에 첫 여행의 별을 그렸습니다.'],
    ['유리 조각', '해변에서 햇빛을 담은 유리 조각을 발견했습니다. 상자 친구는 그 빛을 등대에 전하고 싶었습니다.'],
    ['바닷길', '파도가 물러나자 바닷길이 나타났습니다. 상자 친구는 반짝이는 돌 사이를 따라 걸었습니다.'],
    ['바람 언덕', '등대 앞 언덕에서 바람이 세게 불었습니다. 상자 친구는 낮은 풀 곁에서 잠깐 숨을 골랐습니다.'],
    ['작은 불빛', '등대 창가에 유리 조각을 놓았습니다. 저녁빛이 조각을 지나 작은 불빛을 만들었습니다.'],
    ['바다의 인사', '먼 배가 불빛을 보고 조용히 손을 흔들었습니다. 상자 친구도 덮개를 살짝 들어 인사했습니다.'],
    ['다시 지도', '상자 친구는 쉬는 자리에서 지도를 펼쳤습니다. 아직 이름 없는 길 하나가 눈에 들어왔습니다.'],
    ['새 친구', '길 입구에서 작은 종이배 친구를 만났습니다. 둘은 서로의 여행 이야기를 나누었습니다.'],
    ['나무 쉼터', '큰 나무 아래에 둘만의 쉼터를 만들었습니다. 잠깐 쉬어도 여행은 이어진다는 것을 알았습니다.'],
    ['지도 전달', '상자 친구는 지도에 발견한 길을 그려 넣었습니다. 종이배 친구에게 한 장을 접어 건넸습니다.'],
    ['다음 여행 약속', '두 친구는 다음 바람이 불면 다시 만나기로 했습니다. 상자 친구는 새 여행을 기다리며 지도를 품었습니다.']
  ]

  // 컷별 소품 (viewBox 320x240 좌표계, 우측 배치)
  var props = [
    // 1 지도 발견
    '<path d="m232 127 24-8 25 8 23-8v66l-23 8-25-8-24 8z" fill="#fff9e9" stroke="#976116" stroke-width="2"/><path d="m246 148 17 8 18-16 13 12" fill="none" stroke="#16816a" stroke-width="3" stroke-dasharray="4 4"/>',
    // 2 작은 다리
    '<path d="M0 208q70-40 142 0t178 0v32H0" fill="#add6df"/><path d="M202 186q48-46 98 0M203 198q47-44 97 0" fill="none" stroke="#976116" stroke-width="9"/><path d="M209 161v30m28-49v36m28-36v36m27-17v30" stroke="#976116" stroke-width="3"/>',
    // 3 갈림길
    '<path d="M209 239q4-42 59-88M210 239q-2-42-21-54" fill="none" stroke="#fff9e9" stroke-width="13"/><path d="M243 92v78m-22-63h67l-12-13h-55z" fill="#fff9e9" stroke="#976116" stroke-width="3"/>',
    // 4 바람 우체통
    '<path d="M264 153v63" stroke="#976116" stroke-width="8"/><path d="M234 118q0-25 29-25h29v66h-58z" fill="#16816a"/><path d="M244 131h35m-21-29v15" stroke="#eaf6f1" stroke-width="4"/>',
    // 5 편지 도착
    '<path d="m253 102 8 17 19 3-14 13 3 19-16-9-17 9 3-19-14-13 19-3z" fill="#e9c779" stroke="#976116" stroke-width="2"/><path d="M237 172h54v35h-54z m0 0 27 19 27-19" fill="#fff9e9" stroke="#976116" stroke-width="2"/>',
    // 6 유리 조각
    '<path d="m257 164 23-26 12 31-25 19z" fill="#94cbbb" stroke="#16816a" stroke-width="2"/><path d="m270 126 4-9m18 17 9-3m-59 14-8-4" stroke="#976116" stroke-width="3"/>',
    // 7 바닷길
    '<path d="M177 205q34-26 62 0t81 0M181 221q33-25 63 0t76 0" fill="none" stroke="#77b3c3" stroke-width="3"/><path d="m222 185 14-5 7 8-16 7m43-22 15-4 8 9-16 6" fill="#fff9e9"/>',
    // 8 바람 언덕
    '<path d="M181 228q28-94 139-60v72H181" fill="#b9d4b3"/><path d="M227 180v-20m5 20 8-16m-18 16-7-13M198 91h77m-91 18h49" stroke="#16816a" stroke-width="3" stroke-linecap="round"/>',
    // 9 작은 불빛
    '<path d="m240 205 10-88h35l12 88z" fill="#fff9e9" stroke="#976116" stroke-width="2"/><path d="M243 117h49v-24h-49z" fill="#16816a"/><path d="m241 93 27-17 26 17" fill="#976116"/><path d="m250 105-43-23v46z" fill="#e9c779" opacity=".7"/><circle cx="268" cy="105" r="5" fill="#e9c779"/>',
    // 10 바다의 인사
    '<path d="M188 193q40-16 68 0t64 0" fill="none" stroke="#77b3c3" stroke-width="3"/><path d="m239 159 59 0-12 19h-34z" fill="#16816a"/><path d="M269 159v-39l23 27h-23" fill="#fff9e9" stroke="#976116" stroke-width="2"/>',
    // 11 다시 지도
    '<path d="m233 141 20-7 20 7 23-7v62l-23 7-20-7-20 7z" fill="#fff9e9" stroke="#976116" stroke-width="2"/><path d="m245 165 16-10 15 16 12-9" fill="none" stroke="#16816a" stroke-width="3"/>',
    // 12 새 친구
    '<path d="m216 178 82 0-19 33h-47z m0 0 48-34-14 34m14-34 34 34-48 0" fill="#fff9e9" stroke="#976116" stroke-width="2"/><circle cx="249" cy="188" r="2" fill="#203c37"/><circle cx="267" cy="188" r="2" fill="#203c37"/>',
    // 13 나무 쉼터
    '<path d="M258 194v-73" stroke="#976116" stroke-width="12"/><path d="M213 121q-15-34 17-45 10-45 42-19 43-17 42 29 30 20 3 42z" fill="#a9d2ba"/><path d="M215 210h80m-68 0v20m55-20v20" stroke="#976116" stroke-width="6"/>',
    // 14 지도 전달
    '<path d="m204 163 29-8 25 8v35l-25-8-29 8z" fill="#fff9e9" stroke="#976116" stroke-width="2"/><path d="m250 202 51 0-12 19h-28z" fill="#c5e1d5" stroke="#16816a" stroke-width="2"/>',
    // 15 다음 여행 약속
    '<path d="M208 215q32-62 112-52" fill="none" stroke="#fff9e9" stroke-width="17"/><path d="m245 175 60 0-15 22h-28z" fill="#fff9e9" stroke="#976116" stroke-width="2"/><path d="m262 81 6 13 14 2-10 10 2 14-12-6-12 6 2-14-10-10 14-2z" fill="#e9c779"/>'
  ]

  // 장식 SVG 조립: 2편은 청색 톤 배경, 상자 캐릭터는 좌측 고정
  function buildArt(index) {
    var chapter = Math.floor((index - 1) / 5)
    var sky = chapter === 1 ? '#e9f1f6' : '#eaf6f1'
    var ground = chapter === 1 ? '#d1e4e9' : '#cde5d6'
    return '<svg class="story-art" viewBox="0 0 320 240" aria-hidden="true" focusable="false">' +
      '<rect width="320" height="240" fill="' + sky + '"/>' +
      '<circle cx="66" cy="47" r="23" fill="#fff9e9"/>' +
      '<path d="M0 191q52-34 111-3t209-5v57H0" fill="' + ground + '"/>' +
      props[index - 1] +
      '<ellipse cx="115" cy="211" rx="56" ry="8" fill="#203c37" opacity=".09"/>' +
      '<g stroke="#203c37" stroke-width="2.5" stroke-linejoin="round">' +
      '<path d="m64 129 51-24 52 24v56l-52 26-51-26z" fill="#dff3ea"/>' +
      '<path d="m64 129 51 25 52-25m-52 25v57m-26-94 51 26" fill="none"/>' +
      '<path d="m69 183-8 14m99-14 8 14" fill="none" stroke-linecap="round"/></g>' +
      '<circle cx="87" cy="162" r="3" fill="#203c37"/><circle cx="104" cy="170" r="3" fill="#203c37"/>' +
      '<path d="m86 178q7 10 15 6" fill="none" stroke="#203c37" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="m76 91 20-10m40 8 13 5" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '</svg>'
  }

  var cuts = scenes.map(function (scene, i) {
    var index = i + 1
    var episode = episodes[Math.floor(i / 5)]
    return {
      index: index,
      episode: episode.number,
      episodeTitle: episode.title,
      title: scene[0],
      text: scene[1],
      art: buildArt(index)
    }
  })

  root.story = {
    title: '상자 친구의 여행',
    total: cuts.length,
    episodes: episodes,
    cuts: cuts
  }
})()
