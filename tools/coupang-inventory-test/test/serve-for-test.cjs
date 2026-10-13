'use strict'

// 시험 전용 서버 진입 스크립트. 시험(run-tests.cjs)이 자식 프로세스로 띄운다.
// 운영 진입점(server.cjs)과 달리 시험용 쿠팡 주소(--base-url)와 가짜 키 파일(--key-file)을 인자로 받는다.
// 주소 오버라이드는 createApp 쪽에서 가짜 키 파일(test/fixtures 또는 임시 폴더, Access Key 가 FAKE 로 시작)과
// 함께일 때만 허용되므로 실제 키로는 어떤 경우에도 시작되지 않는다.
// 표준 입력으로 'shutdown' 줄을 받으면 신호(SIGINT)와 같은 종료 처리 함수를 호출한다
// (Windows 에서는 자식에게 SIGINT 를 보낼 수 없어 이 방법으로 정상 종료 경로를 시험한다).

const path = require('node:path')
const { startServer, formatStartupFailure } = require(path.join(__dirname, '..', 'server.cjs'))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function run() {
  try {
    const { shutdown } = await startServer({
      port: Number(argValue('--port') || 0),
      keyFile: argValue('--key-file'),
      baseUrl: argValue('--base-url'),
      env: process.env,
      installHandlers: true
    })
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      if (String(chunk).includes('shutdown')) {
        shutdown()
      }
    })
  } catch (err) {
    process.stderr.write(formatStartupFailure(err) + '\n')
    process.exit(1)
  }
}

run()
