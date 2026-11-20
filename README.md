# 노을여우 (Noeul Fox)

해가 바다에 닿기 전에, 작은 섬 곳곳에 놓인 **등불 12개**를 모아 밤하늘로 띄우는 브라우저 3D 게임이에요. 한 판 1~2분.

**바로 해 보기 → https://bnzinc.github.io/noeul-fox/**

> [QuestiVibe](https://github.com/BNZinc) 스타터 `game-3d`로 만든 예시예요. 개발 지식 없이도 "이런 게임 만들어 줘"라고 말하면 에이전트가 만드는 데스크톱 앱이에요. 이 저장소를 **fork**해서 마음대로 고쳐 보세요.

![노을여우](public/og.webp)

## 조작
| 키보드 | 마우스 | 터치 |
|---|---|---|
| WASD·방향키 걷기 · Shift 달리기 · Space 점프 · Enter 시작 · Esc/P 멈춤 | 드래그로 둘러보기 · 휠로 가까이/멀리 | 왼쪽 반 조이스틱 · 오른쪽 반 드래그 · 점프 버튼 |

`?attract=1` — 글자 없이 섬만 천천히 도는 화면(썸네일용) · `?hq=1` — 늘 최고 화질.

## 직접 돌려 보기
Node 22 이상과 pnpm이 있으면:

```bash
pnpm install
pnpm dev          # 개발 (http://127.0.0.1:5173)
pnpm build        # dist/ 만들기
pnpm start        # dist/를 PORT(기본 3000)로 내보내기 — Railway 등에 그대로
```

- GitHub Pages: fork한 저장소의 Settings › Pages › Source를 **GitHub Actions**로 두면 `.github/workflows/pages.yml`이 올려요.
- 코드: `src/`(three.js + TypeScript), 화면 글자: `index.html`, 모델: `public/assets/`.
- 에이전트용 안내는 `AGENTS.md` (QuestiVibe에서 열면 에이전트가 이걸 읽어요).

## 라이선스 · 출처
- **코드: MIT** (`LICENSE`).
- **3D 모델: Polyfork, CC BY 4.0** — MIT가 아니에요. 출처 줄은 `CREDITS.md`와 `public/assets/CREDITS.txt`(모델 옆에 함께 다님), 게임 안 **[만든 재료 · 출처]**에도 있어요. 모델을 다시 쓸 때 출처를 남기고, 고쳤다면 고쳤다고 적어 주세요. Polyfork가 이 게임을 만들거나 보증한 것은 아니에요.
- 제목 글꼴은 Google Fonts에서 받아요(OFL). 소리는 코드로 만든 것(파일 없음).
- `.agents/skills/` — 에이전트 스킬(blender-skills, MIT). 각 폴더의 LICENSE·NOTICE.md를 그대로 두세요.

---

**English:** A tiny three.js game — collect 12 lanterns on a sunset island before the sun sets. Made with the QuestiVibe `game-3d` starter. Code is MIT; the 3D models are by Polyfork under CC BY 4.0 (credits in `CREDITS.md` and `public/assets/CREDITS.txt`). Play: https://bnzinc.github.io/noeul-fox/
