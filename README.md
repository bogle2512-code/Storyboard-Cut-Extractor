# Storyboard Cut Extractor

API 없이 로컬에서 실행되는 스토리보드 컷 추출, 리사이즈, 업스케일, ZIP 다운로드 도구입니다. 현재 `index.html`을 직접 열어 사용하는 브라우저 단독 버전이 동작하며, `src/services`에는 React/Node 확장용 서비스 경계를 분리해두었습니다.

## HTML로 실행

아래 파일을 브라우저에서 열면 바로 실행됩니다.

```text
C:\Users\user\Documents\Codex\2026-05-15\1-react-next-js-2-jpg\index.html
```

## 주요 기능

- JPG, PNG, WEBP 스토리보드 업로드
- 원본 이미지 위에서 수동 컷 선택
- 컷 삭제, 순서 변경, 파일명 수정
- PNG, JPG, WEBP 저장
- 품질 80~100 설정
- 출력 사이즈 체크박스
- 기본 모드 하나로 단순화
- 기본값: 선택 영역 cover resize
- 선택한 박스 안의 이미지만 사용
- 모든 출력 사이즈를 여백 없이 꽉 채움
- 컷 번호 제거
- 브라우저 기반 2x/4x 기본 업스케일 및 선명화
- 저장 전 결과 미리보기
- 선택 사이즈 개별 컷 다운로드
- 원본, 선택한 모든 사이즈, metadata.json 포함 ZIP 다운로드

## 출력 사이즈

- 원본 저장
- 1920x1080
- 3840x2160
- 1080x1920
- 1080x1080
- 1080x1350

## 저장 방식

기본 저장 방식은 `선택 영역 cover resize`입니다.

동작은 단순합니다.

1. 사용자가 원본 스토리보드 위에서 선택한 selectedBox만 crop합니다.
2. crop된 selectedImage를 메모리에 저장합니다.
3. selectedImage를 각 출력 사이즈에 cover resize 합니다.
4. 넘치는 부분은 selectedImage 내부에서만 중앙 기준으로 잘립니다.
5. 결과를 PNG/JPG/WEBP로 저장합니다.

selectedBox 밖 이미지는 사용하지 않습니다. 배경, padding, blur background, 이미지 중복 레이어도 사용하지 않습니다.

## ZIP 구조

```text
project-name/
├─ original/
│  └─ storyboard_original.png
├─ cuts_original/
│  ├─ cut_01.png
│  └─ cut_02.png
├─ cuts_1920x1080/
│  ├─ cut_01_1920x1080.png
│  └─ cut_02_1920x1080.png
├─ cuts_3840x2160/
├─ cuts_1080x1920/
├─ cuts_1080x1080/
├─ cuts_1080x1350/
└─ metadata.json
```

선택한 출력 사이즈 폴더만 ZIP에 포함됩니다. 파일명은 예를 들어 `cut_01_1080x1920_cover.png`처럼 저장됩니다.

## Real-ESRGAN 로컬 업스케일러

브라우저 단독 앱은 보안상 Python을 직접 실행할 수 없으므로 기본 업스케일은 Canvas 기반으로 처리합니다. 고급 업스케일은 `local-upscaler` 폴더에 Python 구조를 준비해두었습니다.

```text
local-upscaler/
├─ upscale.py
├─ requirements.txt
├─ input/
├─ output/
└─ models/
```

### 설치

Python 가상환경을 만든 뒤 설치합니다.

```bash
cd local-upscaler
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Real-ESRGAN 모델 파일은 직접 내려받아 `local-upscaler/models`에 넣어야 합니다.

```text
local-upscaler/models/RealESRGAN_x2plus.pth
local-upscaler/models/RealESRGAN_x4plus.pth
```

### 실행

```bash
python upscale.py --input input --output output --scale 2
python upscale.py --input input --output output --scale 4
```

모델이나 패키지가 없으면 실패하지 않고 입력 이미지를 `output`으로 복사하는 fallback을 사용합니다.

## Node/React 연동 구조

`src/services/upscaleService.ts`에 로컬 Python 업스케일러 호출 명령을 만드는 함수가 있습니다. 브라우저 단독 실행에서는 Python을 호출할 수 없으므로, 추후 Node 로컬 서버나 Electron/Tauri 래퍼에서 이 서비스를 연결하면 됩니다.
