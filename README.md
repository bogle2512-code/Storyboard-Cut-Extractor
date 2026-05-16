# Storyboard Cut Extractor

브라우저에서 로컬로 실행되는 스토리보드 컷 추출 도구입니다.

최종 실행 파일은 루트의 `index.html`입니다.

```text
C:\Users\user\Documents\Codex\2026-05-15\1-react-next-js-2-jpg\index.html
```

## 주요 기능

- JPG, PNG, WEBP 스토리보드 업로드
- 원본 이미지 위에서 수동 컷 선택
- 컷 삭제, 순서 변경, 파일명 수정
- PNG, JPG, WEBP 저장
- 품질 80~100 설정
- 출력 사이즈별 미리보기
- 컷별 다운로드
- 원본, 선택한 모든 사이즈, metadata.json 포함 ZIP 다운로드

## 출력 사이즈

- 원본 저장
- 1920x1080
- 3840x2160
- 1080x1920
- 1080x1080
- 1080x1350

## 저장 방식

기본 저장 방식은 `사이즈에 꽉 차게 출력`입니다.

1. 사용자가 선택한 selectedBox만 원본 이미지에서 crop합니다.
2. crop된 selectedImage를 기준으로 합니다.
3. selectedImage를 각 출력 사이즈 캔버스에 cover resize 합니다.
4. 비율은 유지합니다.
5. 캔버스 밖으로 넘치는 부분은 중앙 기준으로 자동 크롭됩니다.
6. 결과를 PNG/JPG/WEBP로 저장합니다.

선택 영역 밖으로 확장하지 않습니다. blur background, padding, letterbox, 배경 fill, 이미지 중복 레이어를 사용하지 않습니다.

## 파일명

```text
cut_01_original.png
cut_01_1920x1080_cover.png
cut_01_3840x2160_cover.png
cut_01_1080x1920_cover.png
cut_01_1080x1080_cover.png
cut_01_1080x1350_cover.png
```

## ZIP 구조

```text
project-name/
  original/
    storyboard_original.png
  cuts_original/
    cut_01_original.png
  cuts_1920x1080/
    cut_01_1920x1080_cover.png
  cuts_3840x2160/
    cut_01_3840x2160_cover.png
  cuts_1080x1920/
  cuts_1080x1080/
  cuts_1080x1350/
  metadata.json
```

## GitHub Pages

이 프로젝트는 루트 `index.html` 기준으로 정적 실행됩니다.

GitHub에 업로드한 뒤 Pages에서 루트 폴더를 배포하면 됩니다.

## Real-ESRGAN 로컬 업스케일러

고급 업스케일링 연동을 위한 Python 구조는 `local-upscaler` 폴더에 있습니다.

브라우저 단독 실행에서는 Python을 직접 호출하지 않고, Canvas 기반 기본 리사이즈와 샤픈 처리를 사용합니다.
