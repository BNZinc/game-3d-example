# 이 프로젝트에서 일하는 에이전트에게

이 프로젝트는 QuestiVibe 스타터 `game-3d`(실험)에서 시작했어요. 사용자는 개발자가 아닐 수 있어요. 결과를 쉬운 한국어로 짧게 알려 주세요.

## 스택 (바꾸지 마세요)
- three.js + Vite + TypeScript. 게임 코드는 `src/`, 모델·텍스처는 `public/assets/`
- 모델은 `src/assets.ts`의 `loadModel("assets/<파일>.glb")`로 읽어요. 파일이 없으면 자리표시 도형이 그대로 보여요.

## 역할이 나뉘었을 때
- **에셋 역할**: `public/assets/`와 `assets-src/`만 고쳐요. `CREDITS.md`는 도구가 쓰니 손대지 마세요(모델을 고쳤다면 그 줄 끝에 "(고침)"만 붙여요). 모델은 Polyfork(polyfork.dev, 무료 로우폴리, 키 필요 없음)에서 받아요:
  - `node tools/polyfork.mjs search "<영어 낱말>" [prop|building|vehicle|character|animal|terrain]` — 고르기
  - `node tools/polyfork.mjs get <id> <파일이름>` — `public/assets/<파일이름>.glb`로 받고 `CREDITS.md`에 Polyfork가 준 출처 줄을 자동으로 적어요
  - 다 받으면 `public/assets/ASSETS.md`에 표로 적어요: 파일 · 무엇 · 크기(m) · 게임에서 쓸 곳.
  - 먼저 Polyfork에서 찾아요. 사용자가 "직접 만든", "오리지널", "세상에 없는" 모델을 원하거나 Polyfork에 맞는 것이 없을 때만 아래 **직접 만들기 (Blender)**로 만들어요.
- **빌더 역할**: `src/`와 `index.html`만 고쳐요. 모델은 `public/assets/ASSETS.md`를 보고 `loadModel("assets/<파일>.glb")`로 읽어요. 아직 없는 모델은 자리표시로 두고 이름만 정해 두세요.

## 직접 만들기 (Blender)
이 프로젝트에는 Blender 스킬 묶음 `blender-skills`가 들어 있어요(`.agents/skills/`, Claude는 `.claude/skills/`. 길잡이는 `blender-director`, 작은 게임 모델은 `prop-artist`·`lowpoly-style`·`export-pipeline`부터).

**언제 쓰나**
- 사용자가 직접 만든(오리지널) 모델을 원할 때, 또는 Polyfork에 맞는 모델이 없을 때만 써요. 그 밖에는 Polyfork가 먼저예요.
- 팀으로 일할 때는 에셋 역할만 써요. 빌더 역할은 모델을 만들지 않아요.

**만드는 법**
1. `node tools/blender.mjs check` — Blender가 있는지 봐요(보기만 해요). 없으면 아래 **Blender가 없을 때**로 가요.
2. `assets-src/<이름>.py`에 모델을 만드는 bpy 코드를 써요. 처음 줄은 `import bpy` 다음에 `bpy.ops.wm.read_factory_settings(use_empty=True)`(빈 장면에서 시작). 내보낼 메시는 `COL_Export` 컬렉션에 넣어요(없으면 장면의 메시를 다 내보내요). 1 단위 = 1 m, 바닥에 놓이게(원점은 바닥 가운데).
3. `node tools/blender.mjs make <이름>` — Blender를 창 없이 실행해서 `public/assets/<이름>.glb`로 내보내고 `CREDITS.md`에 "직접 만듦" 줄을 적어요(같은 이름의 예전 줄은 바뀌어요). 최대 10분 걸릴 수 있으니 명령 제한 시간을 넉넉히(10분) 주세요. 오류가 나면 마지막 줄을 보고 `.py`를 고쳐 다시 실행해요.
4. `public/assets/ASSETS.md` 표에 적어요(도구가 알려 준 크기 m 그대로). 출처 칸은 "직접 만듦".

**이 프로젝트에 맞추기**
- 스킬은 Blender MCP로 실행하라고 하지만, 여기서는 **MCP를 쓰지 않아요**. 스킬의 "Fallback Mode"처럼 bpy 코드를 쓰고 위 2~3번으로 실행해요. `uvx`, `blender-mcp`, Blender 애드온, 포트 연결은 설치·실행하지 마세요.
- 스킬이 가리키는데 이 프로젝트에 없는 스킬·문서(`uv-workflow`·`rigging` 같은 다른 스킬, `.mcp.json`, `docs/BLENDER_MCP_SETUP.md` 등)는 무시해요. 들어 있는 스킬만 써요.
- `assets-src/*.py`는 `bpy`·`bmesh`·`mathutils`·`math`만 `import`해요. 인터넷 접속, `pip`, `subprocess`, 프로젝트 밖 파일 읽기·쓰기는 하지 마세요. 모델은 코드로 도형을 만들어서 만들어요.
- 뷰포트 스크린샷 단계는 건너뛰고, 도구가 알려 준 삼각형 수·크기로 확인해요. 브라우저 게임이니 모델 하나에 삼각형 5천 개 이하, 재질은 단색(Principled BSDF 기본색) 몇 개로 해요. 텍스처·HDRI·Poly Haven·Sketchfab·AI 생성 서비스는 쓰지 않아요.
- 내보내기는 GLB만 해요(도구가 해요). FBX·Unity·Unreal 설정은 무시해요.

**Blender가 없을 때**
- 사용자가 직접 만든(오리지널) 모델을 **분명히 원했을 때만** `node tools/blender.mjs make <이름>`을 한 번 실행해요(`.py`가 없어도 돼요). 그러면 앱이 Blender 설치 안내를 보여 줘요. 도구가 알려 주는 한 줄을 사용자에게 그대로 전해요: "Blender가 없어서 지금은 직접 만들 수 없어요. 앱의 Blender 안내로 설치하면 만들 수 있어요."
- 사용자가 원하지 않았는데 Polyfork에 맞는 것이 없을 뿐이면 `make`를 실행하지 말고, Polyfork에서 가장 가까운 모델이나 자리표시 도형으로 해요.
- 어느 쪽이든 무엇으로 대신했는지 짧게 말해요. Blender를 직접 받거나 설치하지 마세요(brew·curl 등 무엇으로든).

**라이선스**
- 이 스킬은 MIT예요. `.agents/skills/*`의 LICENSE·NOTICE.md를 지우지 마세요. 직접 만든 모델은 이 게임의 것이에요.

## 규칙
- dev 서버는 QuestiVibe 앱이 이미 띄워 두었어요. `pnpm dev`·`vite`를 직접 실행하지 마세요.
- 비밀값을 파일에 쓰지 마세요(`.env` 파일 금지). 브라우저 게임이라 `import.meta.env.VITE_…` 값은 **누구나 볼 수 있어요** — API 키처럼 숨겨야 하는 값은 넣지 마세요. 필요한 이름만 `.env.example`에 적고, 사용자에게 앱의 **비밀값** 탭에 넣어 달라고 말해 주세요.
- 다 고치면 `pnpm exec tsc --noEmit`으로 타입 확인을 해 주세요.

## 이 예시 게임 (노을여우)
- 해 질 녘 섬에서 여우가 등불 12개를 90초 안에 모으는 3D 게임이에요. 코드는 `src/main.ts`(흐름·카메라·화면), `src/terrain.ts`(섬 땅), `src/env.ts`(하늘·바다·노을 색), `src/world.ts`(나무·건물 배치), `src/player.ts`(여우), `src/effects.ts`(등불·반딧불·새), `src/input.ts`(키보드·마우스·터치), `src/audio.ts`(효과음)에 나뉘어 있어요.
- 주소 끝에 `?attract=1`을 붙이면 화면 글자 없이 섬만 천천히 돌아가요(썸네일·짧은 영상용).
- 배포: `pnpm build`가 `dist/`를 만들고, `pnpm start`(`server.mjs`)가 `0.0.0.0:$PORT`에서 내보내요. 상태 확인 주소는 `/health`예요.

## Git · GitHub
- `git init`·`git commit`·`git push`·`git tag`를 하지 마세요. 기록(.git)·저장 지점·버전·GitHub 올리기와 GitHub 쪽 변경 합치기는 QuestiVibe 앱이 해요.
- 앱이 GitHub 쪽 변경과 겹친 파일에 `<<<<<<<` `=======` `>>>>>>>` 표시로 두 내용을 같이 넣어 두면, 두 쪽을 살려 맞추고 표시 줄만 지우면 돼요(git 명령 없이). 끝나면 앱의 [합치고 올리기]를 누르게 해 주세요.
- 예외는 하나: 사용자가 **대화에서** git이나 GitHub 문제를 고쳐 달라고 직접 부탁한 그 턴에만, 그 문제를 고치는 데 필요한 git 명령을 써도 돼요. 샌드박스 안에서는 기록 폴더에 쓸 수 없으니, 읽기(`git status`·`git log`·`git diff`)로 원인을 찾아 쉬운 말로 알려 주세요.
- 예외일 때도 하지 마세요: `push --force`, 올린 기록 바꾸기·지우기(`reset --hard`, `rebase` 등), `.git` 파일·git 설정·훅 고치기, 로그인·토큰 다루기. GitHub 로그인은 앱의 [GitHub에 로그인] 버튼으로만 해요.
- `README.md`와 `.gitignore`는 고쳐도 돼요. `.env`·키 파일은 저장소에 넣지 마세요.
- 끝나면 한 일을 쉬운 한국어로 알려 주고, 올리기는 앱의 [지금 올리기]를 누르게 해 주세요.
